import { Avatar, cn, type Presence } from "../../ui";
import { useProfilesStore } from "../../stores/profilesStore";
import type { Conversation } from "./conversationsStore";
import { dmPartner } from "./selectors";

/** DM: the partner's avatar with presence. Group: two overlapping member initials. */
export function ConversationAvatar({ conversation, myUserId, title }: { conversation: Conversation; myUserId: string; title: string }) {
  const partner = dmPartner(conversation, myUserId);
  const partnerProfile = useProfilesStore((s) => (partner ? s.byId[partner.id] : undefined));
  const firstOthers = conversation.members.filter((m) => m.user.id !== myUserId).slice(0, 2);
  const groupProfiles = useProfilesStore((s) => firstOthers.map((m) => s.byId[m.user.id]?.avatarUrl ?? null).join("|"));

  if (conversation.type === "dm") {
    const presence = (partnerProfile?.presence ?? undefined) as Presence | undefined;
    return <Avatar name={title} src={partnerProfile?.avatarUrl} size="md" presence={presence} />;
  }

  const avatars = groupProfiles.split("|");
  if (firstOthers.length < 2) return <Avatar name={title} src={avatars[0] || null} size="md" />;
  return (
    <span className="relative inline-flex h-9 w-9 shrink-0" aria-hidden="true">
      {firstOthers.map((member, i) => (
        <Avatar
          key={member.user.id}
          name={member.user.username}
          src={avatars[i] || null}
          size="xs"
          className={cn("absolute", i === 0 ? "left-0 top-0" : "bottom-0 right-0 [&>span]:ring-2 [&>span]:ring-orbit-sidebar")}
        />
      ))}
    </span>
  );
}
