import type { ReactNode } from "react";
import { cn } from "../../ui";
import { ChatIcon, HomeIcon, SettingsIcon, UserPlusIcon, UsersIcon } from "../../ui/icons";
import { useNavigationStore, type Page } from "../../stores/navigationStore";
import { listRoute } from "../../app/AppShell";

const items: Array<{ page: Page; label: string; icon: ReactNode }> = [
  { page: "home", label: "Home", icon: <HomeIcon className="h-5 w-5" /> },
  { page: "dm", label: "DMs", icon: <ChatIcon className="h-5 w-5" /> },
  { page: "groups", label: "Groups", icon: <UsersIcon className="h-5 w-5" /> },
  { page: "friends", label: "Friends", icon: <UserPlusIcon className="h-5 w-5" /> },
  { page: "settings", label: "Settings", icon: <SettingsIcon className="h-5 w-5" /> }
];

/**
 * The nav rail on phones (mobile plan M2): the same routes as a bottom bar, above the home
 * indicator. Archive is reached from the Home list on small screens.
 */
export function BottomTabBar({ badges }: { badges?: Partial<Record<Page, boolean>> }) {
  const page = useNavigationStore((s) => s.route.page);
  const navigate = useNavigationStore((s) => s.navigate);
  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 items-stretch justify-around border-t border-white/10 bg-orbit-panelAlt pb-[env(safe-area-inset-bottom)]"
    >
      {items.map((item) => {
        const active = page === item.page || (item.page === "home" && page === "archive");
        return (
          <button
            key={item.page}
            type="button"
            // A tab shows its list; on a phone, reopening the last chat behind the tab would skip it.
            onClick={() => navigate(listRoute(item.page))}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orbit-accent/60",
              active ? "text-orbit-accent" : "text-orbit-muted"
            )}
          >
            {item.icon}
            <span aria-hidden="true">{item.label}</span>
            {badges?.[item.page] && <span aria-label="Unread" className="absolute right-[calc(50%-16px)] top-2 h-2 w-2 rounded-full bg-orbit-danger" />}
          </button>
        );
      })}
    </nav>
  );
}
