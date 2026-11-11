import { useState } from "react";
import { Badge, IconButton, Tooltip } from "../../ui";
import { ArrowLeftIcon, LockIcon, SettingsIcon, ShieldIcon } from "../../ui/icons";
import { SafetyNumberDialog } from "./SafetyNumberDialog";
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
export function ChatHeader({ conversation, title, myUserId, onBack }: { conversation: Conversation; title: string; myUserId: string; onBack?: () => void }) {
  const [verifying, setVerifying] = useState(false);
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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 bg-orbit-raised px-2 sm:gap-3 sm:px-4">
      {onBack && (
        <IconButton label="Back to chats" size="sm" onClick={onBack} className="-ml-1">
          <ArrowLeftIcon />
        </IconButton>
      )}
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
        {/* Phones keep the header to what fits beside the name; pins stay reachable from the message menu. */}
        <span className="hidden sm:contents">
          <PinnedPopover conversationId={conversation.id} />
        </span>
        {partner && (
          <Tooltip content="Verify security key">
            <IconButton label="Verify security key" size="sm" onClick={() => setVerifying(true)}>
              <ShieldIcon />
            </IconButton>
          </Tooltip>
        )}
        {partner && verifying && (
          <SafetyNumberDialog userId={partner.id} username={partner.username} open onOpenChange={setVerifying} />
        )}
        <Tooltip content="Chat settings">
          <IconButton label="Chat settings" size="sm" onClick={() => useDialogStore.getState().open({ kind: "chatSettings", conversationId: conversation.id })}>
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </div>
      {hasKey ? (
        <Tooltip content="Messages are encrypted on your device before they're sent.">
          <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60">
            <Badge tone="accent" aria-label="Encrypted">
              <LockIcon className="h-2.5 w-2.5" /> <span className="hidden sm:inline">Encrypted</span>
            </Badge>
          </span>
        </Tooltip>
      ) : keyLoading ? (
        <Badge>
          <span className="hidden sm:inline">Setting up encryption…</span>
          <span className="sm:hidden">…</span>
        </Badge>
      ) : (
        <Tooltip content={keyError ?? "This device doesn't have the key for this conversation."}>
          <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-danger/60">
            <Badge tone="danger" aria-label="Encryption unavailable">
              <LockIcon className="h-2.5 w-2.5" /> <span className="hidden sm:inline">Encryption unavailable</span>
            </Badge>
          </span>
        </Tooltip>
      )}
    </header>
  );
}
