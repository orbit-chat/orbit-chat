import { useEffect, useRef } from "react";
import * as api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { routeConversationId, useNavigationStore } from "../../stores/navigationStore";
import { usePrefsStore } from "../../stores/prefsStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useSocketStore } from "../../stores/socketStore";
import { toChatMessage } from "../chat/toChatMessage";
import { useConversationsStore, type Conversation } from "./conversationsStore";
import { conversationTitle } from "./selectors";

const BACKFILL_CONCURRENCY = 3;

/** Forget a conversation the user can no longer access, everywhere it's referenced. */
function dropConversation(conversationId: string) {
  useConversationsStore.getState().remove(conversationId);
  useNavigationStore.getState().forgetConversation(conversationId);
  usePrefsStore.getState().forgetConversation(conversationId);
  useChatLockStore.getState().lock(conversationId);
}

/**
 * Fetch history for conversations with nothing cached, so list order and previews are
 * right after a fresh install. History is marked read: it isn't new to anyone.
 */
async function backfillMessages(conversations: Conversation[], token: string, userId: string) {
  const { byConversation, upsertMessage } = useMessagesStore.getState();
  const queue = conversations.filter((c) => !byConversation[c.id]?.length);
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        const messages = await api.getMessages(next.id, token);
        for (const message of messages) {
          upsertMessage(next.id, toChatMessage(message), { currentUserId: userId, markAsRead: true });
        }
      } catch {
        // One conversation failing shouldn't block the rest.
      }
    }
  };
  await Promise.all(Array.from({ length: BACKFILL_CONCURRENCY }, worker));
}

/**
 * Keeps the conversation list in step with the server: initial load, reload after a
 * reconnect, and the socket events that add, change or remove conversations. Also
 * applies route side effects: unread clearing, chat-lock on leave, key fetching.
 */
export function useConversationSync() {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const socket = useSocketStore((s) => s.socket);
  const connectionState = useSocketStore((s) => s.connectionState);
  const status = useConversationsStore((s) => s.status);

  // Initial load per session.
  useEffect(() => {
    if (!token || !userId) return;
    void useConversationsStore.getState().load(token);
    // Keyed on the user, not the token: a token refresh shouldn't reload, a new session should.
  }, [userId]);

  // Backfill once the list first arrives.
  useEffect(() => {
    if (status !== "ready" || !userId) return;
    const currentToken = useAuthStore.getState().token;
    if (currentToken) void backfillMessages(useConversationsStore.getState().conversations, currentToken, userId);
  }, [status, userId]);

  // Profiles (avatars, display names, presence) for DM partners and the first few members of each group.
  const conversations = useConversationsStore((s) => s.conversations);
  useEffect(() => {
    const currentToken = useAuthStore.getState().token;
    if (!currentToken || !userId) return;
    const { byId, fetchProfile } = useProfilesStore.getState();
    const wanted = new Set<string>();
    for (const conversation of conversations) {
      const others = conversation.members.filter((m) => m.user.id !== userId);
      for (const member of conversation.type === "dm" ? others : others.slice(0, 3)) wanted.add(member.user.id);
    }
    for (const id of wanted) if (!byId[id]) void fetchProfile(id, currentToken);
  }, [conversations, userId]);

  // Reload after a reconnect: events sent while offline were missed.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (connectionState !== "connected") return;
    const currentToken = useAuthStore.getState().token;
    if (wasConnected.current && currentToken) void useConversationsStore.getState().load(currentToken);
    wasConnected.current = true;
  }, [connectionState]);

  // Socket events.
  useEffect(() => {
    if (!socket || !userId) return;
    const store = () => useConversationsStore.getState();
    const currentToken = () => useAuthStore.getState().token;
    const refreshKey = (conversation: Conversation) => {
      const t = currentToken();
      if (t) void useE2EEStore.getState().ensureConversationSecretKey({ conversation, token: t, myUserId: userId, forceRefresh: true });
    };
    const rememberPasscode = (conversation: Conversation, passcode: string | null) => {
      if (passcode) store().setPendingPasscode(conversation.id, { passcode, label: conversationTitle(conversation, userId) });
    };

    const handlers: Record<string, (...args: any[]) => void> = {
      conversation_created: (data: { conversation: Conversation; passcode: string | null }) => {
        store().upsert(data.conversation);
        rememberPasscode(data.conversation, data.passcode);
      },
      chat_settings_updated: (data: { conversation: Conversation }) => store().upsert(data.conversation),
      passcode_reenabled: (data: { conversation: Conversation; passcode: string }) => {
        store().upsert(data.conversation);
        rememberPasscode(data.conversation, data.passcode);
      },
      conversation_deleted: (data: { conversationId: string }) => dropConversation(data.conversationId),
      member_removed: (data: { conversationId: string }) => dropConversation(data.conversationId),
      member_left: (data: { conversationId: string; userId: string }) => {
        store().removeMember(data.conversationId, data.userId);
        const conversation = store().conversations.find((c) => c.id === data.conversationId);
        if (conversation) refreshKey(conversation);
      },
      member_added: (data: { conversation: Conversation; passcode: string | null; addedByUserId: string }) => {
        store().upsert(data.conversation);
        refreshKey(data.conversation);
        if (data.addedByUserId !== userId) rememberPasscode(data.conversation, data.passcode);
      },
      presence_updated: (data: { userId: string; presence: api.Presence; lastActiveAt: string | null }) => {
        useProfilesStore.getState().mergePresence(data.userId, data.presence, data.lastActiveAt);
      },
      new_message: (data: { conversationId: string; keyVersion?: number }) => {
        const conversation = store().conversations.find((c) => c.id === data.conversationId);
        const t = currentToken();
        if (!conversation) {
          // First message in a conversation we haven't seen yet.
          if (t) void store().load(t);
          return;
        }
        const knownVersion = useE2EEStore.getState().getConversationKeyVersion(data.conversationId) ?? 1;
        if (typeof data.keyVersion === "number" && data.keyVersion > knownVersion) refreshKey(conversation);
      }
    };

    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    return () => {
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
    };
  }, [socket, userId]);

  // Route side effects.
  const openConversationId = useNavigationStore((s) => routeConversationId(s.route));
  const previousConversationId = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousConversationId.current;
    if (previous && previous !== openConversationId) useChatLockStore.getState().onLeave(previous);
    previousConversationId.current = openConversationId;

    // Marks it read and stops counting new messages there while it's open.
    useMessagesStore.getState().setActiveConversation(openConversationId);

    const conversation = openConversationId
      ? useConversationsStore.getState().conversations.find((c) => c.id === openConversationId)
      : null;
    const t = useAuthStore.getState().token;
    if (conversation && t && userId) {
      void useE2EEStore.getState().ensureConversationSecretKey({ conversation, token: t, myUserId: userId });
    }
  }, [openConversationId, userId]);

  useEffect(
    () => () => {
      useMessagesStore.getState().setActiveConversation(null);
    },
    []
  );
}
