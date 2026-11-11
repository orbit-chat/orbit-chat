import { useEffect, type ReactNode } from "react";
import { getPlatform } from "../platform";
import { useChatLockStore } from "../stores/chatLockStore";
import { ArchiveIcon, ChatIcon, HomeIcon, UserPlusIcon, UsersIcon } from "../ui/icons";
import { useMessagesStore } from "../stores/messagesStore";
import { routeConversationId, useNavigationStore, type Route } from "../stores/navigationStore";
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
import { useNotifications } from "../features/notifications/useNotifications";
import { usePushRegistration } from "../features/notifications/usePushRegistration";
import { useUserPrefs } from "../stores/prefsStore";
import { useRealtimeSync } from "../features/chat/useRealtimeSync";
import { DialogHost } from "../features/chat-settings/DialogHost";
import { useConversationSync } from "../features/conversations/useConversationSync";
import { ConnectionBanner } from "./ConnectionBanner";
import { PendingDeviceBanner } from "./PendingDeviceBanner";
import { BottomTabBar } from "../features/navigation/BottomTabBar";
import { useCompactLayout } from "../ui/useMediaQuery";
import type { AppInfo } from "./useDesktop";

type ContentRoute = Exclude<Route, { page: "settings" }>;

/**
 * Signed-in layout: rail | sidebar | main. The route decides both the sidebar and
 * the main pane, so there is never a second flag that can disagree with it.
 * Settings takes over both columns.
 *
 * Below the `md` breakpoint (phones, mobile plan M2) it shows one pane at a time, still driven
 * by the route: the list, or the open chat with a back button; the rail becomes a bottom tab bar,
 * hidden while a chat is open so the composer has the room.
 */
export function AppShell({ appInfo, updateStatus }: { appInfo: AppInfo; updateStatus: UpdaterStatusPayload | null }) {
  useNavigationShortcuts();
  useConversationSync();
  useOutboxSync();
  useRealtimeSync();
  useNotifications();
  usePushRegistration();
  const route = useNavigationStore((s) => s.route);
  const badges = useRailBadges();
  const compact = useCompactLayout();
  const conversationId = "conversationId" in route ? route.conversationId : null;
  useLockChatsInBackground();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <a
        href="#orbit-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-12 focus:z-tooltip focus:rounded-lg focus:bg-orbit-accent focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-slate-950"
        onClick={(event) => {
          event.preventDefault();
          const target = document.querySelector<HTMLElement>("textarea[data-main-composer]") ?? document.getElementById("orbit-main");
          target?.focus();
        }}
      >
        Skip to main content
      </a>
      <ConnectionBanner />
      <PendingDeviceBanner />
      <DialogHost />
      <div className="flex min-h-0 flex-1">
        {!compact && <NavRail version={appInfo.version} badges={badges} />}
        {route.page === "settings" ? (
          <SettingsPage section={route.section} appInfo={appInfo} updateStatus={updateStatus} compact={compact} />
        ) : route.page === "friends" ? (
          <FriendsPage compact={compact} />
        ) : compact ? (
          conversationId ? (
            <main id="orbit-main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col bg-orbit-canvas outline-none">
              <ChatView key={conversationId} conversationId={conversationId} onBack={() => backToList(route.page)} />
            </main>
          ) : (
            <ConversationSidebar page={route.page} selectedId={null} compact />
          )
        ) : (
          <>
            <ConversationSidebar page={route.page} selectedId={conversationId} />
            <main id="orbit-main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col bg-orbit-canvas outline-none">
              <MainPane route={route} />
            </main>
          </>
        )}
      </div>
      {compact && !conversationId && <BottomTabBar badges={badges} />}
    </div>
  );
}

/** Phones (M5): a chat set to lock when you leave it also locks when the app goes to the background. */
function useLockChatsInBackground() {
  useEffect(() => {
    const subscribe = getPlatform().onAppStateChange;
    if (!subscribe) return;
    return subscribe((active) => {
      if (active) return;
      const open = routeConversationId(useNavigationStore.getState().route);
      if (open) useChatLockStore.getState().onLeave(open);
    });
  }, []);
}

/** The list a page shows on a phone (no conversation open). */
export function listRoute(page: Route["page"]): Route {
  return page === "dm" || page === "groups" || page === "archive" ? { page, conversationId: null } : page === "friends" || page === "settings" ? routeForList(page) : { page: "home" };
}

function routeForList(page: "friends" | "settings"): Route {
  return page === "friends" ? { page } : { page, section: "profile" };
}

/** Phones: Back from a chat returns to the list you came from, or this page's list. */
function backToList(page: Route["page"]) {
  const nav = useNavigationStore.getState();
  const previous = nav.past[nav.past.length - 1];
  if (previous && previous.page !== "settings" && !routeConversationId(previous)) nav.back();
  else nav.navigate(listRoute(page));
}

/** Unread dots on the DM and Groups rail buttons, and a dot on Friends for incoming requests. */
function useRailBadges() {
  const conversations = useConversationsStore((s) => s.conversations);
  const unread = useMessagesStore((s) => s.unreadCountByConversation);
  const friends = useFriends();
  const muted = useUserPrefs().mutedConversationIds;
  // Muted chats still count as unread in the list, but don't light up the rail.
  const audible = conversations.filter((c) => !muted.includes(c.id));
  return {
    dm: totalUnread(audible, unread, "dm") > 0,
    groups: totalUnread(audible, unread, "group") > 0,
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
    <div key={route.page} className="flex flex-1 animate-orbit-fade-in items-center justify-center p-8">
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
