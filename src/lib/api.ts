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

export type UserProfile = { id: string; username: string; email?: string; createdAt?: string };

export function searchUsers(query: string, token: string) {
  return request<UserProfile[]>(`/users/search?q=${encodeURIComponent(query)}`, { token });
}

export function getUser(id: string, token: string) {
  return request<UserProfile>(`/users/${id}`, { token });
}

export function getUserKeys(id: string, token: string) {
  return request<{ id: string; publicKey: string; createdAt: string }[]>(`/users/${id}/keys`, { token });
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
  data: { type: "dm" | "group"; name?: string; memberIds: string[] },
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
