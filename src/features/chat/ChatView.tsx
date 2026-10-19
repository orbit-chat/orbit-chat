import { useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useConversationsStore } from "../conversations/conversationsStore";
import { conversationTitle } from "../conversations/selectors";
import { Composer } from "../composer/Composer";
import { PasscodeLockScreen } from "../chat-settings/PasscodeLockScreen";
import { useChatLockEffects } from "../chat-settings/useChatLockEffects";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { useChatUiStore } from "./chatUiStore";
import { ThreadPanel } from "./ThreadPanel";
import { TypingIndicator } from "./TypingIndicator";
import { useOpenConversation } from "./useOpenConversation";
import { useSeenReceipts } from "./useRealtimeSync";

/**
 * The open conversation. Mounted with `key={conversationId}`, so switching chats starts
 * from a clean slate instead of carrying popups, scroll state or drafts across.
 */
export function ChatView({ conversationId }: { conversationId: string }) {
  const conversation = useConversationsStore((s) => s.conversations.find((c) => c.id === conversationId));
  const user = useAuthStore((s) => s.user);
  const profiles = useProfilesStore((s) => s.byId);
  const unlocked = useChatLockStore((s) => Boolean(conversation && (!conversation.passcodeEnabled || s.unlocked[conversation.id])));
  // Read before the sync hook marks the chat read, so the "New messages" marker knows where to go.
  const [unreadAtOpen] = useState(() => useMessagesStore.getState().unreadCountByConversation[conversationId] ?? 0);
  const threadRootId = useChatUiStore((s) => s.threadRootByConversation[conversationId] ?? null);
  useOpenConversation(conversationId, unlocked);
  useSeenReceipts(conversationId, unlocked);
  useChatLockEffects(conversation, unlocked);

  if (!conversation || !user) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-orbit-muted">
        {useConversationsStore.getState().status === "ready" ? "This conversation isn't available anymore." : "Loading…"}
      </div>
    );
  }

  const title = conversationTitle(conversation, user.id, profiles);
  const minReadableKeyVersion = conversation.members.find((m) => m.userId === user.id)?.minReadableKeyVersion ?? 1;

  return (
    <div className="flex min-h-0 flex-1 animate-orbit-fade-in flex-col">
      <ChatHeader conversation={conversation} title={title} myUserId={user.id} />
      {unlocked ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <MessageList conversationId={conversationId} me={user} minReadableKeyVersion={minReadableKeyVersion} unreadAtOpen={unreadAtOpen} />
            <TypingIndicator conversationId={conversationId} />
            <Composer conversation={conversation} me={user} title={title} />
          </div>
          {threadRootId && <ThreadPanel conversation={conversation} rootId={threadRootId} me={user} minReadableKeyVersion={minReadableKeyVersion} />}
        </div>
      ) : (
        <PasscodeLockScreen conversation={conversation} title={title} />
      )}
    </div>
  );
}
