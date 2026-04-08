const API_BASE = import.meta.env.VITE_API_URL ?? "http://147.135.31.128:3000";

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/* ───── Auth ───── */

export type AuthResponse = {
  user: { id: string; username: string; email: string };
  accessToken: string;
  refreshToken: string;
};

export function signup(data: {
  email: string;
  username: string;
  password: string;
  publicKey: string;
  deviceName: string;
}) {
  return request<AuthResponse>("/auth/signup", { method: "POST", body: data });
}

export function login(data: { email: string; password: string; deviceName: string }) {
  return request<AuthResponse>("/auth/login", { method: "POST", body: data });
}

export function refreshToken(rt: string) {
  return request<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
    method: "POST",
    body: { refreshToken: rt },
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

export type Conversation = {
  id: string;
  type: "dm" | "group";
  name: string | null;
  createdBy: string | null;
  createdAt: string;
  members: { id: string; userId: string; role: string; user: { id: string; username: string } }[];
};

export function getConversations(token: string) {
  return request<Conversation[]>("/conversations", { token });
}

export function createConversation(
  data: { type: "dm" | "group"; name?: string; memberIds: string[]; encryptedKeys?: Record<string, string> },
  token: string
) {
  return request<Conversation>("/conversations", { method: "POST", body: data, token });
}

/* ───── Messages ───── */

export type ServerMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  ciphertext: string;
  nonce: string;
  keyVersion: number;
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
  data: { conversationId: string; ciphertext: string; nonce: string; keyVersion?: number },
  token: string
) {
  return request<ServerMessage>("/messages", { method: "POST", body: data, token });
}
