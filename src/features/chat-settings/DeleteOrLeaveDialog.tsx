import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DialogClose, DialogContent } from "../../ui";
import { useAuthStore } from "../../stores/authStore";
import type { Conversation } from "../conversations/conversationsStore";
import { friendsKey } from "../friends/friendsQueries";
import { deleteDirectMessage, leaveGroup } from "../groups/groupKeys";
import { useDialogStore } from "./dialogStore";

/** Delete a DM (and unfriend) or leave a group. Can't be dismissed while the request runs. */
export function DeleteOrLeaveDialog({ conversation, title }: { conversation: Conversation; title: string }) {
  const [wipe, setWipe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const isDm = conversation.type === "dm";

  const confirm = async () => {
    const { user, token } = useAuthStore.getState();
    if (!user || !token) return;
    setBusy(true);
    setError(null);
    try {
      if (isDm) {
        await deleteDirectMessage({ conversation, token });
        void queryClient.invalidateQueries({ queryKey: friendsKey });
      } else {
        await leaveGroup({ conversation, wipeMessages: wipe, me: user, token });
      }
      useDialogStore.getState().close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
      setBusy(false);
    }
  };

  return (
    <DialogContent
      title={isDm ? `Delete chat with ${title}?` : `Leave ${title}?`}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="danger" disabled={busy} onClick={confirm}>
            {busy ? (isDm ? "Deleting…" : "Leaving…") : isDm ? "Delete and unfriend" : "Leave group"}
          </Button>
        </>
      }
    >
      {isDm ? (
        <p className="text-sm text-slate-300">
          This deletes the chat for <strong>both of you</strong>, removes the friendship, and erases its messages and files from the server. It can't be
          undone.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-300">Others keep the group. If you're the last member, the group and everything in it is deleted.</p>
          <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--orbit-accent))]" />
            <span className="text-sm">
              Delete my messages and files from the group
              <span className="mt-0.5 block text-[11px] text-orbit-muted">{wipe ? "They'll be wiped from the server." : "Others will still see them."}</span>
            </span>
          </label>
        </>
      )}
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </DialogContent>
  );
}
