import { API_BASE } from "./serverConfig";

export { API_BASE };

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  /** @internal prevent infinite 401→refresh→retry loops */
  _isRetry?: boolean;
};

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A non-2xx response. `status` lets callers tell "not found" or "conflict" apart from failures;
 * `code` is the server's machine-readable reason where it gives one (e.g. `KEY_ERROR` below), and
 * `body` the rest of the error response.
 */
export class ApiError extends Error {
  readonly code: string | undefined;
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.code = typeof body.code === "string" ? body.code : undefined;
  }
}

/** Reasons the server gives for refusing a key write or a send (mobile plan M1b). */
export const KEY_ERROR = {
  /** Someone rotated first; the body carries `expectedKeyVersion`. Re-seal for that version. */
  versionConflict: "key_version_conflict",
  /** A member left; a remaining member has to rotate before anyone can send. */
  rotationRequired: "rotation_required",
  /** The message was encrypted with an older key than the newest; the body carries `expectedKeyVersion`. */
  staleKeyVersion: "stale_key_version",
  /** This device isn't on its user's signed device list yet. */
  deviceNotLinked: "device_not_linked",
  /** The server uses per-device keys and this client sent the old per-user form. */
  updateRequired: "update_required",
  /** The key set didn't match the members' current device lists or membership: refetch and seal again. */
  deviceListChanged: "device_list_changed",
} as const;

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    const message = (err?.message ?? "").toLowerCase();
    if (err?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s while calling ${path}`);
    }
    if (message.includes("failed to fetch") || message.includes("networkerror")) {
      throw new Error(`Unable to reach Orbit server at ${API_BASE}. Ensure orbit-server is running and VITE_API_URL is correct.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // On 401, attempt a silent token refresh and retry the request once
    if (res.status === 401 && opts.token && !opts._isRetry) {
      const { useAuthStore } = await import("../stores/authStore");
      const refreshed = await useAuthStore.getState().silentRefresh();
      if (refreshed) {
        const newToken = useAuthStore.getState().token;
        return request<T>(path, { ...opts, token: newToken, _isRetry: true });
      }
    }
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const body = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new ApiError(typeof message === "string" && message ? message : `HTTP ${res.status}`, res.status, body);
  }

  return res.json() as Promise<T>;
}

/* ───── Auth ───── */

export type AuthResponse = {
  user: { id: string; username: string };
  accessToken: string;
  refreshToken: string;
  recoveryCodes?: string[];
};

export function signup(data: {
  username: string;
  password: string;
  publicKey: string;
  deviceName: string;
  installId: string;
}) {
  return request<AuthResponse>("/auth/signup", { method: "POST", body: data });
}

export function login(data: { username: string; password: string; deviceName: string; installId: string }) {
  return request<AuthResponse>("/auth/login", { method: "POST", body: data });
}

export function loginWithRecoveryCode(data: {
  username: string;
  recoveryCode: string;
  deviceName: string;
  installId: string;
}) {
  return request<AuthResponse>("/auth/login/recovery", { method: "POST", body: data });
}

/** End this device's session on the server: its refresh token, sockets and pushes stop. */
export function logout(token: string) {
  return request<{ success: true }>("/auth/logout", { method: "POST", token });
}

/** Content-free push for this device (mobile plan M4). */
export function registerPush(data: { platform: "apns" | "fcm"; token: string; mutedConversationIds: string[] }, token: string) {
  return request<{ registered: boolean }>("/push/registration", { method: "PUT", body: data, token });
}

export function unregisterPush(token: string) {
  return request<{ registered: boolean }>("/push/registration", { method: "DELETE", token });
}

export function refreshToken(rt: string) {
  return request<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
    method: "POST",
    body: { refreshToken: rt },
  });
}

/* ───── Recovery Codes ───── */

export type RecoveryCodeStatus = {
  active: boolean;
  total: number;
  remaining: number;
};

export function getRecoveryCodeStatus(token: string) {
  return request<RecoveryCodeStatus>("/auth/recovery-codes/status", { token });
}

export function disableRecoveryCodes(codes: string[], token: string) {
  return request<{ success: true; message: string }>("/auth/recovery-codes/disable", {
    method: "POST",
    body: { codes },
    token,
  });
}

export function refreshRecoveryCodes(codes: string[], token: string) {
  return request<{ recoveryCodes: string[] }>("/auth/recovery-codes/refresh", {
    method: "POST",
    body: { codes },
    token,
  });
}

/* ───── Users ───── */

export type Presence = "online" | "idle" | "dnd" | "offline";

export type ProfileLink = {
  label: string;
  url: string;
};

export type UserRole = {
  id: string;
  name: string;
};

export type UserProfile = {
  id: string;
  username: string;
  email?: string;
  createdAt?: string;

  // Extended profile fields (server may or may not provide these yet)
  displayName?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  timezone?: string | null;
  presence?: Presence | null;
  statusText?: string | null;
  statusEmoji?: string | null;
  lastActiveAt?: string | null;
  links?: ProfileLink[] | null;
  roles?: UserRole[] | null;
  deleteMessagesOnUnfriend?: boolean;
};

export type UpdateMyProfileInput = {
  displayName?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  timezone?: string | null;
  presence?: Presence | null;
  statusText?: string | null;
  statusEmoji?: string | null;
  links?: ProfileLink[] | null;
  deleteMessagesOnUnfriend?: boolean;
};

export type FriendSummary = {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  presence?: Presence | null;
  statusText?: string | null;
  statusEmoji?: string | null;
};

export type FriendListItem = {
  id: string;
  status: "pending" | "accepted";
  createdAt: string;
  updatedAt: string;
  direction: "incoming" | "outgoing" | "friend";
  user: FriendSummary;
};

export type FriendRequestsResponse = {
  incoming: FriendListItem[];
  outgoing: FriendListItem[];
};

export function searchUsers(query: string, token: string) {
  return request<UserProfile[]>(`/users/search?q=${encodeURIComponent(query)}`, { token });
}

export function getUser(id: string, token: string) {
  return request<UserProfile>(`/users/${id}`, { token });
}

export function getMe(token: string) {
  return request<UserProfile>(`/users/me`, { token });
}

export function updateMyProfile(data: UpdateMyProfileInput, token: string) {
  return request<UserProfile>(`/users/me/profile`, { method: "PUT", body: data, token });
}

async function uploadFile(path: string, file: File, token: string) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_BASE}${path}` as string, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<UserProfile>;
}

export function uploadMyAvatar(file: File, token: string) {
  return uploadFile(`/users/me/avatar`, file, token);
}

export function uploadMyBanner(file: File, token: string) {
  return uploadFile(`/users/me/banner`, file, token);
}

/** Newest first. No registration times: they would show when each device signed in. */
export function getUserKeys(id: string, token: string) {
  return request<{ id: string; publicKey: string }[]>(`/users/${id}/keys`, { token });
}

export function addMyPublicKey(publicKey: string, token: string) {
  return request<{ id: string; publicKey: string }[]>(`/users/me/keys`, {
    method: "POST",
    body: { publicKey },
    token,
  });
}

/* ───── Identity and device lists (mobile plan B6) ───── */

export type SignedDeviceListResponse = { version: number; body: string; signature: string };
export type IdentityResponse = { identityKey: string; deviceList: SignedDeviceListResponse };

/** Null when the user has no identity yet (404); any other failure throws. */
async function identityOrNull(path: string, token: string) {
  try {
    return await request<IdentityResponse>(path, { token });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function getMyIdentity(token: string) {
  return identityOrNull("/identity/me", token);
}

export function getUserIdentity(userId: string, token: string) {
  return identityOrNull(`/identity/${encodeURIComponent(userId)}`, token);
}

export function publishIdentity(
  data: { identityKey: string; deviceList: { body: string; signature: string } },
  token: string
) {
  return request<IdentityResponse>("/identity/me", { method: "PUT", body: data, token });
}

export function publishDeviceList(deviceList: { body: string; signature: string }, token: string) {
  return request<IdentityResponse>("/identity/me/device-list", { method: "POST", body: deviceList, token });
}

/**
 * The newest list that named a device, for checking keys it issued before it left its user's
 * list. Null when no list did. Callers verify it against the identity key they pinned.
 */
export function getDeviceListContaining(userId: string, deviceId: string, token: string) {
  return identityOrNull(`/identity/${encodeURIComponent(userId)}/device-lists/${encodeURIComponent(deviceId)}`, token);
}

/* ───── Device linking relay (mobile plan B7) ───── */

export type LinkSessionStatus = "open" | "joined" | "completed" | "failed" | "cancelled" | "expired";
export type LinkSession = {
  sessionId: string;
  mode: "qr" | "code";
  creatorRole: "existing" | "new";
  creatorDeviceId: string;
  joinerDeviceId: string | null;
  status: LinkSessionStatus;
  failureReason: string | null;
  expiresAt: string;
};

export function createLinkSession(data: { mode: "qr" | "code"; role: "existing" | "new" }, token: string) {
  return request<LinkSession>("/link/sessions", { method: "POST", body: data, token });
}

/** The account's open session for a typed code; null when there is none. */
export async function getActiveLinkSession(token: string) {
  try {
    return await request<LinkSession>("/link/sessions/active", { token });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function joinLinkSession(sessionId: string, token: string) {
  return request<LinkSession>(`/link/sessions/${encodeURIComponent(sessionId)}/join`, { method: "POST", token });
}

export function postLinkMessage(sessionId: string, payload: string, token: string) {
  return request<{ seq: number }>(`/link/sessions/${encodeURIComponent(sessionId)}/messages`, { method: "POST", body: { payload }, token });
}

export function getLinkMessages(sessionId: string, after: number, token: string) {
  return request<{ session: LinkSession; messages: Array<{ seq: number; payload: string }> }>(
    `/link/sessions/${encodeURIComponent(sessionId)}/messages?after=${after}`,
    { token }
  );
}

export function failLinkSession(sessionId: string, reason: string, token: string) {
  return request<LinkSession>(`/link/sessions/${encodeURIComponent(sessionId)}/fail`, { method: "POST", body: { reason }, token });
}

export function completeLinkSession(sessionId: string, token: string) {
  return request<LinkSession>(`/link/sessions/${encodeURIComponent(sessionId)}/complete`, { method: "POST", token });
}

export type RecentLinkSession = LinkSession & { createdAt: string; creatorDeviceName: string | null; joinerDeviceName: string | null };

export function getRecentLinkSessions(token: string) {
  return request<RecentLinkSession[]>("/link/sessions/recent", { token });
}

/** Which key protocol the server runs. No auth. */
export function getE2eeConfig() {
  return request<{ perDeviceKeys: boolean }>("/config/e2ee");
}

export type AccountDevice = {
  id: string;
  name: string;
  /** Always null: the server keeps no activity times (no-logs policy). */
  lastSeenAt?: string | null;
  signedIn: boolean;
  /** On the account's current signed device list, as the server reads it. Display only. */
  trusted: boolean;
  /** The device making this request. */
  current: boolean;
};

export type AccountDevicesResponse = {
  identityPublished: boolean;
  deviceListVersion: number | null;
  devices: AccountDevice[];
};

export function getMyDevices(token: string) {
  return request<AccountDevicesResponse>("/identity/me/devices", { token });
}

/** Start over with a new identity after losing every linked device (mobile plan B10). */
export function resetIdentity(
  data: { password: string; recoveryCode: string; identityKey: string; deviceList: { body: string; signature: string } },
  token: string
) {
  return request<IdentityResponse>("/identity/me/reset", { method: "POST", body: data, token });
}

/** Sign out a device that isn't linked. Linked devices are removed by publishing a list without them. */
export function signOutDevice(deviceId: string, token: string) {
  return request<{ success: true }>(`/identity/me/devices/${encodeURIComponent(deviceId)}/sign-out`, { method: "POST", token });
}

export function getFriends(token: string) {
  return request<FriendListItem[]>(`/users/friends`, { token });
}

export function getFriendRequests(token: string) {
  return request<FriendRequestsResponse>(`/users/friends/requests`, { token });
}

export function sendFriendRequest(targetUserId: string, token: string) {
  return request<FriendListItem>(`/users/friends/requests`, {
    method: "POST",
    body: { targetUserId },
    token,
  });
}

export function acceptFriendRequest(requestId: string, token: string) {
  return request<FriendListItem>(`/users/friends/requests/${requestId}/accept`, {
    method: "POST",
    token,
  });
}

export function declineFriendRequest(requestId: string, token: string) {
  return request<{ success: true }>(`/users/friends/requests/${requestId}/decline`, {
    method: "POST",
    token,
  });
}

export function cancelFriendRequest(requestId: string, token: string) {
  return request<{ success: true }>(`/users/friends/requests/${requestId}`, {
    method: "DELETE",
    token,
  });
}

export function removeFriend(friendUserId: string, token: string) {
  return request<{ success: true }>(`/users/friends/${friendUserId}`, {
    method: "DELETE",
    token,
  });
}

/* ───── Conversation Keys ───── */

export type ConversationKey = {
  id: string;
  conversationId: string;
  userId: string;
  encryptedGroupKey: string;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
  /** The device this copy is sealed to; null on legacy per-user rows. */
  deviceId?: string | null;
  /** The device that sealed and signed it (per-device rows only). */
  issuerDeviceId?: string | null;
  signature?: string | null;
  /** The server's lookup hint for whose device list holds the issuer. Never trusted on its own. */
  issuerUserId?: string | null;
  legacy?: boolean;
};

export function getMyConversationKeys(conversationId: string, token: string) {
  return request<ConversationKey[]>(`/keys/${conversationId}`, { token });
}

/** One sealed, signed copy of a conversation key for one device (per-device keys). */
export type DeviceKeyInput = { deviceId: string; sealedKey: string; signature: string };

/** Existing keys re-sealed for this user's own linked devices (linking, and the one-time legacy move). */
export function storeDeviceKeyBatch(
  keys: Array<DeviceKeyInput & { conversationId: string; keyVersion: number }>,
  token: string
) {
  return request<{ stored: number; skipped: number }>(`/keys/device-batch`, { method: "POST", body: { keys }, token });
}

export function storeConversationKey(
  data: {
    conversationId: string;
    userId: string;
    encryptedGroupKey: string;
    keyVersion?: number;
  },
  token: string
) {
  return request<ConversationKey>(`/keys`, { method: "POST", body: data, token });
}

/* ───── Conversations ───── */

export type ChatLockMode = "on_leave" | "on_logout" | "after_time" | "after_inactivity";

export type Conversation = {
  id: string;
  type: "dm" | "group";
  name: string | null;
  createdBy: string | null;
  createdAt: string;
  encryptedTitle: string | null;
  titleNonce: string | null;
  encryptedImageUrl: string | null;
  imageUrlNonce: string | null;
  passcodeEnabled: boolean;
  passcodeLength: number;
  passcodeDisableRequestedBy: string | null;
  lockMode: ChatLockMode;
  lockTimeoutSeconds: number | null;
  members: {
    id: string;
    userId: string;
    role: string;
    minReadableKeyVersion: number;
    user: { id: string; username: string };
  }[];
  /** Only present once at creation time */
  passcode?: string;
  /** Whether the conversation was newly created (false = existing DM returned) */
  created?: boolean;
  /**
   * Per-device keys: a member left, and nobody can send until a remaining member rotates the key
   * (the leaver can't issue it). Absent on servers without per-device keys.
   */
  rotationRequired?: boolean;
};

export function getConversations(token: string) {
  return request<Conversation[]>("/conversations", { token });
}

/** The per-device form of a key write: the version the signatures cover, and one copy per device. */
export type PerDeviceKeyWrite = { keyVersion: number; deviceKeys: DeviceKeyInput[] };

export function createConversation(
  data: {
    type: "dm" | "group";
    name?: string;
    memberIds: string[];
    /** Per-device keys: chosen by the client, because every envelope signs it. */
    conversationId?: string;
    keyVersion?: number;
    deviceKeys?: DeviceKeyInput[];
    encryptedKeys?: Record<string, string>;
    encryptedTitle?: string;
    titleNonce?: string;
    encryptedImageUrl?: string;
    imageUrlNonce?: string;
    passcode?: string;
  },
  token: string
) {
  return request<Conversation>("/conversations", { method: "POST", body: data, token });
}

export function verifyPasscode(conversationId: string, passcode: string, token: string) {
  return request<{ success: true }>(`/conversations/${conversationId}/verify-passcode`, {
    method: "POST",
    body: { passcode },
    token,
  });
}

export function bypassPasscode(conversationId: string, recoveryCode: string, token: string) {
  return request<{ success: true; message: string }>(`/conversations/${conversationId}/bypass-passcode`, {
    method: "POST",
    body: { recoveryCode },
    token,
  });
}

export function requestDisablePasscode(conversationId: string, token: string) {
  return request<{
    status: "pending" | "disabled" | "already_disabled";
    conversation: Conversation;
  }>(`/conversations/${conversationId}/request-disable-passcode`, {
    method: "POST",
    token,
  });
}

export function cancelDisableRequest(conversationId: string, token: string) {
  return request<Conversation>(`/conversations/${conversationId}/cancel-disable-request`, {
    method: "POST",
    token,
  });
}

export function reenablePasscode(conversationId: string, token: string) {
  return request<{ passcode: string; conversation: Conversation }>(
    `/conversations/${conversationId}/reenable-passcode`,
    { method: "POST", token }
  );
}

export function deleteConversation(conversationId: string, wipeMessages: boolean, token: string) {
  return request<{ success: true }>(`/conversations/${conversationId}/delete`, {
    method: "POST",
    body: { wipeMessages },
    token,
  });
}

/** `encryptedKeys` is the legacy form only; with per-device keys the server flags the chat for rotation instead. */
export function leaveGroupChat(
  conversationId: string,
  wipeMessages: boolean,
  token: string,
  encryptedKeys?: Record<string, string>
) {
  return request<{ success: true; destroyed: boolean }>(`/conversations/${conversationId}/leave`, {
    method: "POST",
    body: encryptedKeys ? { wipeMessages, encryptedKeys } : { wipeMessages },
    token,
  });
}

export function addMembers(
  conversationId: string,
  data: { memberIds: string[]; encryptedKeys?: Record<string, string> } & Partial<PerDeviceKeyWrite>,
  token: string
) {
  return request<{ success: true }>(`/conversations/${conversationId}/members`, {
    method: "POST",
    body: data,
    token,
  });
}

export function removeMember(
  conversationId: string,
  userId: string,
  keys: { encryptedKeys: Record<string, string> } | PerDeviceKeyWrite,
  token: string
) {
  return request<{ success: true }>(`/conversations/${conversationId}/members/${userId}`, {
    method: "DELETE",
    body: keys,
    token,
  });
}

/** Issue the next key version to every member's linked devices (per-device keys only). */
export function rotateConversationKey(conversationId: string, data: PerDeviceKeyWrite, token: string) {
  return request<{ conversationId: string; keyVersion: number }>(`/conversations/${conversationId}/rotate-key`, {
    method: "POST",
    body: data,
    token,
  });
}

export function updateChatSettings(
  conversationId: string,
  data: {
    name?: string;
    encryptedTitle?: string;
    titleNonce?: string;
    encryptedImageUrl?: string;
    imageUrlNonce?: string;
    passcode?: string;
    passcodeEnabled?: boolean;
    passcodeLength?: number;
    lockMode?: ChatLockMode;
    lockTimeoutSeconds?: number;
  },
  token: string
) {
  return request<Conversation>(`/conversations/${conversationId}/settings`, {
    method: "PUT",
    body: data,
    token,
  });
}

/* ───── Media ───── */

export type MediaUploadReservation = {
  mediaId: string;
  uploadUrl: string;
  storageKey: string;
};

export function requestMediaUploadUrl(
  data: {
    conversationId: string;
    fileName: string;
    contentType: string;
    contentLength?: number;
    sha256?: string;
    isOneTime?: boolean;
  },
  token: string
) {
  return request<MediaUploadReservation>('/media/upload-url', {
    method: 'POST',
    body: data,
    token,
  });
}

export async function uploadEncryptedBlob(uploadUrl: string, blob: Blob) {
  // Some S3-compatible providers are strict about signed headers and reject
  // PUTs when Content-Type is set unexpectedly. Try without headers first,
  // then retry with explicit octet-stream for older signatures.
  let res = await fetch(uploadUrl, {
    method: 'PUT',
    body: blob,
  });

  if (!res.ok) {
    res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: blob,
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const detail = body ? `: ${body.slice(0, 200)}` : '';
    throw new Error(`Upload failed with status ${res.status}${detail}`);
  }
}

export async function downloadEncryptedMedia(mediaId: string, token: string) {
  const access = await request<{ downloadUrl: string }>(`/media/${mediaId}/access`, { token });
  const res = await fetch(access.downloadUrl, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Download failed with status ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/* ───── Messages ───── */

export type ServerMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  parentMessageId: string | null;
  ciphertext: string;
  nonce: string;
  keyVersion: number;
  mediaIds?: string[];
  type: string;
  expiresAt: string | null;
  maxViews: number | null;
  currentViews: number;
  reactions?: Array<{ emoji: string; count: number; userIds: string[] }>;
  isPinned?: boolean;
  createdAt: string;
  sender: { id: string; username: string };
  /** Mobile plan B9: the sending device and its signature; null on messages sent before signing. */
  senderDeviceId?: string | null;
  signature?: string | null;
};

export function getMessages(conversationId: string, token: string, cursor?: string) {
  const qs = cursor ? `?cursor=${cursor}` : "";
  return request<ServerMessage[]>(`/messages/${conversationId}${qs}`, { token });
}

export function sendMessage(
  data: {
    conversationId: string;
    ciphertext: string;
    nonce: string;
    parentMessageId?: string;
    keyVersion?: number;
    mediaIds?: string[];
    messageId?: string;
    signature?: string;
  },
  token: string
) {
  return request<ServerMessage>("/messages", { method: "POST", body: data, token });
}
