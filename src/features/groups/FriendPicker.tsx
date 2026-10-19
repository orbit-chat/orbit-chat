import { useMemo, useState } from "react";
import { Avatar, Input, cn } from "../../ui";
import { CheckIcon, CloseIcon, SearchIcon } from "../../ui/icons";
import { useFriends } from "../friends/friendsQueries";

export type PickedPerson = { id: string; username: string };

/** Search-and-tick list of your friends, with the picked ones shown as removable chips. */
export function FriendPicker({
  selected,
  onChange,
  exclude = []
}: {
  selected: PickedPerson[];
  onChange: (next: PickedPerson[]) => void;
  /** User ids that can't be picked (e.g. people already in the group). */
  exclude?: string[];
}) {
  const [query, setQuery] = useState("");
  const friends = useFriends();
  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (friends.data?.friends ?? [])
      .map((f) => f.user)
      .filter((u) => !exclude.includes(u.id))
      .filter((u) => !q || u.username.toLowerCase().includes(q) || u.displayName?.toLowerCase().includes(q));
  }, [friends.data, exclude, query]);
  const isPicked = (id: string) => selected.some((p) => p.id === id);
  const toggle = (person: PickedPerson) => onChange(isPicked(person.id) ? selected.filter((p) => p.id !== person.id) : [...selected, person]);

  return (
    <div>
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Selected people">
          {selected.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-full border border-orbit-accent/40 bg-orbit-accent/10 py-0.5 pl-2 pr-1 text-xs">
              @{p.username}
              <button
                type="button"
                aria-label={`Remove ${p.username}`}
                onClick={() => toggle(p)}
                className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-orbit-muted" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search friends" aria-label="Search friends" className="h-8 pl-8 text-[13px]" />
      </div>
      <ul className="-mx-1 mt-2 max-h-60 overflow-y-auto" role="listbox" aria-multiselectable="true" aria-label="Friends">
        {people.map((person) => {
          const picked = isPicked(person.id);
          const name = person.displayName?.trim() || person.username;
          return (
            <li key={person.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={picked}
                onClick={() => toggle({ id: person.id, username: person.username })}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orbit-accent/60"
                )}
              >
                <Avatar name={name} src={person.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{name}</span>
                  <span className="block truncate text-[11px] text-orbit-muted">@{person.username}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md border transition-colors",
                    picked ? "border-orbit-accent bg-orbit-accent text-slate-950" : "border-white/20"
                  )}
                >
                  {picked && <CheckIcon className="h-3.5 w-3.5" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {friends.isLoading && <p className="py-4 text-center text-xs text-orbit-muted">Loading friends…</p>}
      {!friends.isLoading && people.length === 0 && (
        <p className="py-4 text-center text-xs text-orbit-muted">{query ? "No friends match." : "No friends to add. Only friends can be added to groups."}</p>
      )}
    </div>
  );
}
