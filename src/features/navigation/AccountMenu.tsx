import { useQueryClient } from "@tanstack/react-query";
import { Avatar, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, type Presence } from "../../ui";
import { ArrowRightIcon, SettingsIcon, UsersIcon } from "../../ui/icons";
import { useAuthStore } from "../../stores/authStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useSocketStore } from "../../stores/socketStore";
import { signOut } from "../auth/signOut";

/** Avatar at the bottom of the rail: who you're signed in as, settings and sign out. */
export function AccountMenu({ version }: { version: string }) {
  const user = useAuthStore((s) => s.user);
  const profile = useProfilesStore((s) => (user ? s.byId[user.id] : undefined));
  const connected = useSocketStore((s) => s.connectionState === "connected");
  const openSettings = useNavigationStore((s) => s.openSettings);
  const queryClient = useQueryClient();

  if (!user) return null;
  const displayName = profile?.displayName?.trim() || user.username;
  // While the socket is down, others can't see you as online either.
  const presence: Presence = connected ? (profile?.presence ?? "online") : "offline";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
        aria-label={`Account: ${displayName}`}
      >
        <Avatar name={displayName} src={profile?.avatarUrl} size="md" presence={presence} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={10} className="w-60">
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <Avatar name={displayName} src={profile?.avatarUrl} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="truncate text-[11px] text-orbit-muted">@{user.username}</p>
          </div>
        </div>
        {profile?.statusText && (
          <p className="truncate px-2.5 pb-2 text-xs text-orbit-muted">
            {profile.statusEmoji} {profile.statusText}
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<UsersIcon />} onSelect={() => openSettings("profile")}>
          Edit profile
        </DropdownMenuItem>
        <DropdownMenuItem icon={<SettingsIcon />} shortcut="Ctrl+," onSelect={() => openSettings()}>
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<ArrowRightIcon />} danger onSelect={() => signOut(queryClient)}>
          Sign out
        </DropdownMenuItem>
        <p className="px-2.5 pb-1 pt-2 text-[10px] text-orbit-muted/70">Orbit Chat {version}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
