/** An @mention being typed: where it starts and what's been typed after the @. */
export type MentionQuery = { start: number; end: number; query: string };

/** The @word immediately before the caret, if the caret is inside one. */
export function mentionAtCaret(text: string, caret: number): MentionQuery | null {
  const match = /(^|\s)@([A-Za-z0-9_]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: caret - query.length - 1, end: caret, query };
}

/** Replace [start, end) with `insert`, returning the new text and caret position. */
export function replaceRange(text: string, start: number, end: number, insert: string) {
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

export type MentionCandidate = { id: string; username: string; displayName: string | null };

/** Members whose username or display name starts with the query (case-insensitive), best matches first. */
export function filterMentionCandidates(candidates: MentionCandidate[], query: string, limit = 8) {
  const q = query.toLowerCase();
  const score = (c: MentionCandidate) => {
    const u = c.username.toLowerCase();
    const d = c.displayName?.toLowerCase() ?? "";
    if (u === q) return 0;
    if (u.startsWith(q)) return 1;
    if (d.startsWith(q) || d.split(/\s+/).some((w) => w.startsWith(q))) return 2;
    return -1;
  };
  return candidates
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.c.username.localeCompare(b.c.username))
    .slice(0, limit)
    .map((x) => x.c);
}
