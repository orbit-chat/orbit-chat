import type { ReactNode } from "react";
import { safeHttpsUrl } from "./envelope";
import { externalLinkProps } from "../../platform";

const TOKEN = /(https:\/\/[^\s<>"]+|(?<![\w@])@[A-Za-z0-9_]+)/g;
/** Punctuation that usually ends a sentence rather than a URL. */
const TRAILING = /[.,!?;:)\]}'"]+$/;

export type TextPart = { kind: "text"; value: string } | { kind: "link"; value: string; href: string } | { kind: "mention"; value: string; username: string };

/** Splits message text into plain text, https links and @mentions. */
export function tokenizeMessageText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", value: text.slice(last, start) });
    if (raw.startsWith("@")) {
      parts.push({ kind: "mention", value: raw, username: raw.slice(1) });
      last = start + raw.length;
    } else {
      const trimmed = raw.replace(TRAILING, "");
      const href = safeHttpsUrl(trimmed);
      parts.push(href ? { kind: "link", value: trimmed, href } : { kind: "text", value: trimmed });
      last = start + trimmed.length;
    }
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

/** True if the text @mentions `username` (case-insensitive). */
export function mentionsUser(text: string, username: string | undefined) {
  if (!username) return false;
  const target = username.toLowerCase();
  return tokenizeMessageText(text).some((p) => p.kind === "mention" && p.username.toLowerCase() === target);
}

export function MessageText({ text, myUsername }: { text: string; myUsername?: string }) {
  const nodes: ReactNode[] = tokenizeMessageText(text).map((part, i) => {
    if (part.kind === "link") {
      return (
        <a key={i} {...externalLinkProps(part.href)} className="break-all text-sky-300 underline-offset-2 hover:underline">
          {part.value}
        </a>
      );
    }
    if (part.kind === "mention") {
      const isMe = Boolean(myUsername && part.username.toLowerCase() === myUsername.toLowerCase());
      return (
        <span key={i} className={isMe ? "rounded bg-orbit-accent/25 px-1 font-semibold text-orbit-accent" : "font-semibold text-sky-300"}>
          {part.value}
        </span>
      );
    }
    return <span key={i}>{part.value}</span>;
  });
  return <p className="whitespace-pre-wrap break-words">{nodes}</p>;
}
