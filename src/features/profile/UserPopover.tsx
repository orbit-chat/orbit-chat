import { useState, type ReactNode } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "../../ui";
import { useAuthStore } from "../../stores/authStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useFriendAction, useRelations } from "../friends/friendsQueries";
import { startDirectMessage } from "../conversations/startDirectMessage";
import { ProfileCard } from "./ProfileCard";

/**
 * Wraps a clickable element (avatar, name) so it opens that person's profile. Loads the
 * profile on first open. Portalled like every other popover.
 */
export function UserPopover({ userId, username, children }: { userId: string; username: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        const token = useAuthStore.getState().token;
        if (next && token) void useProfilesStore.getState().fetchProfile(userId, token);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80 border-0 bg-transparent shadow-2xl">
        {open && <UserPopoverBody userId={userId} username={username} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function UserPopoverBody({ userId, username, onDone }: { userId: string; username: string; onDone: () => void }) {
  const profile = useProfilesStore((s) => s.byId[userId]);
  const loading = useProfilesStore((s) => s.loadingById[userId]);
  return (
    <div aria-busy={loading && !profile}>
      <ProfileCard profile={profile} username={profile?.username ?? username} actions={<ProfileActions userId={userId} username={profile?.username ?? username} onDone={onDone} />} />
    </div>
  );
}

/** The right buttons for how you relate to this person. */
export function ProfileActions({ userId, username, onDone }: { userId: string; username: string; onDone?: () => void }) {
  const relationOf = useRelations();
  const friendAction = useFriendAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { relation, requestId } = relationOf(userId);

  if (relation === "self") {
    return (
      <Button
        size="sm"
        onClick={() => {
          useNavigationStore.getState().openSettings("profile");
          onDone?.();
        }}
      >
        Edit profile
      </Button>
    );
  }
  if (relation === "friend") {
    return (
      <span className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={async () => {
            const { user, token } = useAuthStore.getState();
            if (!user || !token) return;
            setBusy(true);
            setError(null);
            try {
              const conversation = await startDirectMessage({ target: { id: userId, username }, me: user, token });
              useNavigationStore.getState().openConversation(conversation);
              onDone?.();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't open the chat.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Opening…" : "Message"}
        </Button>
        {error && <span className="max-w-[10rem] text-right text-[10px] text-rose-300">{error}</span>}
      </span>
    );
  }
  if (relation === "incoming" && requestId) {
    return (
      <Button size="sm" variant="primary" disabled={friendAction.isPending} onClick={() => friendAction.mutate({ kind: "accept", requestId })}>
        Accept request
      </Button>
    );
  }
  if (relation === "outgoing" && requestId) {
    return (
      <Button size="sm" disabled={friendAction.isPending} onClick={() => friendAction.mutate({ kind: "cancel", requestId })}>
        Requested
      </Button>
    );
  }
  return (
    <Button size="sm" variant="primary" disabled={friendAction.isPending} onClick={() => friendAction.mutate({ kind: "send", userId })}>
      Add friend
    </Button>
  );
}
