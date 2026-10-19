import { Dialog } from "../../ui";
import { useAuthStore } from "../../stores/authStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useConversationsStore } from "../conversations/conversationsStore";
import { conversationTitle } from "../conversations/selectors";
import { AddMembersDialog, CreateGroupDialog } from "../groups/GroupDialogs";
import { ChatSettingsDialog } from "./ChatSettingsDialog";
import { DeleteOrLeaveDialog } from "./DeleteOrLeaveDialog";
import { useDialogStore } from "./dialogStore";
import { PasscodeRevealDialog } from "./PasscodeRevealDialog";

/**
 * Renders the one open app dialog. Keyed by kind + conversation so switching from
 * settings to "add people" starts the next dialog fresh. A dialog whose conversation
 * disappears (deleted elsewhere) simply closes.
 */
export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const close = useDialogStore((s) => s.close);
  const conversationId = current && "conversationId" in current ? current.conversationId : null;
  const conversation = useConversationsStore((s) => (conversationId ? s.conversations.find((c) => c.id === conversationId) : undefined));
  const myUserId = useAuthStore((s) => s.user?.id ?? "");
  const profiles = useProfilesStore((s) => s.byId);

  const missing = Boolean(conversationId && !conversation);
  const open = Boolean(current) && !missing;
  const title = conversation ? conversationTitle(conversation, myUserId, profiles) : "";

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        {open && current?.kind === "createGroup" && <CreateGroupDialog key="createGroup" />}
        {open && conversation && current?.kind === "chatSettings" && <ChatSettingsDialog key={`settings:${conversation.id}`} conversation={conversation} title={title} />}
        {open && conversation && current?.kind === "deleteOrLeave" && <DeleteOrLeaveDialog key={`delete:${conversation.id}`} conversation={conversation} title={title} />}
        {open && conversation && current?.kind === "addMembers" && <AddMembersDialog key={`add:${conversation.id}`} conversation={conversation} />}
      </Dialog>
      <PasscodeRevealDialog />
    </>
  );
}
