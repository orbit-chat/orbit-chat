import { useState } from "react";
import { LockIcon } from "../../ui/icons";
import { useAuthStore } from "../../stores/authStore";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useConversationsStore } from "../conversations/conversationsStore";
import { conversationTitle } from "../conversations/selectors";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { useOpenConversation } from "./useOpenConversation";

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
  useOpenConversation(conversationId, unlocked);

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
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader conversation={conversation} title={title} myUserId={user.id} />
      {unlocked ? (
        <MessageList conversationId={conversationId} me={user} minReadableKeyVersion={minReadableKeyVersion} unreadAtOpen={unreadAtOpen} />
      ) : (
        <LockedPanel title={title} />
      )}
      <footer className="shrink-0 border-t border-white/10 bg-orbit-raised px-4 py-3">
        <div className="flex h-10 items-center rounded-xl border border-white/10 bg-orbit-panelAlt px-3 text-sm text-orbit-muted">
          {unlocked ? "The composer arrives in Phase 4." : "Unlock this chat to send messages."}
        </div>
      </footer>
    </div>
  );
}

/** Phase 6 adds the passcode form and recovery-code bypass here. */
function LockedPanel({ title }: { title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-xs text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] text-orbit-muted">
          <LockIcon className="h-6 w-6" />
        </span>
        <h2 className="mt-4 text-base font-bold">{title} is locked</h2>
        <p className="mt-1 text-sm text-orbit-muted">Enter the chat passcode to read it. The unlock form arrives in Phase 6.</p>
      </div>
    </div>
  );
}
