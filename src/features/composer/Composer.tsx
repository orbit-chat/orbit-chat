import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { Avatar, IconButton, Popover, PopoverAnchor, PopoverContent, PopoverTrigger, Tooltip, cn } from "../../ui";
import { CloseIcon, GifIcon, PaperclipIcon, ReplyIcon, SendIcon, SmileIcon } from "../../ui/icons";
import { useMessagesStore } from "../../stores/messagesStore";
import { useProfilesStore } from "../../stores/profilesStore";
import type { Conversation } from "../conversations/conversationsStore";
import { searchableText } from "../chat/envelope";
import { useDecryptedMessage } from "../chat/useDecryptedMessage";
import { useDraft, useDraftsStore } from "./draftsStore";
import { EmojiPicker } from "./EmojiPicker";
import { rejectReason } from "./encryptAttachment";
import { GifPicker } from "./GifPicker";
import { useOutboxStore } from "./outboxStore";
import { filterMentionCandidates, mentionAtCaret, replaceRange, type MentionCandidate, type MentionQuery } from "./textEditing";
import { useTypingSignals } from "./useTypingSignals";

const MAX_TEXTAREA_PX = 200;

type ComposerProps = {
  conversation: Conversation;
  me: { id: string; username: string };
  title: string;
  /** Set inside the thread panel: its own draft, and messages reply to the thread root by default. */
  threadRootId?: string;
};

/**
 * Message box. The draft (text, reply, files, GIF) lives per conversation in memory, so
 * switching chats keeps it. Enter sends, Shift+Enter adds a line, @ suggests members,
 * images can be pasted or dropped, and Ctrl/Cmd + I / G / E / "/" work while it's on screen.
 */
export function Composer({ conversation, me, title, threadRootId }: ComposerProps) {
  const conversationId = conversation.id;
  const draftKey = threadRootId ? `${conversationId}#${threadRootId}` : conversationId;
  const draft = useDraft(draftKey);
  const drafts = useDraftsStore.getState;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [picker, setPicker] = useState<"emoji" | "gif" | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const typing = useTypingSignals(conversationId);
  const listId = useId();
  const profiles = useProfilesStore((s) => s.byId);

  const candidates: MentionCandidate[] = useMemo(
    () =>
      conversation.members
        .filter((m) => m.user.id !== me.id)
        .map((m) => ({ id: m.user.id, username: m.user.username, displayName: profiles[m.user.id]?.displayName ?? null })),
    [conversation.members, me.id, profiles]
  );
  const suggestions = mention ? filterMentionCandidates(candidates, mention.query) : [];
  const mentionOpen = suggestions.length > 0;

  // Grow with the text up to a cap, then scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [draft.text]);

  // Opening a chat (or starting a reply) puts the caret in the box.
  useEffect(() => {
    textareaRef.current?.focus();
  }, [draftKey, draft.replyToId]);

  const setText = useCallback(
    (text: string, caret?: number) => {
      drafts().setText(draftKey, text);
      typing.onTextChange(text);
      const at = caret ?? text.length;
      setMention(mentionAtCaret(text, at));
      setMentionIndex(0);
    },
    [draftKey, drafts, typing]
  );

  /** Insert at the caret (or replace the selection) and keep focus in the box. */
  const insertAtCaret = useCallback(
    (insert: string) => {
      const el = textareaRef.current;
      const text = drafts().byConversation[draftKey]?.text ?? "";
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      const next = replaceRange(text, start, end, insert);
      setText(next.text, next.caret);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(next.caret, next.caret);
      });
    },
    [draftKey, drafts, setText]
  );

  const applyMention = (candidate: MentionCandidate) => {
    if (!mention) return;
    const next = replaceRange(draft.text, mention.start, mention.end, `@${candidate.username} `);
    setText(next.text, next.caret);
    setMention(null);
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(next.caret, next.caret));
  };

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const errors = files.map(rejectReason).filter((e): e is string => Boolean(e));
      const accepted = files.filter((f) => !rejectReason(f));
      setFileErrors(errors);
      if (accepted.length) drafts().addFiles(draftKey, accepted);
    },
    [draftKey, drafts]
  );

  const canSend = Boolean(draft.text.trim() || draft.files.length || draft.gif);

  const send = () => {
    const current = drafts().byConversation[draftKey];
    if (!current || !(current.text.trim() || current.files.length || current.gif)) return;
    void useOutboxStore.getState().send({
      conversationId,
      text: current.text.trim(),
      files: current.files.map((f) => f.file),
      gif: current.gif,
      parentMessageId: current.replyToId ?? threadRootId ?? null
    });
    drafts().clear(draftKey);
    typing.stop();
    setMention(null);
    setFileErrors([]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setMentionIndex((i) => (i + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyMention(suggestions[mentionIndex] ?? suggestions[0]!);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
      return;
    }
    if (event.key === "Escape" && !mentionOpen && draft.replyToId) {
      event.preventDefault();
      drafts().setReplyTo(draftKey, null);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  };

  // App-wide shortcuts while this composer is on screen (the main one only).
  useEffect(() => {
    if (threadRootId) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "i") {
        event.preventDefault();
        fileInputRef.current?.click();
      } else if (key === "g") {
        event.preventDefault();
        setPicker((p) => (p === "gif" ? null : "gif"));
      } else if (key === "e") {
        event.preventDefault();
        setPicker((p) => (p === "emoji" ? null : "emoji"));
      } else if (key === "/") {
        event.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadRootId]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    addFiles([...event.dataTransfer.files]);
  };

  return (
    <footer
      className="relative shrink-0 border-t border-white/10 bg-orbit-raised px-4 pb-3 pt-2"
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {fileErrors.length > 0 && (
        <div role="alert" className="mb-2 flex items-start justify-between gap-2 rounded-lg border border-orbit-danger/30 bg-orbit-danger/10 px-3 py-1.5 text-xs text-rose-300">
          <span>{fileErrors.join(" ")}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setFileErrors([])} className="shrink-0 hover:text-white">
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <Popover open={mentionOpen} onOpenChange={(open) => !open && setMention(null)}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "rounded-2xl border border-white/10 bg-orbit-panelAlt transition-colors focus-within:border-orbit-accent/60",
              dragging && "border-dashed border-orbit-accent bg-orbit-accent/5"
            )}
          >
            {draft.replyToId && <ReplyBar conversationId={conversationId} draftKey={draftKey} messageId={draft.replyToId} myUserId={me.id} />}
            <AttachmentTray draftKey={draftKey} />

            <div className="flex items-end gap-1 p-1.5">
              <Tooltip content="Attach files (Ctrl+I)">
                <IconButton label="Attach files" onClick={() => fileInputRef.current?.click()}>
                  <PaperclipIcon />
                </IconButton>
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  addFiles([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />

              <textarea
                ref={textareaRef}
                rows={1}
                value={draft.text}
                onChange={(event) => setText(event.target.value, event.target.selectionStart)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onSelect={(event) => setMention(mentionAtCaret(event.currentTarget.value, event.currentTarget.selectionStart))}
                placeholder={dragging ? "Drop to attach" : threadRootId ? "Reply in thread" : `Message ${title}`}
                aria-label={threadRootId ? "Reply in thread" : `Message ${title}`}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={mentionOpen}
                aria-controls={mentionOpen ? listId : undefined}
                aria-activedescendant={mentionOpen ? `${listId}-${mentionIndex}` : undefined}
                className="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent px-1.5 py-2 text-[14px] leading-5 text-orbit-text outline-none placeholder:text-orbit-muted/70"
              />

              <Popover open={picker === "gif"} onOpenChange={(open) => setPicker(open ? "gif" : null)}>
                <Tooltip content="GIFs (Ctrl+G)">
                  <PopoverTrigger asChild>
                    <IconButton label="GIFs" className={cn(picker === "gif" && "text-orbit-accent")}>
                      <GifIcon />
                    </IconButton>
                  </PopoverTrigger>
                </Tooltip>
                <PopoverContent side="top" align="end" className="p-0">
                  <GifPicker
                    onPick={(gif) => {
                      drafts().setGif(draftKey, gif);
                      setPicker(null);
                      textareaRef.current?.focus();
                    }}
                  />
                </PopoverContent>
              </Popover>

              <Popover open={picker === "emoji"} onOpenChange={(open) => setPicker(open ? "emoji" : null)}>
                <Tooltip content="Emoji (Ctrl+E)">
                  <PopoverTrigger asChild>
                    <IconButton label="Emoji" className={cn(picker === "emoji" && "text-orbit-accent")}>
                      <SmileIcon />
                    </IconButton>
                  </PopoverTrigger>
                </Tooltip>
                <PopoverContent side="top" align="end" className="p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <EmojiPicker onPick={(emoji) => insertAtCaret(emoji)} />
                </PopoverContent>
              </Popover>

              <Tooltip content="Send (Enter)">
                <IconButton label="Send" variant={canSend ? "primary" : "ghost"} disabled={!canSend} onClick={send}>
                  <SendIcon />
                </IconButton>
              </Tooltip>
            </div>
          </div>
        </PopoverAnchor>

        {/* @mention suggestions. Focus stays in the textarea; arrows/Enter/Tab drive the list. */}
        <PopoverContent
          side="top"
          align="start"
          className="w-64 p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (textareaRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
        >
          <ul id={listId} role="listbox" aria-label="Mention suggestions">
            {suggestions.map((candidate, i) => (
              <li
                key={candidate.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === mentionIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyMention(candidate)}
                onMouseEnter={() => setMentionIndex(i)}
                className={cn("flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5", i === mentionIndex && "bg-white/[0.08]")}
              >
                <Avatar name={candidate.displayName || candidate.username} src={profiles[candidate.id]?.avatarUrl} size="xs" />
                <span className="truncate text-[13px] font-semibold">{candidate.displayName || candidate.username}</span>
                <span className="truncate text-[11px] text-orbit-muted">@{candidate.username}</span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </footer>
  );
}

function ReplyBar({ conversationId, draftKey, messageId, myUserId }: { conversationId: string; draftKey: string; messageId: string; myUserId: string }) {
  const message = useMessagesStore((s) => s.byConversation[conversationId]?.find((m) => m.id === messageId));
  const profile = useProfilesStore((s) => (message ? s.byId[message.senderId] : undefined));
  if (!message) return null;
  const name = message.senderId === myUserId ? "yourself" : profile?.displayName?.trim() || message.sender;
  return <ReplyBarLoaded conversationId={conversationId} draftKey={draftKey} message={message} name={name} />;
}

function ReplyBarLoaded({
  conversationId,
  draftKey,
  message,
  name
}: {
  conversationId: string;
  draftKey: string;
  message: Parameters<typeof useDecryptedMessage>[1];
  name: string;
}) {
  const decrypted = useDecryptedMessage(conversationId, message);
  const snippet = decrypted.status === "ok" ? searchableText(decrypted.envelope) || "Attachment" : "Encrypted message";
  return (
    <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-xs">
      <ReplyIcon className="h-3.5 w-3.5 shrink-0 text-orbit-accent" />
      <span className="shrink-0 text-orbit-muted">
        Replying to <span className="font-semibold text-orbit-text">{name}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-orbit-muted">{snippet}</span>
      <Tooltip content="Cancel reply (Esc)">
        <IconButton label="Cancel reply" size="sm" onClick={() => useDraftsStore.getState().setReplyTo(draftKey, null)}>
          <CloseIcon className="h-3.5 w-3.5" />
        </IconButton>
      </Tooltip>
    </div>
  );
}

function AttachmentTray({ draftKey }: { draftKey: string }) {
  const { files, gif } = useDraft(draftKey);
  if (!files.length && !gif) return null;
  return (
    <ul className="flex flex-wrap gap-2 border-b border-white/[0.06] p-2" aria-label="Attachments">
      {files.map((pending) => (
        <li key={pending.id} className="group/att relative flex h-16 max-w-[12rem] items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-orbit-panel pr-7">
          {pending.previewUrl ? (
            <img src={pending.previewUrl} alt="" className="h-16 w-16 shrink-0 object-cover" />
          ) : (
            <span className="ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orbit-accent/15 text-[10px] font-bold uppercase text-orbit-accent">
              {pending.file.name.split(".").pop()?.slice(0, 4) || "file"}
            </span>
          )}
          <span className="min-w-0 truncate text-[11px]">{pending.file.name}</span>
          <RemoveButton label={`Remove ${pending.file.name}`} onClick={() => useDraftsStore.getState().removeFile(draftKey, pending.id)} />
        </li>
      ))}
      {gif && (
        <li className="relative h-16 overflow-hidden rounded-xl border border-white/10">
          <img src={gif.previewUrl || gif.url} alt={gif.title || "GIF"} className="h-16 w-auto object-cover" />
          <RemoveButton label="Remove GIF" onClick={() => useDraftsStore.getState().setGif(draftKey, null)} />
        </li>
      )}
    </ul>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-orbit-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
    >
      <CloseIcon className="h-3 w-3" />
    </button>
  );
}
