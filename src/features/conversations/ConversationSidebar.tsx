import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Alert, Button, IconButton, Input, Tooltip } from "../../ui";
import { ArchiveIcon, ChatIcon, ComposeIcon, HomeIcon, SearchIcon, UsersIcon } from "../../ui/icons";
import { useAuthStore } from "../../stores/authStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useUserPrefs } from "../../stores/prefsStore";
import { ConversationItem } from "./ConversationItem";
import { useConversationsStore, type Conversation } from "./conversationsStore";
import { NewMessageDialog } from "./NewMessageDialog";
import { buildConversationLists, conversationTitle, matchesFilter } from "./selectors";

export type ConversationPage = "home" | "dm" | "groups" | "archive";

const meta: Record<ConversationPage, { title: string; icon: ReactNode; empty: string }> = {
  home: { title: "Home", icon: <HomeIcon />, empty: "No chats yet. Start one with someone you know." },
  dm: { title: "Direct messages", icon: <ChatIcon />, empty: "No direct messages yet." },
  groups: { title: "Groups", icon: <UsersIcon />, empty: "No group chats yet." },
  archive: { title: "Archive", icon: <ArchiveIcon />, empty: "Nothing archived. Right-click a chat and choose Archive to tuck it away here." }
};

/** Sidebar for the conversation pages: header, filter, then pinned and recent sections. */
export function ConversationSidebar({ page, selectedId }: { page: ConversationPage; selectedId: string | null }) {
  const myUserId = useAuthStore((s) => s.user?.id ?? "");
  const conversations = useConversationsStore((s) => s.conversations);
  const status = useConversationsStore((s) => s.status);
  const loadError = useConversationsStore((s) => s.error);
  const messagesByConversation = useMessagesStore((s) => s.byConversation);
  const profiles = useProfilesStore((s) => s.byId);
  const prefs = useUserPrefs();
  const openConversation = useNavigationStore((s) => s.openConversation);
  const [filter, setFilter] = useState("");
  const [composing, setComposing] = useState(false);

  const lists = useMemo(
    () =>
      buildConversationLists({
        conversations,
        messagesByConversation,
        pinnedIds: prefs.pinnedConversationIds,
        archivedIds: prefs.archivedConversationIds
      }),
    [conversations, messagesByConversation, prefs.pinnedConversationIds, prefs.archivedConversationIds]
  );

  const source = page === "home" ? lists.active : page === "dm" ? lists.dms : page === "groups" ? lists.groups : lists.archived;
  const visible = source.filter((c) => matchesFilter(c, conversationTitle(c, myUserId, profiles), filter));
  const pinnedSet = new Set(prefs.pinnedConversationIds);
  const pinned = page === "archive" ? [] : visible.filter((c) => pinnedSet.has(c.id));
  const rest = page === "archive" ? visible : visible.filter((c) => !pinnedSet.has(c.id));

  const onOpen = useCallback(
    (conversation: Conversation) => openConversation(conversation, { archived: page === "archive" }),
    [openConversation, page]
  );

  const canCompose = page === "home" || page === "dm";
  const info = meta[page];

  return (
    <aside aria-label={info.title} className="flex w-[300px] shrink-0 flex-col border-r border-white/10 bg-orbit-sidebar">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 pl-4 pr-2">
        <span className="text-orbit-muted">{info.icon}</span>
        <h2 className="flex-1 truncate text-sm font-bold">{info.title}</h2>
        {canCompose && (
          <Tooltip content="New message">
            <IconButton label="New message" size="sm" onClick={() => setComposing(true)}>
              <ComposeIcon />
            </IconButton>
          </Tooltip>
        )}
      </header>

      <div className="shrink-0 px-3 pb-1 pt-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-orbit-muted" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && filter) {
                event.preventDefault();
                setFilter("");
              }
            }}
            placeholder="Filter chats"
            aria-label="Filter chats"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" onKeyDown={moveFocusWithArrows}>
        {status === "loading" && conversations.length === 0 && <ListSkeleton />}

        {status === "error" && (
          <div className="p-2">
            <Alert tone="danger">
              {loadError ?? "Couldn't load chats."}
              <Button
                size="sm"
                className="mt-2"
                onClick={() => {
                  const token = useAuthStore.getState().token;
                  if (token) void useConversationsStore.getState().load(token);
                }}
              >
                Try again
              </Button>
            </Alert>
          </div>
        )}

        {pinned.length > 0 && (
          <Section label="Pinned">
            {pinned.map((c) => (
              <ConversationItem key={c.id} conversation={c} myUserId={myUserId} selected={c.id === selectedId} pinned onOpen={onOpen} />
            ))}
          </Section>
        )}

        {rest.length > 0 && (
          <Section label={pinned.length > 0 ? (page === "archive" ? "Archived" : "Recent") : null}>
            {rest.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                myUserId={myUserId}
                selected={c.id === selectedId}
                pinned={pinnedSet.has(c.id) && page !== "archive"}
                onOpen={onOpen}
              />
            ))}
          </Section>
        )}

        {status === "ready" && visible.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-xs text-orbit-muted">{filter.trim() ? `No chats match "${filter.trim()}".` : info.empty}</p>
            {canCompose && !filter.trim() && (
              <Button size="sm" variant="primary" className="mt-3" onClick={() => setComposing(true)}>
                New message
              </Button>
            )}
          </div>
        )}
      </div>

      <NewMessageDialog open={composing} onOpenChange={setComposing} />
    </aside>
  );
}

function Section({ label, children }: { label: string | null; children: ReactNode }) {
  return (
    <section className="mt-2">
      {label && <h3 className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-orbit-muted">{label}</h3>}
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="mt-2 space-y-1" aria-label="Loading chats" role="status">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-2.5 py-2">
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-2.5 w-2/3 animate-pulse rounded bg-white/[0.06]" />
            <span className="block h-2 w-1/2 animate-pulse rounded bg-white/[0.04]" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Up/Down move between conversation rows (Home/End jump to the ends). */
function moveFocusWithArrows(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-conversation-row] > button:first-child")];
  if (!rows.length) return;
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowDown" ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0);
  event.preventDefault();
  rows[index === -1 ? 0 : next]?.focus();
}
