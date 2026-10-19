import type { ReactNode } from "react";
import { ArchiveIcon, ChatIcon, HomeIcon, UserPlusIcon, UsersIcon } from "../ui/icons";
import { useNavigationStore, type Route } from "../stores/navigationStore";
import { NavRail } from "../features/navigation/NavRail";
import { useNavigationShortcuts } from "../features/navigation/useNavigationShortcuts";
import { SettingsPage } from "../features/settings/SettingsPage";
import { ConnectionBanner } from "./ConnectionBanner";
import type { AppInfo } from "./useDesktop";

/**
 * Signed-in layout: rail | sidebar | main. The route decides both the sidebar and
 * the main pane, so there is never a second flag that can disagree with it.
 * Settings takes over both columns.
 */
export function AppShell({ appInfo, updateStatus }: { appInfo: AppInfo; updateStatus: UpdaterStatusPayload | null }) {
  useNavigationShortcuts();
  const route = useNavigationStore((s) => s.route);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        <NavRail version={appInfo.version} />
        {route.page === "settings" ? (
          <SettingsPage section={route.section} appInfo={appInfo} updateStatus={updateStatus} />
        ) : (
          <>
            <Sidebar route={route} />
            <main className="flex min-w-0 flex-1 flex-col bg-orbit-canvas">
              <MainPane route={route} />
            </main>
          </>
        )}
      </div>
    </div>
  );
}

const pageMeta: Record<Exclude<Route["page"], "settings">, { title: string; icon: ReactNode; empty: string; hint: string }> = {
  home: { title: "Home", icon: <HomeIcon />, empty: "Your recent chats will show here.", hint: "Pick a chat from the list to start messaging." },
  dm: { title: "Direct messages", icon: <ChatIcon />, empty: "Your direct messages will show here.", hint: "Pick a conversation, or start one from Friends." },
  groups: { title: "Groups", icon: <UsersIcon />, empty: "Your group chats will show here.", hint: "Pick a group, or create a new one." },
  friends: { title: "Friends", icon: <UserPlusIcon />, empty: "Friend requests and your friends list will show here.", hint: "Add friends by username and accept requests here." },
  archive: { title: "Archive", icon: <ArchiveIcon />, empty: "Chats you archive will show here.", hint: "Archived chats stay here until you unarchive them." }
};

/** Phase 1 placeholder; conversation lists land in Phase 2, friends in Phase 7. */
function Sidebar({ route }: { route: Exclude<Route, { page: "settings" }> }) {
  const meta = pageMeta[route.page];
  return (
    <aside aria-label={meta.title} className="flex w-[300px] shrink-0 flex-col border-r border-white/10 bg-orbit-sidebar">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-4">
        <span className="text-orbit-muted">{meta.icon}</span>
        <h2 className="text-sm font-bold">{meta.title}</h2>
      </header>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-orbit-muted">{meta.empty}</div>
    </aside>
  );
}

/** Phase 1 placeholder for the main pane. */
function MainPane({ route }: { route: Exclude<Route, { page: "settings" }> }) {
  const conversationId = "conversationId" in route ? route.conversationId : null;
  const meta = pageMeta[route.page];
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orbit-accent/10 text-orbit-accent [&_svg]:h-6 [&_svg]:w-6">
          {meta.icon}
        </span>
        <h1 className="mt-4 text-lg font-bold">{conversationId ? "Conversation" : meta.title}</h1>
        <p className="mt-1 text-sm text-orbit-muted">
          {conversationId ? `Conversation ${conversationId} opens here in Phase 3.` : meta.hint}
        </p>
      </div>
    </div>
  );
}
