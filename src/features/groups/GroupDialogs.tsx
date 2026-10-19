import { useState } from "react";
import { Alert, Button, DialogClose, DialogContent, Field, Input } from "../../ui";
import { useAuthStore } from "../../stores/authStore";
import { useNavigationStore } from "../../stores/navigationStore";
import type { Conversation } from "../conversations/conversationsStore";
import { useDialogStore } from "../chat-settings/dialogStore";
import { FriendPicker, type PickedPerson } from "./FriendPicker";
import { addGroupMembers, createGroup } from "./groupKeys";

function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function CreateGroupDialog() {
  const [name, setName] = useState("");
  const [members, setMembers] = useState<PickedPerson[]>([]);
  const { busy, error, run } = useAsyncAction();

  const create = () =>
    run(async () => {
      const { user, token } = useAuthStore.getState();
      if (!user || !token) throw new Error("You're signed out.");
      const conversation = await createGroup({ name, members, me: user, token });
      useDialogStore.getState().close();
      useNavigationStore.getState().openConversation(conversation);
    });

  return (
    <DialogContent
      title="New group"
      description="Everyone you add gets the group key, sealed to their device."
      dismissible={!busy}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="primary" disabled={busy || members.length === 0} onClick={create}>
            {busy ? "Creating…" : `Create group${members.length ? ` (${members.length + 1})` : ""}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Group name" hint="Optional. You can change it later.">
          {(field) => <Input {...field} autoFocus value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Weekend crew" />}
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Members</p>
          <FriendPicker selected={members} onChange={setMembers} />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </DialogContent>
  );
}

export function AddMembersDialog({ conversation }: { conversation: Conversation }) {
  const [members, setMembers] = useState<PickedPerson[]>([]);
  const { busy, error, run } = useAsyncAction();

  const add = () =>
    run(async () => {
      const { user, token } = useAuthStore.getState();
      if (!user || !token) throw new Error("You're signed out.");
      await addGroupMembers({ conversation, members, me: user, token });
      useDialogStore.getState().close();
    });

  return (
    <DialogContent
      title="Add people"
      description="The group key changes, so new members can only read messages sent from now on."
      dismissible={!busy}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="primary" disabled={busy || members.length === 0} onClick={add}>
            {busy ? "Adding…" : `Add${members.length ? ` ${members.length}` : ""}`}
          </Button>
        </>
      }
    >
      <FriendPicker selected={members} onChange={setMembers} exclude={conversation.members.map((m) => m.userId)} />
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </DialogContent>
  );
}
