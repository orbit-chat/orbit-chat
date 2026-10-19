import { useProfilesStore } from "../../stores/profilesStore";
import { usePresenceStore } from "./presenceStore";

const NO_ONE: string[] = [];

export function typingLabel(names: string[]) {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return "Several people are typing";
}

/** Fixed-height line above the composer, so it appearing never shifts the layout. */
export function TypingIndicator({ conversationId }: { conversationId: string }) {
  const typing = usePresenceStore((s) => s.typingByConversation[conversationId] ?? NO_ONE);
  const profiles = useProfilesStore((s) => s.byId);
  const label = typingLabel(typing.map((id) => profiles[id]?.displayName?.trim() || profiles[id]?.username || "Someone"));

  return (
    <div className="flex h-5 shrink-0 items-center gap-1.5 px-5 text-[11px] text-orbit-muted" aria-live="polite">
      {label && (
        <>
          <span className="flex gap-0.5" aria-hidden="true">
            {[0, 150, 300].map((delay) => (
              <span key={delay} className="h-1 w-1 animate-bounce rounded-full bg-orbit-accent" style={{ animationDelay: `${delay}ms` }} />
            ))}
          </span>
          <span>{label}…</span>
        </>
      )}
    </div>
  );
}
