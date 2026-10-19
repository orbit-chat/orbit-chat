import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Avatar, Button, Dialog, DialogContent, Input, type Presence } from "../../ui";
import { SearchIcon } from "../../ui/icons";
import * as api from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useAuthStore } from "../../stores/authStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useFriendAction, useFriends, useRelations } from "../friends/friendsQueries";
import { startDirectMessage } from "./startDirectMessage";

type Person = { id: string; username: string; displayName?: string | null; avatarUrl?: string | null; presence?: Presence | null };

/**
 * Find someone and message them. With an empty query it lists your friends; typing
 * searches everyone. Non-friends get the friend-request action instead, since DMs are
 * between friends.
 */
export function NewMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [startingWith, setStartingWith] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const me = useAuthStore((s) => s.user);
  const friends = useFriends();
  const relationOf = useRelations();
  const friendAction = useFriendAction();
  const openConversation = useNavigationStore((s) => s.openConversation);

  const search = useQuery({
    queryKey: ["userSearch", debouncedQuery],
    enabled: open && debouncedQuery.length > 0,
    staleTime: 15_000,
    queryFn: () => api.searchUsers(debouncedQuery, useAuthStore.getState().token!)
  });

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setError(null);
    }
  };

  const message = async (person: Person) => {
    const token = useAuthStore.getState().token;
    if (!me || !token) return;
    setError(null);
    setStartingWith(person.id);
    try {
      const conversation = await startDirectMessage({ target: person, me, token });
      openConversation(conversation);
      close(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the conversation.");
    } finally {
      setStartingWith(null);
    }
  };

  const showingSearch = query.trim().length > 0;
  const people: Person[] = showingSearch ? (search.data ?? []) : (friends.data?.friends.map((f) => f.user) ?? []);
  const searching = showingSearch ? search.isFetching || debouncedQuery !== query.trim() : friends.isLoading;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title="New message" description="Message a friend, or find someone by username." size="md">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orbit-muted" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by username"
            aria-label="Search people"
            className="pl-9"
          />
        </div>

        {error && (
          <Alert tone="danger" className="mt-3">
            {error}
          </Alert>
        )}

        <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-orbit-muted">
          {showingSearch ? "People" : "Friends"}
        </p>
        <ul className="-mx-2 max-h-80 overflow-y-auto" aria-label={showingSearch ? "Search results" : "Friends"} aria-busy={searching}>
          {people.map((person) => {
            const { relation, requestId } = relationOf(person.id);
            const name = person.displayName?.trim() || person.username;
            return (
              <li key={person.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                <Avatar name={name} src={person.avatarUrl} size="sm" presence={person.presence ?? undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{name}</span>
                  <span className="block truncate text-[11px] text-orbit-muted">@{person.username}</span>
                </span>
                {relation === "self" && <span className="text-xs text-orbit-muted">You</span>}
                {relation === "friend" && (
                  <Button size="sm" variant="primary" disabled={startingWith !== null} onClick={() => void message(person)}>
                    {startingWith === person.id ? "Opening…" : "Message"}
                  </Button>
                )}
                {relation === "incoming" && requestId && (
                  <Button size="sm" variant="primary" disabled={friendAction.isPending} onClick={() => friendAction.mutate({ kind: "accept", requestId })}>
                    Accept request
                  </Button>
                )}
                {relation === "outgoing" && requestId && (
                  <Button size="sm" disabled={friendAction.isPending} onClick={() => friendAction.mutate({ kind: "cancel", requestId })}>
                    Cancel request
                  </Button>
                )}
                {relation === "none" && (
                  <Button size="sm" disabled={friendAction.isPending} onClick={() => friendAction.mutate({ kind: "send", userId: person.id })}>
                    Add friend
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        {!searching && people.length === 0 && (
          <p className="py-6 text-center text-sm text-orbit-muted">
            {showingSearch ? `No one found for "${query.trim()}".` : "No friends yet. Search for someone to send a request."}
          </p>
        )}
        {searching && people.length === 0 && (
          <p className="py-6 text-center text-sm text-orbit-muted">{showingSearch ? "Searching…" : "Loading friends…"}</p>
        )}
        {search.isError && <Alert tone="danger">Search failed. Check your connection and try again.</Alert>}
        {friendAction.isError && <Alert tone="danger" className="mt-2">{friendAction.error.message}</Alert>}
      </DialogContent>
    </Dialog>
  );
}
