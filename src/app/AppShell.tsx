import type { ReactNode } from "react";
import { ArchiveIcon, ChatIcon, HomeIcon, UserPlusIcon, UsersIcon } from "../ui/icons";
import { useMessagesStore } from "../stores/messagesStore";
import { useNavigationStore, type Route } from "../stores/navigationStore";
import { NavRail } from "../features/navigation/NavRail";
import { useNavigationShortcuts } from "../features/navigation/useNavigationShortcuts";
import { SettingsPage } from "../features/settings/SettingsPage";
import { ConversationSidebar } from "../features/conversations/ConversationSidebar";
import { useConversationsStore } from "../features/conversations/conversationsStore";
import { totalUnread } from "../features/conversations/selectors";
import { ChatView } from "../features/chat/ChatView";
import { useOutboxSync } from "../features/composer/useOutboxSync";
import { FriendsPage } from "../features/friends/FriendsPage";
import { useFriends } from "../features/friends/friendsQueries";
import { useRealtimeSync } from "../features/chat/useRealtimeSync";
import { DialogHost } from "../features/chat-settings/DialogHost";
import { useConversationSync } from "../features/conversations/useConversationSync";
import { ConnectionBanner } from "./ConnectionBanner";
import type { AppInfo } from "./useDesktop";

type ContentRoute = Exclude<Route, { page: "settings" }>;

/**
 * Signed-in layout: rail | sidebar | main. The route decides both the sidebar and
 * the main pane, so there is never a second flag that can disagree with it.
 * Settings takes over both columns.
 */
export function AppShell({ appInfo, updateStatus }: { appInfo: AppInfo; updateStatus: UpdaterStatusPayload | null }) {
  useNavigationShortcuts();
  useConversationSync();
  useOutboxSync();
  useRealtimeSync();
  const route = useNavigationStore((s) => s.route);
  const badges = useRailBadges();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConnectionBanner />
      <DialogHost />
      <div className="flex min-h-0 flex-1">
        <NavRail version={appInfo.version} badges={badges} />
        {route.page === "settings" ? (
          <SettingsPage section={route.section} appInfo={appInfo} updateStatus={updateStatus} />
        ) : route.page === "friends" ? (
          <FriendsPage />
        ) : (
          <>
            <ConversationSidebar page={route.page} selectedId={"conversationId" in route ? route.conversationId : null} />
            <main className="flex min-w-0 flex-1 flex-col bg-orbit-canvas">
              <MainPane route={route} />
            </main>
          </>
        )}
      </div>
    </div>
  );
}

/** Unread dots on the DM and Groups rail buttons, and a dot on Friends for incoming requests. */
function useRailBadges() {
  const conversations = useConversationsStore((s) => s.conversations);
  const unread = useMessagesStore((s) => s.unreadCountByConversation);
  const friends = useFriends();
  return {
    dm: totalUnread(conversations, unread, "dm") > 0,
    groups: totalUnread(conversations, unread, "group") > 0,
    friends: (friends.data?.requests.incoming.length ?? 0) > 0
  };
}

const pageMeta: Record<ContentRoute["page"], { title: string; icon: ReactNode; hint: string }> = {
  home: { title: "Home", icon: <HomeIcon />, hint: "Pick a chat from the list to start messaging." },
  dm: { title: "Direct messages", icon: <ChatIcon />, hint: "Pick a conversation, or start a new one." },
  groups: { title: "Groups", icon: <UsersIcon />, hint: "Pick a group to open it." },
  friends: { title: "Friends", icon: <UserPlusIcon />, hint: "Add friends by username and accept requests here." },
  archive: { title: "Archive", icon: <ArchiveIcon />, hint: "Archived chats stay here until you unarchive them." }
};

/** The open conversation, or the page's empty state. */
function MainPane({ route }: { route: ContentRoute }) {
  const conversationId = "conversationId" in route ? route.conversationId : null;
  if (conversationId) return <ChatView key={conversationId} conversationId={conversationId} />;

  const meta = pageMeta[route.page];
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orbit-accent/10 text-orbit-accent [&_svg]:h-6 [&_svg]:w-6">
          {meta.icon}
        </span>
        <h1 className="mt-4 text-lg font-bold">{meta.title}</h1>
        <p className="mt-1 text-sm text-orbit-muted">{meta.hint}</p>
      </div>
    </div>
  );
}
