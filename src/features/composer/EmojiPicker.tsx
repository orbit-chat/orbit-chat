import { useMemo, useState, type KeyboardEvent } from "react";
import { Input, cn } from "../../ui";
import { usePrefsStore, useUserPrefs } from "../../stores/prefsStore";
import { EMOJI_CATALOG } from "./emojiCatalog";

const COLUMNS = 8;

/** Search + grid. Arrow keys move, Enter picks, recent picks come first. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const recent = useUserPrefs().recentEmojis;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMOJI_CATALOG.map((e) => e.value);
    return EMOJI_CATALOG.filter((e) => e.tags.some((t) => t.includes(q))).map((e) => e.value);
  }, [query]);

  const pick = (emoji: string) => {
    usePrefsStore.getState().pushRecentEmoji(emoji);
    onPick(emoji);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS };
    if (event.key in moves) {
      event.preventDefault();
      setActive((i) => Math.max(0, Math.min(results.length - 1, i + moves[event.key]!)));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      pick(results[active]!);
    }
  };

  return (
    <div className="w-[19rem] p-2" onKeyDown={onKeyDown}>
      <Input
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        placeholder="Search emoji"
        aria-label="Search emoji"
        className="h-8 text-[13px]"
      />
      {!query && recent.length > 0 && (
        <>
          <p className="mb-1 mt-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-orbit-muted">Recent</p>
          <div className="grid grid-cols-8 gap-0.5">
            {recent.slice(0, COLUMNS).map((emoji) => (
              <EmojiButton key={`recent:${emoji}`} emoji={emoji} onPick={pick} />
            ))}
          </div>
        </>
      )}
      <p className="mb-1 mt-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-orbit-muted">{query ? "Results" : "All"}</p>
      <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto" role="listbox" aria-label="Emoji">
        {results.map((emoji, i) => (
          <EmojiButton key={emoji} emoji={emoji} onPick={pick} active={i === active} />
        ))}
      </div>
      {results.length === 0 && <p className="py-6 text-center text-xs text-orbit-muted">No emoji match "{query}".</p>}
    </div>
  );
}

function EmojiButton({ emoji, onPick, active }: { emoji: string; onPick: (emoji: string) => void; active?: boolean }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={() => onPick(emoji)}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
        active && "bg-white/10"
      )}
    >
      {emoji}
    </button>
  );
}
