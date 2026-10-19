import type { ReactNode } from "react";
import { Tooltip, cn } from "../../ui";
import { ArchiveIcon, ChatIcon, HomeIcon, SettingsIcon, UserPlusIcon, UsersIcon } from "../../ui/icons";
import { useNavigationStore, type Page } from "../../stores/navigationStore";
import { AccountMenu } from "./AccountMenu";

const items: Array<{ page: Page; label: string; icon: ReactNode }> = [
  { page: "home", label: "Home", icon: <HomeIcon className="h-[18px] w-[18px]" /> },
  { page: "dm", label: "DMs", icon: <ChatIcon className="h-[18px] w-[18px]" /> },
  { page: "groups", label: "Groups", icon: <UsersIcon className="h-[18px] w-[18px]" /> },
  { page: "friends", label: "Friends", icon: <UserPlusIcon className="h-[18px] w-[18px]" /> },
  { page: "archive", label: "Archive", icon: <ArchiveIcon className="h-[18px] w-[18px]" /> }
];

/** Leftmost column. Every button is a route change, so it always replaces what's on screen. */
export function NavRail({ version, badges }: { version: string; badges?: Partial<Record<Page, boolean>> }) {
  const page = useNavigationStore((s) => s.route.page);
  const goToPage = useNavigationStore((s) => s.goToPage);

  return (
    <nav aria-label="Main" className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-orbit-panelAlt py-3">
      <img src="logo.png" alt="Orbit Chat" className="mb-3 h-9 w-9 rounded-xl object-cover ring-1 ring-white/15" />
      {items.map((item) => (
        <RailButton
          key={item.page}
          label={item.label}
          active={page === item.page}
          badge={badges?.[item.page]}
          onClick={() => goToPage(item.page)}
        >
          {item.icon}
        </RailButton>
      ))}
      <div className="flex-1" />
      <RailButton label="Settings" active={page === "settings"} onClick={() => goToPage("settings")}>
        <SettingsIcon className="h-[18px] w-[18px]" />
      </RailButton>
      <div className="mt-2">
        <AccountMenu version={version} />
      </div>
    </nav>
  );
}

function RailButton({
  label,
  active,
  badge,
  onClick,
  children
}: {
  label: string;
  active: boolean;
  badge?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
          active ? "bg-orbit-accent/15 text-orbit-accent" : "text-orbit-muted hover:bg-white/[0.06] hover:text-orbit-text"
        )}
      >
        {/* Active marker on the rail's left edge. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute -left-[14px] top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-orbit-accent transition-all duration-200",
            active ? "h-6 opacity-100" : "h-2 opacity-0 group-hover:opacity-50"
          )}
        />
        {children}
        {badge && (
          <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-orbit-panelAlt bg-orbit-accent" aria-label="Unread" />
        )}
      </button>
    </Tooltip>
  );
}
