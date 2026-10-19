import { Badge, IconButton, Tooltip } from "../../ui";
import { LockIcon, SettingsIcon } from "../../ui/icons";
import { useE2EEStore } from "../../stores/e2eeStore";
import { useProfilesStore } from "../../stores/profilesStore";
import type { Conversation } from "../conversations/conversationsStore";
import { ConversationAvatar } from "../conversations/ConversationAvatar";
import { dmPartner } from "../conversations/selectors";
import { PinnedPopover, SearchPopover } from "./HeaderPopovers";
import { useDialogStore } from "../chat-settings/dialogStore";

const presenceLabel: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Offline"
};

/**
 * Title, who/what this is, and the encryption state. Deliberately plain: no
 * backdrop-blur, and any popover hung off it is portalled, so nothing it opens can
 * end up under the message list again.
 */
export function ChatHeader({ conversation, title, myUserId }: { conversation: Conversation; title: string; myUserId: string }) {
  const partner = dmPartner(conversation, myUserId);
  const partnerProfile = useProfilesStore((s) => (partner ? s.byId[partner.id] : undefined));
  const hasKey = useE2EEStore((s) => Boolean(s.secretKeyByConversationId[conversation.id]));
  const keyLoading = useE2EEStore((s) => Boolean(s.loadingByConversationId[conversation.id]));
  const keyError = useE2EEStore((s) => s.errorByConversationId[conversation.id] ?? null);

  const subtitle =
    conversation.type === "dm"
      ? [partner ? `@${partner.username}` : null, partnerProfile?.statusText || (partnerProfile?.presence ? presenceLabel[partnerProfile.presence] : null)]
          .filter(Boolean)
          .join(" · ")
      : `${conversation.members.length} members`;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-orbit-raised px-4">
      <ConversationAvatar conversation={conversation} myUserId={myUserId} title={title} />
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-1.5 truncate text-sm font-bold">
          {title}
          {conversation.passcodeEnabled && <LockIcon className="h-3 w-3 text-orbit-muted" aria-label="Passcode protected" />}
        </h1>
        <p className="truncate text-xs text-orbit-muted">
          {partnerProfile?.statusEmoji && <span className="mr-1">{partnerProfile.statusEmoji}</span>}
          {subtitle}
        </p>
      </div>
      <div className="flex items-center gap-0.5">
        <SearchPopover conversationId={conversation.id} />
        <PinnedPopover conversationId={conversation.id} />
        <Tooltip content="Chat settings">
          <IconButton label="Chat settings" size="sm" onClick={() => useDialogStore.getState().open({ kind: "chatSettings", conversationId: conversation.id })}>
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </div>
      {hasKey ? (
        <Tooltip content="Messages are encrypted on your device before they're sent.">
          <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60">
            <Badge tone="accent">
              <LockIcon className="h-2.5 w-2.5" /> Encrypted
            </Badge>
          </span>
        </Tooltip>
      ) : keyLoading ? (
        <Badge>Setting up encryption…</Badge>
      ) : (
        <Tooltip content={keyError ?? "This device doesn't have the key for this conversation."}>
          <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-danger/60">
            <Badge tone="danger">Encryption unavailable</Badge>
          </span>
        </Tooltip>
      )}
    </header>
  );
}
