import { useState } from "react";
import { Alert, Button } from "../../ui";
import { useProfilesStore } from "../../stores/profilesStore";
import type { Conversation } from "../conversations/conversationsStore";
import { useContactTrustStore, useConversationTrust } from "./contactTrust";
import { SafetyNumberDialog } from "./SafetyNumberDialog";

/**
 * Notices above the composer (mobile plan B6): a member's identity key changed (nothing is sealed
 * to them until the user reviews it), or a member added a new device (informational).
 */
export function IdentityNotices({ conversation, myUserId }: { conversation: Conversation; myUserId: string }) {
  const { changed, newDevices } = useConversationTrust(conversation, myUserId);
  const profiles = useProfilesStore((s) => s.byId);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const username = (userId: string) => conversation.members.find((m) => m.userId === userId)?.user.username ?? profiles[userId]?.username ?? "someone";

  if (!changed.length && !newDevices.length) return null;
  return (
    <div className="space-y-2 px-4 pb-2" aria-label="Security notices">
      {changed.map((userId) => (
        <Alert key={userId} tone="danger">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>@{username(userId)}'s security key changed. Nothing is sent to them until you review it.</span>
            <Button size="sm" onClick={() => setReviewing(userId)}>
              Review
            </Button>
          </span>
        </Alert>
      ))}
      {newDevices.map(({ userId, names }) => (
        <Alert key={userId}>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              @{username(userId)} added a new device: {names.join(", ")}.
            </span>
            <Button size="sm" variant="ghost" onClick={() => useContactTrustStore.getState().dismissNewDevices(userId)}>
              Dismiss
            </Button>
          </span>
        </Alert>
      ))}
      {reviewing && (
        <SafetyNumberDialog userId={reviewing} username={username(reviewing)} open onOpenChange={(open) => !open && setReviewing(null)} />
      )}
    </div>
  );
}
