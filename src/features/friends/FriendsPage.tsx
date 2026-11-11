import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Avatar, Button, CountBadge, Dialog, DialogClose, DialogContent, IconButton, Input, cn, type Presence } from "../../ui";
import { ArrowLeftIcon, InboxIcon, SearchIcon, UserPlusIcon } from "../../ui/icons";
import * as api from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useAuthStore } from "../../stores/authStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { ProfileActions } from "../profile/UserPopover";
import { ProfileCard } from "../profile/ProfileCard";
import { useFriendAction, useFriends } from "./friendsQueries";

type View = { kind: "requests" } | { kind: "add" } | { kind: "friend"; userId: string };

/** Friends list on the left; requests, adding people, or a friend's profile on the right. */
export function FriendsPage({ compact = false }: { /** Phones: the list first, then the chosen panel with a back button. */ compact?: boolean }) {
  const friends = useFriends();
  const incoming = friends.data?.requests.incoming ?? [];
  // Until you pick something, show requests if any are waiting (decided once the data has loaded).
  const [chosen, setView] = useState<View | null>(null);
  const view: View = chosen ?? { kind: incoming.length ? "requests" : "add" };
  const showList = compact && chosen === null;

  return (
    <div className="flex min-h-0 flex-1">
      {(!compact || showList) && <FriendsList view={view} onView={setView} compact={compact} />}
      <main className={cn("flex min-w-0 flex-1 flex-col overflow-y-auto bg-orbit-canvas", showList && "hidden")}>
        {compact && (
          <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-orbit-canvas px-2">
            <IconButton label="Back to friends" size="sm" onClick={() => setView(null)}>
              <ArrowLeftIcon />
            </IconButton>
          </div>
        )}
        {friends.isError && (
          <Alert tone="danger" className="m-6">
            Couldn't load friends. {friends.error.message}
          </Alert>
        )}
        {view.kind === "requests" && <RequestsPanel onAdd={() => setView({ kind: "add" })} />}
        {view.kind === "add" && <AddFriendPanel />}
        {view.kind === "friend" && <FriendProfile userId={view.userId} onRemoved={() => setView({ kind: "requests" })} />}
      </main>
    </div>
  );
}

function presenceRank(p: Presence | null | undefined) {
  return p === "online" ? 0 : p === "idle" ? 1 : p === "dnd" ? 2 : 3;
}

function FriendsList({ view, onView, compact = false }: { view: View; onView: (view: View) => void; compact?: boolean }) {
  const friends = useFriends();
  const [filter, setFilter] = useState("");
  const pending = (friends.data?.requests.incoming.length ?? 0) + (friends.data?.requests.outgoing.length ?? 0);
  const incoming = friends.data?.requests.incoming.length ?? 0;

  const { online, offline } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (friends.data?.friends ?? [])
      .map((f) => f.user)
      .filter((u) => !q || u.username.toLowerCase().includes(q) || u.displayName?.toLowerCase().includes(q))
      .sort((a, b) => presenceRank(a.presence) - presenceRank(b.presence) || (a.displayName || a.username).localeCompare(b.displayName || b.username));
    return { online: list.filter((u) => u.presence && u.presence !== "offline"), offline: list.filter((u) => !u.presence || u.presence === "offline") };
  }, [friends.data, filter]);

  const navButton = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orbit-accent/60",
      active ? "bg-white/[0.08]" : "text-slate-300 hover:bg-white/[0.04]"
    );

  return (
    <aside aria-label="Friends" className={cn("flex shrink-0 flex-col bg-orbit-sidebar", compact ? "min-w-0 flex-1" : "w-[300px] border-r border-white/10")}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-4">
        <span className="text-orbit-muted">
          <UserPlusIcon />
        </span>
        <h2 className="flex-1 text-sm font-bold">Friends</h2>
        <span className="text-xs text-orbit-muted">{friends.data?.friends.length ?? 0}</span>
      </header>
      <div className="space-y-0.5 p-2">
        <button type="button" className={navButton(view.kind === "add")} onClick={() => onView({ kind: "add" })} aria-current={view.kind === "add" ? "page" : undefined}>
          <UserPlusIcon className="h-4 w-4 text-orbit-muted" /> Add friend
        </button>
        <button type="button" className={navButton(view.kind === "requests")} onClick={() => onView({ kind: "requests" })} aria-current={view.kind === "requests" ? "page" : undefined}>
          <InboxIcon className="h-4 w-4 text-orbit-muted" />
          <span className="flex-1">Requests</span>
          {incoming > 0 ? <CountBadge count={incoming} /> : pending > 0 && <span className="text-xs text-orbit-muted">{pending}</span>}
        </button>
      </div>
      <div className="px-3 pb-1">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-orbit-muted" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter friends" aria-label="Filter friends" className="h-8 pl-8 text-[13px]" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {friends.isLoading && <p className="p-4 text-center text-xs text-orbit-muted">Loading friends…</p>}
        {[
          { label: "Online", people: online },
          { label: "Offline", people: offline }
        ].map(
          (group) =>
            group.people.length > 0 && (
              <section key={group.label} className="mt-2">
                <h3 className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-orbit-muted">
                  {group.label} — {group.people.length}
                </h3>
                {group.people.map((person) => (
                  <FriendRow key={person.id} person={person} selected={view.kind === "friend" && view.userId === person.id} onSelect={() => onView({ kind: "friend", userId: person.id })} />
                ))}
              </section>
            )
        )}
        {friends.isSuccess && !friends.data.friends.length && (
          <p className="px-4 py-8 text-center text-xs text-orbit-muted">No friends yet. Use Add friend to find people by username.</p>
        )}
      </div>
    </aside>
  );
}

function FriendRow({ person, selected, onSelect }: { person: api.FriendSummary; selected: boolean; onSelect: () => void }) {
  const name = person.displayName?.trim() || person.username;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orbit-accent/60",
        selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
        (!person.presence || person.presence === "offline") && !selected && "opacity-70"
      )}
    >
      <Avatar name={name} src={person.avatarUrl} size="md" presence={(person.presence ?? "offline") as Presence} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{name}</span>
        <span className="block truncate text-[11px] text-orbit-muted">
          {person.statusEmoji && `${person.statusEmoji} `}
          {person.statusText || `@${person.username}`}
        </span>
      </span>
    </button>
  );
}

function PersonLine({ person, children }: { person: api.FriendSummary; children: React.ReactNode }) {
  const name = person.displayName?.trim() || person.username;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-orbit-panel/50 px-3 py-2.5">
      <Avatar name={name} src={person.avatarUrl} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="block truncate text-[11px] text-orbit-muted">@{person.username}</span>
      </span>
      <span className="flex gap-1.5">{children}</span>
    </li>
  );
}

function RequestsPanel({ onAdd }: { onAdd: () => void }) {
  const friends = useFriends();
  const action = useFriendAction();
  const incoming = friends.data?.requests.incoming ?? [];
  const outgoing = friends.data?.requests.outgoing ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-8 py-10">
      <header>
        <h1 className="text-xl font-bold">Friend requests</h1>
        <p className="mt-1 text-sm text-orbit-muted">Only friends can start a direct message with you or add you to a group.</p>
      </header>
      {action.isError && <Alert tone="danger">{action.error.message}</Alert>}
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Incoming — {incoming.length}</h2>
        <ul className="space-y-2" aria-label="Incoming requests">
          {incoming.map((request) => (
            <PersonLine key={request.id} person={request.user}>
              <Button size="sm" variant="primary" disabled={action.isPending} onClick={() => action.mutate({ kind: "accept", requestId: request.id })}>
                Accept
              </Button>
              <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ kind: "decline", requestId: request.id })}>
                Decline
              </Button>
            </PersonLine>
          ))}
        </ul>
        {!incoming.length && <p className="text-sm text-orbit-muted">No requests waiting for you.</p>}
      </section>
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Sent — {outgoing.length}</h2>
        <ul className="space-y-2" aria-label="Sent requests">
          {outgoing.map((request) => (
            <PersonLine key={request.id} person={request.user}>
              <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ kind: "cancel", requestId: request.id })}>
                Cancel
              </Button>
            </PersonLine>
          ))}
        </ul>
        {!outgoing.length && (
          <p className="text-sm text-orbit-muted">
            You haven't sent any.{" "}
            <button type="button" onClick={onAdd} className="text-orbit-accent hover:underline">
              Add a friend
            </button>
          </p>
        )}
      </section>
    </div>
  );
}

function AddFriendPanel() {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 300);
  const search = useQuery({
    queryKey: ["userSearch", debounced],
    enabled: debounced.length > 0,
    staleTime: 15_000,
    queryFn: () => api.searchUsers(debounced, useAuthStore.getState().token!)
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-10">
      <h1 className="text-xl font-bold">Add a friend</h1>
      <p className="mt-1 text-sm text-orbit-muted">Search by username. They'll need to accept before you can message them.</p>
      <div className="relative mt-5">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orbit-muted" />
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Username" aria-label="Search by username" className="h-11 pl-10" />
      </div>
      <ul className="mt-4 space-y-2" aria-label="People">
        {(search.data ?? []).map((person) => (
          <PersonLine key={person.id} person={person}>
            <ProfileActions userId={person.id} username={person.username} />
          </PersonLine>
        ))}
      </ul>
      {debounced && search.isFetching && !search.data && <p className="mt-4 text-sm text-orbit-muted">Searching…</p>}
      {debounced && search.data?.length === 0 && <p className="mt-4 text-sm text-orbit-muted">No one found for "{debounced}".</p>}
      {search.isError && (
        <Alert tone="danger" className="mt-4">
          Search failed. Check your connection and try again.
        </Alert>
      )}
    </div>
  );
}

function FriendProfile({ userId, onRemoved }: { userId: string; onRemoved: () => void }) {
  const friends = useFriends();
  const summary = friends.data?.friends.find((f) => f.user.id === userId)?.user;
  const profile = useProfilesStore((s) => s.byId[userId]);
  const myProfile = useProfilesStore((s) => s.byId[useAuthStore.getState().user?.id ?? ""]);
  const action = useFriendAction();
  const [confirming, setConfirming] = useState(false);
  // The friends list carries a summary; the full profile adds bio, banner and links.
  useEffect(() => {
    const token = useAuthStore.getState().token;
    if (token) void useProfilesStore.getState().fetchProfile(userId, token);
  }, [userId]);
  if (!summary) return <p className="p-8 text-sm text-orbit-muted">This person isn't in your friends list anymore.</p>;
  const name = summary.displayName?.trim() || summary.username;
  const wipes = myProfile?.deleteMessagesOnUnfriend ?? true;

  return (
    <div className="mx-auto w-full max-w-md px-8 py-10">
      <ProfileCard profile={{ ...summary, ...profile }} username={summary.username} actions={<ProfileActions userId={userId} username={summary.username} />} />
      <Button variant="ghost" size="sm" className="mt-4 text-orbit-danger" onClick={() => setConfirming(true)}>
        Remove friend
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title={`Remove ${name}?`}
          size="sm"
          dismissible={!action.isPending}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="ghost" disabled={action.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="danger"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(
                    { kind: "remove", userId },
                    {
                      onSuccess: () => {
                        setConfirming(false);
                        onRemoved();
                      }
                    }
                  )
                }
              >
                {action.isPending ? "Removing…" : "Remove friend"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-300">
            {wipes
              ? "Your messages and files in your direct chat will be deleted, as set in Privacy."
              : "Your direct chat stays, but you won't be able to start new ones until you're friends again."}
          </p>
          {action.isError && (
            <Alert tone="danger" className="mt-3">
              {action.error.message}
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
