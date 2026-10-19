import { useState, type ReactNode } from "react";
import {
  Avatar,
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  CountBadge,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  cn
} from "../../ui";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChatIcon,
  CopyIcon,
  HomeIcon,
  MoreIcon,
  PinIcon,
  ReplyIcon,
  SettingsIcon,
  SmileIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon
} from "../../ui/icons";
import { useNavigationStore, type Page, type SettingsSection } from "../../stores/navigationStore";

/**
 * Phase 0 dev gallery: every primitive in one place, plus live reproductions of the
 * two bugs that motivated the rework so the fixes can be checked by hand.
 */
export function DevGallery() {
  const route = useNavigationStore((s) => s.route);

  return (
    <div className="flex min-h-0 flex-1">
      <DemoRail />
      <main className="flex min-h-0 flex-1 flex-col bg-orbit-canvas">
        <RouteBar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {route.page === "settings" ? <SettingsDemo section={route.section} /> : <PrimitivesDemo />}
        </div>
      </main>
    </div>
  );
}

/* ─── Navigation (bug 1: settings had to be closed manually) ─── */

const railItems: Array<{ page: Page; label: string; icon: ReactNode }> = [
  { page: "home", label: "Home", icon: <HomeIcon /> },
  { page: "dm", label: "DMs", icon: <ChatIcon /> },
  { page: "groups", label: "Groups", icon: <UsersIcon /> },
  { page: "friends", label: "Friends", icon: <UserPlusIcon /> },
  { page: "archive", label: "Archive", icon: <ArchiveIcon /> }
];

function DemoRail() {
  const page = useNavigationStore((s) => s.route.page);
  const goToPage = useNavigationStore((s) => s.goToPage);
  const openSettings = useNavigationStore((s) => s.openSettings);

  return (
    <nav aria-label="Main" className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 border-r border-white/10 bg-orbit-panelAlt py-3">
      {railItems.map((item) => (
        <RailButton key={item.page} active={page === item.page} label={item.label} onClick={() => goToPage(item.page)}>
          {item.icon}
        </RailButton>
      ))}
      <div className="flex-1" />
      <RailButton active={page === "settings"} label="Settings" onClick={() => openSettings()}>
        <SettingsIcon />
      </RailButton>
    </nav>
  );
}

function RailButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-[60px] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
        active ? "bg-orbit-accent/15 text-orbit-accent" : "text-orbit-muted hover:bg-white/[0.06] hover:text-orbit-text"
      )}
    >
      {children}
      {label}
    </button>
  );
}

function RouteBar() {
  const route = useNavigationStore((s) => s.route);
  const canBack = useNavigationStore((s) => s.past.length > 0);
  const canForward = useNavigationStore((s) => s.future.length > 0);
  const back = useNavigationStore((s) => s.back);
  const forward = useNavigationStore((s) => s.forward);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-orbit-raised/85 px-3 backdrop-blur">
      <IconButton label="Back" size="sm" disabled={!canBack} onClick={back}>
        <ArrowLeftIcon />
      </IconButton>
      <IconButton label="Forward" size="sm" disabled={!canForward} onClick={forward}>
        <ArrowRightIcon />
      </IconButton>
      <code className="ml-2 rounded-md bg-black/25 px-2 py-1 font-mono text-[11px] text-orbit-muted">{JSON.stringify(route)}</code>
    </header>
  );
}

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "privacy", label: "Privacy" },
  { id: "keybinds", label: "Keybinds" },
  { id: "updates", label: "Updates" },
  { id: "about", label: "About" }
];

function SettingsDemo({ section }: { section: SettingsSection }) {
  const openSettings = useNavigationStore((s) => s.openSettings);
  return (
    <div className="mx-auto flex max-w-4xl gap-6 p-6">
      <nav aria-label="Settings sections" className="w-44 shrink-0 space-y-1">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => openSettings(s.id)}
            aria-current={section === s.id ? "page" : undefined}
            className={cn(
              "block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
              section === s.id ? "bg-white/[0.08] text-orbit-text" : "text-orbit-muted hover:bg-white/[0.04] hover:text-orbit-text"
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <section className="flex-1 rounded-2xl border border-white/10 bg-orbit-panel/60 p-6">
        <h1 className="text-xl font-bold capitalize">{section}</h1>
        <p className="mt-2 text-sm text-orbit-muted">
          Settings is a route now. Click any item in the left rail and this page goes away. No Close button needed.
        </p>
      </section>
    </div>
  );
}

/* ─── Primitives ─── */

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-orbit-panel/50 p-5">
      <h2 className="text-sm font-bold">{title}</h2>
      {description && <p className="mt-1 text-xs text-orbit-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function PrimitivesDemo() {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-6 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <OverlayStackingDemo />
      </div>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
          <Tooltip content="Icon buttons always get a label">
            <IconButton label="Settings" variant="secondary">
              <SettingsIcon />
            </IconButton>
          </Tooltip>
        </div>
      </Section>

      <Section title="Badges and keys">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Pinned</Badge>
          <Badge tone="warning">Ping</Badge>
          <Badge tone="danger">Encryption unavailable</Badge>
          <CountBadge count={3} />
          <CountBadge count={140} />
          <span className="text-xs text-orbit-muted">
            <Kbd>Ctrl</Kbd> + <Kbd>E</Kbd>
          </span>
        </div>
      </Section>

      <Section title="Fields">
        <div className="space-y-3">
          <Field label="Display name" hint="Shown to everyone you chat with.">
            {(field) => <Input {...field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada" />}
          </Field>
          <Field label="Passcode" error={name.length > 0 && name.length < 3 ? "At least 3 characters." : null}>
            {(field) => <Input {...field} type="password" placeholder="••••" />}
          </Field>
        </div>
      </Section>

      <Section title="Avatars and tooltips">
        <div className="flex items-center gap-3">
          {(["online", "idle", "dnd", "offline"] as const).map((presence, i) => (
            <Tooltip key={presence} content={presence}>
              <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60">
                <Avatar name={["Ada", "Grace", "Linus", "Margaret"][i]!} presence={presence} size="lg" />
              </button>
            </Tooltip>
          ))}
          <Avatar name="Broken image" src="https://invalid.example/avatar.png" size="lg" />
        </div>
      </Section>

      <Section title="Menus" description="Keyboard: arrows, typeahead, Enter, Escape. Opening one closes any other.">
        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                Dropdown <MoreIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem icon={<ReplyIcon />}>Reply</DropdownMenuItem>
              <DropdownMenuItem icon={<PinIcon />} shortcut="P">
                Pin message
              </DropdownMenuItem>
              <DropdownMenuItem icon={<CopyIcon />}>Copy text</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<TrashIcon />} danger>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ContextMenu>
            <ContextMenuTrigger className="flex h-20 flex-1 items-center justify-center rounded-xl border border-dashed border-white/15 text-xs text-orbit-muted">
              Right-click here
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem icon={<PinIcon />}>Pin chat</ContextMenuItem>
              <ContextMenuItem icon={<ArchiveIcon />}>Archive</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem icon={<TrashIcon />} danger>
                Leave group
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      </Section>

      <Section title="Dialog" description="Focus is trapped; Escape and outside click close it unless a request is in flight.">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="danger">Leave group…</Button>
          </DialogTrigger>
          <DialogContent
            title="Leave group chat"
            description="You'll stop receiving messages from this group."
            dismissible={!busy}
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="ghost" disabled={busy}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    window.setTimeout(() => setBusy(false), 1500);
                  }}
                >
                  {busy ? "Leaving…" : "Leave"}
                </Button>
              </>
            }
          >
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked className="h-4 w-4 accent-[rgb(var(--orbit-accent))]" />
              Delete my messages from this group
            </label>
          </DialogContent>
        </Dialog>
      </Section>
    </div>
  );
}

/* ─── Bug 2: hover leaking under the pinned-messages popover ─── */

const demoMessages = [
  { id: "1", sender: "Ada", text: "Did the pinned popover ever cover these properly?" },
  { id: "2", sender: "Grace", text: "Not in the old UI. Hovering it lit up the reaction bar on whatever was underneath." },
  { id: "3", sender: "Linus", text: "The header's backdrop-blur trapped the popover in its own stacking context." },
  { id: "4", sender: "Margaret", text: "Now it's portalled to <body>. Open it and hover around; no toolbar should appear underneath." },
  { id: "5", sender: "Ada", text: "And the hover toolbar is plain CSS, so moving the mouse doesn't re-render the list." }
];

function OverlayStackingDemo() {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-orbit-canvas">
      <header className="flex items-center justify-between border-b border-white/10 bg-orbit-raised/85 px-4 py-2.5 backdrop-blur">
        <div>
          <p className="text-sm font-bold">Overlay stacking check</p>
          <p className="text-xs text-orbit-muted">This header uses backdrop-blur, like the old chat header.</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm">
              <PinIcon className="h-3.5 w-3.5" /> 2
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[22rem] p-2">
            <p className="border-b border-white/10 px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
              Pinned messages
            </p>
            {demoMessages.slice(0, 2).map((m) => (
              <button
                key={m.id}
                type="button"
                className="mt-1.5 block w-full rounded-xl border border-transparent bg-white/[0.03] px-3 py-2.5 text-left transition hover:border-orbit-accent/40 hover:bg-orbit-accent/10"
              >
                <p className="text-[11px] font-semibold text-orbit-accent">{m.sender}</p>
                <p className="line-clamp-2 text-xs text-slate-300">{m.text}</p>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </header>
      <div className="space-y-2 p-3">
        {demoMessages.map((m) => (
          <article key={m.id} className="group relative flex max-w-[85%] items-end gap-2">
            <Avatar name={m.sender} size="md" />
            <div className="min-w-0 rounded-xl border border-white/10 bg-orbit-bubble px-3 py-2 text-[13px] leading-snug">
              <p className="text-[11px] font-semibold text-orbit-accent">{m.sender}</p>
              <p className="mt-0.5 text-slate-200">{m.text}</p>
            </div>
            <div className="pointer-events-none absolute -top-3 left-12 flex items-center gap-0.5 rounded-full border border-white/10 bg-orbit-panelAlt px-1 py-0.5 opacity-0 shadow-lg transition-opacity duration-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
              <IconButton label="React" size="sm">
                <SmileIcon />
              </IconButton>
              <IconButton label="Reply" size="sm">
                <ReplyIcon />
              </IconButton>
              <IconButton label="More" size="sm">
                <MoreIcon />
              </IconButton>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
