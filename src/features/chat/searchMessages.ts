import type { ChatMessage } from "../../stores/messagesStore";
import type { DecryptedEntry } from "./decryptedStore";
import { searchableText } from "./envelope";

export type SearchHit = { message: ChatMessage; text: string; matchStart: number; matchLength: number };

/**
 * Searches decrypted text and sender names of the messages this device holds, newest
 * first. The server only has ciphertext, so search can only ever be local.
 */
export function searchMessages(params: {
  messages: ChatMessage[];
  decrypted: Record<string, DecryptedEntry | undefined>;
  query: string;
  senderName: (message: ChatMessage) => string;
  limit?: number;
}): SearchHit[] {
  const q = params.query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (let i = params.messages.length - 1; i >= 0 && hits.length < (params.limit ?? 50); i--) {
    const message = params.messages[i]!;
    const entry = params.decrypted[message.id];
    const text = entry?.status === "ok" ? searchableText(entry.envelope) : "";
    const at = text.toLowerCase().indexOf(q);
    if (at >= 0) {
      hits.push({ message, text, matchStart: at, matchLength: q.length });
    } else if (params.senderName(message).toLowerCase().includes(q) || message.sender.toLowerCase().includes(q)) {
      hits.push({ message, text, matchStart: -1, matchLength: 0 });
    }
  }
  return hits;
}

/** Text around the match so long messages still show why they matched. */
export function excerpt(hit: SearchHit, radius = 40) {
  // Matched on the sender's name: show the start of the text, nothing highlighted.
  if (hit.matchStart < 0) return { before: hit.text.slice(0, radius * 2), match: "", after: hit.text.length > radius * 2 ? "…" : "" };
  const start = hit.text.length <= radius * 2 ? 0 : Math.max(0, hit.matchStart - radius);
  const end = hit.text.length <= radius * 2 ? hit.text.length : Math.min(hit.text.length, hit.matchStart + hit.matchLength + radius);
  return {
    before: (start > 0 ? "…" : "") + hit.text.slice(start, hit.matchStart),
    match: hit.text.slice(hit.matchStart, hit.matchStart + hit.matchLength),
    after: hit.text.slice(hit.matchStart + hit.matchLength, end) + (end < hit.text.length ? "…" : "")
  };
}
