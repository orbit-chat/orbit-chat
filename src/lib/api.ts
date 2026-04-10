function normalizeBaseUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  const fixedPort = trimmed.replace(/\/:(\d+)/, ":$1");
  return fixedPort.replace(/\/$/, "");
}

const API_BASE = normalizeBaseUrl(import.meta.env.VITE_API_URL ?? "http://147.135.31.128:3000");

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  /** @internal prevent infinite 401→refresh→retry loops */
  _isRetry?: boolean;
};

const REQUEST_TIMEOUT_MS = 15_000;

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
    throw new Error(err.message ?? `HTTP ${res.status}`);
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
}) {
  return request<AuthResponse>("/auth/signup", { method: "POST", body: data });
}

export function login(data: { username: string; password: string; deviceName: string }) {
  return request<AuthResponse>("/auth/login", { method: "POST", body: data });
}

export function loginWithRecoveryCode(data: {
  username: string;
  recoveryCode: string;
  deviceName: string;
}) {
  return request<AuthResponse>("/auth/login/recovery", { method: "POST", body: data });
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

export function getUserKeys(id: string, token: string) {
  return request<{ id: string; publicKey: string; createdAt: string }[]>(`/users/${id}/keys`, { token });
}

export function addMyPublicKey(publicKey: string, token: string) {
  return request<{ id: string; publicKey: string; createdAt: string }[]>(`/users/me/keys`, {
    method: "POST",
    body: { publicKey },
    token,
  });
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
};

export function getMyConversationKeys(conversationId: string, token: string) {
  return request<ConversationKey[]>(`/keys/${conversationId}`, { token });
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
  members: { id: string; userId: string; role: string; user: { id: string; username: string } }[];
  /** Only present once at creation time */
  passcode?: string;
  /** Whether the conversation was newly created (false = existing DM returned) */
  created?: boolean;
};

export function getConversations(token: string) {
  return request<Conversation[]>("/conversations", { token });
}

export function createConversation(
  data: {
    type: "dm" | "group";
    name?: string;
    memberIds: string[];
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

export function leaveGroupChat(conversationId: string, wipeMessages: boolean, token: string) {
  return request<{ success: true; destroyed: boolean }>(`/conversations/${conversationId}/leave`, {
    method: "POST",
    body: { wipeMessages },
    token,
  });
}

export function addMembers(
  conversationId: string,
  data: { memberIds: string[]; encryptedKeys?: Record<string, string> },
  token: string
) {
  return request<{ success: true }>(`/conversations/${conversationId}/members`, {
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
  ciphertext: string;
  nonce: string;
  keyVersion: number;
  mediaIds?: string[];
  type: string;
  expiresAt: string | null;
  maxViews: number | null;
  currentViews: number;
  createdAt: string;
  sender: { id: string; username: string };
};

export function getMessages(conversationId: string, token: string, cursor?: string) {
  const qs = cursor ? `?cursor=${cursor}` : "";
  return request<ServerMessage[]>(`/messages/${conversationId}${qs}`, { token });
}

export function sendMessage(
  data: { conversationId: string; ciphertext: string; nonce: string; keyVersion?: number; mediaIds?: string[] },
  token: string
) {
  return request<ServerMessage>("/messages", { method: "POST", body: data, token });
}
