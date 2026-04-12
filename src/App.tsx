import { FormEvent, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useAuthStore } from "./stores/authStore";
import { useMessagesStore } from "./stores/messagesStore";
import { useSocketStore } from "./stores/socketStore";
import { useProfilesStore } from "./stores/profilesStore";
import { useE2EEStore } from "./stores/e2eeStore";
import { useChatLockStore } from "./stores/chatLockStore";
import * as api from "./lib/api";
import type { Conversation } from "./lib/api";
import {
  decryptChunkedBytes,
  decryptMessage,
  encryptChunkedBytes,
  encryptMessage,
  generateSecretKey,
  sealToPublicKey,
  sha256Base64,
} from "./lib/crypto";
import { UserProfilePopover } from "./components/UserProfilePopover";
import { ProfileSettings } from "./components/ProfileSettings";
import { useContextMenu, ContextMenuPortal, type ContextMenuItem } from "./components/ContextMenu";
import DevOverlay from "./components/DevOverlay";
import { devLog } from "./lib/devLogger";

/* ─── Custom frameless title bar ─── */
function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.electronAPI?.isMaximized().then(setMaximized).catch(() => {});
    const unsub = window.electronAPI?.onMaximizedChanged((v) => setMaximized(v));
    return () => unsub?.();
  }, []);

  return (
    <div className="orbit-titlebar">
      <div className="orbit-titlebar-drag">
        <span className="orbit-titlebar-label">Orbit Chat</span>
      </div>
      <div className="orbit-titlebar-controls">
        <button onClick={() => window.electronAPI?.minimize()} className="orbit-titlebar-btn" aria-label="Minimize">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect y="5" width="12" height="1.5" rx=".75" fill="currentColor"/></svg>
        </button>
        <button onClick={() => window.electronAPI?.maximize()} className="orbit-titlebar-btn" aria-label={maximized ? "Restore" : "Maximize"}>
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="3" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M3.5 3V2a1.5 1.5 0 0 1 1.5-1.5H10A1.5 1.5 0 0 1 11.5 2v5A1.5 1.5 0 0 1 10 8.5H9" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x=".75" y=".75" width="10.5" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
          )}
        </button>
        <button onClick={() => window.electronAPI?.close()} className="orbit-titlebar-btn orbit-titlebar-btn-close" aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
    </div>
  );
}

type UploadedAttachment = {
  kind: "image" | "file";
  mediaId: string;
  name: string;
  mimeType: string;
  size: number;
  fileKeyCiphertext: string;
  fileKeyNonce: string;
  chunkSize: number;
  chunkCount: number;
  encryptedSha256?: string;
};

type GifLinkAttachment = {
  kind: "gif_link";
  url: string;
  previewUrl?: string;
  title?: string;
};

type MessageAttachment = UploadedAttachment | GifLinkAttachment;

type MessageEnvelope = {
  text?: string;
  attachments?: MessageAttachment[];
};

const GIPHY_API_KEY = (import.meta.env.VITE_GIPHY_API_KEY ?? "dc6zaTOxFJmzC").trim();
const GIF_SEARCH_LIMIT = 18;

const EMOJI_CATALOG: Array<{ value: string; tags: string[] }> = [
  { value: "😀", tags: ["smile", "happy", "grin"] },
  { value: "😄", tags: ["smile", "joy", "happy"] },
  { value: "😂", tags: ["laugh", "funny", "tears"] },
  { value: "🤣", tags: ["rofl", "laugh", "funny"] },
  { value: "🙂", tags: ["smile", "nice"] },
  { value: "😊", tags: ["smile", "warm", "happy"] },
  { value: "😉", tags: ["wink", "playful"] },
  { value: "😍", tags: ["love", "heart", "eyes"] },
  { value: "😘", tags: ["kiss", "love"] },
  { value: "😎", tags: ["cool", "sunglasses"] },
  { value: "🤔", tags: ["think", "hmm"] },
  { value: "🫡", tags: ["salute", "respect"] },
  { value: "👍", tags: ["thumbs", "yes", "ok"] },
  { value: "👏", tags: ["clap", "nice"] },
  { value: "🙌", tags: ["celebrate", "yay"] },
  { value: "🔥", tags: ["fire", "hot", "lit"] },
  { value: "✨", tags: ["sparkles", "shine"] },
  { value: "💯", tags: ["hundred", "perfect"] },
  { value: "🎉", tags: ["party", "celebrate"] },
  { value: "🚀", tags: ["rocket", "launch"] },
  { value: "❤️", tags: ["heart", "love"] },
  { value: "🤍", tags: ["heart", "love"] },
  { value: "🖤", tags: ["heart", "love"] },
  { value: "🤝", tags: ["deal", "together"] },
  { value: "🙏", tags: ["thanks", "please"] },
  { value: "😅", tags: ["sweat", "relief"] },
  { value: "😭", tags: ["cry", "sad"] },
  { value: "😤", tags: ["frustrated", "angry"] },
  { value: "😴", tags: ["sleep", "tired"] },
  { value: "🤯", tags: ["mindblown", "wow"] },
  { value: "👀", tags: ["eyes", "look"] },
  { value: "🎯", tags: ["target", "focus"] },
  { value: "✅", tags: ["done", "check"] },
  { value: "❌", tags: ["no", "x"] },
  { value: "⚡", tags: ["fast", "energy"] },
  { value: "💡", tags: ["idea", "lightbulb"] },
  { value: "📌", tags: ["pin", "important"] },
  { value: "🧠", tags: ["brain", "smart"] },
  { value: "🎵", tags: ["music", "song"] },
  { value: "🕹️", tags: ["game", "gaming"] },
  { value: "📷", tags: ["camera", "photo"] },
  { value: "🌙", tags: ["night", "moon"] },
  { value: "☀️", tags: ["sun", "day"] },
  { value: "😁", tags: ["grin", "smile", "happy"] },
  { value: "😇", tags: ["angel", "innocent", "good"] },
  { value: "🥳", tags: ["party", "celebrate", "birthday"] },
  { value: "🤩", tags: ["starstruck", "wow", "excited"] },
  { value: "😋", tags: ["yum", "tasty", "tongue"] },
  { value: "😜", tags: ["silly", "wink", "playful"] },
  { value: "🤪", tags: ["goofy", "crazy", "funny"] },
  { value: "😌", tags: ["calm", "relieved", "peaceful"] },
  { value: "😔", tags: ["sad", "down", "disappointed"] },
  { value: "😢", tags: ["cry", "sad", "tear"] },
  { value: "😡", tags: ["angry", "mad", "rage"] },
  { value: "🤬", tags: ["swear", "angry", "mad"] },
  { value: "🥶", tags: ["cold", "freezing", "chill"] },
  { value: "🥵", tags: ["hot", "heat", "sweat"] },
  { value: "🤗", tags: ["hug", "support", "care"] },
  { value: "🫶", tags: ["love", "heart", "hands"] },
  { value: "💪", tags: ["strong", "workout", "muscle"] },
  { value: "👌", tags: ["ok", "perfect", "fine"] },
  { value: "🤌", tags: ["italian", "chef", "gesture"] },
  { value: "✌️", tags: ["peace", "victory", "two"] },
  { value: "🫰", tags: ["snap", "money", "finger"] },
  { value: "👋", tags: ["wave", "hello", "bye"] },
  { value: "🫵", tags: ["you", "point", "finger"] },
  { value: "👏🏻", tags: ["clap", "applause", "nice"] },
  { value: "🤞", tags: ["luck", "hope", "crossed"] },
  { value: "🎊", tags: ["celebration", "confetti", "party"] },
  { value: "🏆", tags: ["win", "trophy", "champion"] },
  { value: "🥇", tags: ["gold", "first", "winner"] },
  { value: "🎮", tags: ["game", "controller", "gaming"] },
  { value: "🧩", tags: ["puzzle", "solve", "piece"] },
  { value: "💻", tags: ["code", "computer", "dev"] },
  { value: "⌨️", tags: ["keyboard", "typing", "code"] },
  { value: "🖱️", tags: ["mouse", "click", "computer"] },
  { value: "📱", tags: ["phone", "mobile", "app"] },
  { value: "📞", tags: ["call", "phone", "ring"] },
  { value: "📨", tags: ["message", "mail", "inbox"] },
  { value: "✉️", tags: ["email", "message", "letter"] },
  { value: "🧾", tags: ["receipt", "invoice", "bill"] },
  { value: "📅", tags: ["calendar", "date", "schedule"] },
  { value: "⏰", tags: ["alarm", "time", "clock"] },
  { value: "📍", tags: ["location", "pin", "map"] },
  { value: "🗺️", tags: ["map", "travel", "location"] },
  { value: "🚗", tags: ["car", "drive", "travel"] },
  { value: "✈️", tags: ["flight", "airplane", "travel"] },
  { value: "🏠", tags: ["home", "house", "safe"] },
  { value: "🏢", tags: ["office", "work", "building"] },
  { value: "☕", tags: ["coffee", "break", "morning"] },
  { value: "🍕", tags: ["pizza", "food", "eat"] },
  { value: "🍔", tags: ["burger", "food", "eat"] },
  { value: "🍜", tags: ["ramen", "noodles", "food"] },
  { value: "🍣", tags: ["sushi", "food", "japan"] },
  { value: "🍎", tags: ["apple", "fruit", "healthy"] },
  { value: "🥤", tags: ["drink", "soda", "beverage"] },
  { value: "🧋", tags: ["boba", "tea", "drink"] },
  { value: "🧁", tags: ["cupcake", "dessert", "sweet"] },
  { value: "🐶", tags: ["dog", "pet", "cute"] },
  { value: "🐱", tags: ["cat", "pet", "cute"] },
  { value: "🦊", tags: ["fox", "animal", "cute"] },
  { value: "🐼", tags: ["panda", "animal", "cute"] },
  { value: "🦄", tags: ["unicorn", "magic", "fun"] },
  { value: "🌈", tags: ["rainbow", "color", "happy"] },
  { value: "🌊", tags: ["ocean", "wave", "water"] },
  { value: "🌧️", tags: ["rain", "weather", "storm"] },
  { value: "❄️", tags: ["snow", "winter", "cold"] },
  { value: "⚽", tags: ["soccer", "sports", "ball"] },
  { value: "🏀", tags: ["basketball", "sports", "ball"] },
  { value: "🎾", tags: ["tennis", "sports", "ball"] },
  { value: "🏈", tags: ["football", "sports", "ball"] },
  { value: "🎸", tags: ["guitar", "music", "instrument"] },
  { value: "🎧", tags: ["headphones", "music", "listen"] },
  { value: "🎬", tags: ["movie", "film", "video"] },
  { value: "📚", tags: ["books", "read", "study"] },
  { value: "✍️", tags: ["write", "notes", "author"] },
  { value: "🔒", tags: ["lock", "secure", "private"] },
  { value: "🔓", tags: ["unlock", "open", "access"] },
  { value: "🛡️", tags: ["shield", "security", "protect"] },
  { value: "🧪", tags: ["test", "experiment", "lab"] },
  { value: "🐛", tags: ["bug", "issue", "debug"] },
  { value: "🧰", tags: ["tools", "fix", "kit"] },
  { value: "🛠️", tags: ["build", "repair", "tools"] },
  { value: "📈", tags: ["growth", "analytics", "up"] },
  { value: "📉", tags: ["down", "drop", "analytics"] },
  { value: "🧭", tags: ["direction", "navigate", "compass"] },
  { value: "🧨", tags: ["explosive", "hype", "boom"] },
  { value: "🥲", tags: ["tears", "happy sad", "emotion"] },
  { value: "🫠", tags: ["melting", "awkward", "heat"] },
  { value: "🫣", tags: ["peek", "shy", "embarrassed"] },
  { value: "🫤", tags: ["meh", "unsure", "neutral"] },
  { value: "🫥", tags: ["invisible", "quiet", "hide"] },
  { value: "🫨", tags: ["shaking", "shock", "wow"] },
  { value: "🩷", tags: ["pink heart", "love", "heart"] },
  { value: "🩵", tags: ["light blue heart", "love", "heart"] },
  { value: "🩶", tags: ["grey heart", "love", "heart"] },
  { value: "🫂", tags: ["hug", "support", "comfort"] },
];

type GifSearchResult = {
  id: string;
  title: string;
  gifUrl: string;
  previewUrl: string;
};

function normalizeGifUrl(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function shortConversationId(conversationId: string) {
  return conversationId.split("-")[0] ?? conversationId.slice(0, 8);
}

type ChatRealtimePreferences = {
  readReceipts: boolean;
  typingIndicators: boolean;
};

const DEFAULT_CHAT_PREFERENCES: ChatRealtimePreferences = {
  readReceipts: true,
  typingIndicators: true,
};

const CHAT_PREFERENCES_STORAGE_KEY = "orbit:chat-realtime-preferences";

function loadChatPreferences(): Record<string, ChatRealtimePreferences> {
  try {
    const raw = localStorage.getItem(CHAT_PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<ChatRealtimePreferences>>;
    const normalized: Record<string, ChatRealtimePreferences> = {};
    for (const [conversationId, pref] of Object.entries(parsed)) {
      normalized[conversationId] = {
        readReceipts: pref.readReceipts ?? true,
        typingIndicators: pref.typingIndicators ?? true,
      };
    }
    return normalized;
  } catch {
    return {};
  }
}

function persistChatPreferences(value: Record<string, ChatRealtimePreferences>) {
  localStorage.setItem(CHAT_PREFERENCES_STORAGE_KEY, JSON.stringify(value));
}

function latestPublicKey(keys: { publicKey: string; createdAt: string }[]) {
  if (!keys.length) return null;
  return keys
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]!
    .publicKey;
}

function MediaAttachmentView(props: {
  conversationId: string;
  keyVersion?: number;
  token: string | null;
  attachment: UploadedAttachment;
}) {
  const { conversationId, keyVersion, token, attachment } = props;
  const secretKey = useE2EEStore((state) => state.getConversationSecretKeyForVersion(conversationId, keyVersion));
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    const run = async () => {
      if (!secretKey || !token) {
        setBlobUrl(null);
        return;
      }

      try {
        const fileKey = await decryptMessage(attachment.fileKeyCiphertext, attachment.fileKeyNonce, secretKey);
        const encryptedBytes = await api.downloadEncryptedMedia(attachment.mediaId, token);
        if (attachment.encryptedSha256) {
          const digest = await sha256Base64(encryptedBytes);
          if (digest !== attachment.encryptedSha256) {
            throw new Error("Attachment integrity check failed");
          }
        }
        const plainBytes = await decryptChunkedBytes(encryptedBytes, fileKey);
        const blob = new Blob([plainBytes], { type: attachment.mimeType || "application/octet-stream" });
        createdUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setBlobUrl(createdUrl);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Unable to open attachment");
          setBlobUrl(null);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment, secretKey, token]);

  if (error) {
    return <p className="mt-2 text-xs text-rose-300">{error}</p>;
  }

  if (!blobUrl) {
    return <p className="mt-2 text-xs text-orbit-muted">Decrypting attachment...</p>;
  }

  if (attachment.kind === "image") {
    return (
      <a href={blobUrl} download={attachment.name} className="mt-2 block" target="_blank" rel="noreferrer">
        <img src={blobUrl} alt={attachment.name} className="max-h-64 rounded-xl border border-white/10 object-contain" />
      </a>
    );
  }

  return (
    <a
      href={blobUrl}
      download={attachment.name}
      className="mt-2 inline-flex items-center rounded-lg border border-white/10 bg-orbit-panelAlt px-3 py-2 text-xs text-orbit-text hover:border-white/20"
    >
      Download {attachment.name}
    </a>
  );
}

function DecryptedMessageBody(props: {
  conversationId: string;
  token: string | null;
  cipherText: string;
  nonce?: string;
  keyVersion?: number;
}) {
  const { conversationId, token, cipherText, nonce, keyVersion } = props;
  const secretKey = useE2EEStore((state) => state.getConversationSecretKeyForVersion(conversationId, keyVersion));
  const [legacyText, setLegacyText] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<MessageEnvelope | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!secretKey || !nonce) {
        setLegacyText(null);
        setEnvelope(null);
        return;
      }

      try {
        const text = await decryptMessage(cipherText, nonce, secretKey);
        let parsed: MessageEnvelope | null = null;
        try {
          const value = JSON.parse(text) as MessageEnvelope;
          if (value && typeof value === "object") parsed = value;
        } catch {
          parsed = null;
        }

        if (cancelled) return;
        if (parsed) {
          setEnvelope(parsed);
          setLegacyText(null);
          return;
        }

        setEnvelope(null);
        setLegacyText(text);
      } catch {
        if (!cancelled) {
          setLegacyText(null);
          setEnvelope(null);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [cipherText, nonce, secretKey]);

  if (!envelope && !legacyText) {
    return <p className="mt-1 break-words text-orbit-text">Encrypted message (unable to decrypt on this device).</p>;
  }

  return (
    <div className="mt-1 space-y-2">
      {(envelope?.text ?? legacyText) && <p className="break-words text-orbit-text">{envelope?.text ?? legacyText}</p>}
      {(envelope?.attachments ?? []).map((attachment, idx) => {
        if (attachment.kind === "gif_link") {
          const safeUrl = normalizeGifUrl(attachment.url);
          if (!safeUrl) return null;
          return (
            <a
              key={`${safeUrl}:${idx}`}
              href={safeUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="block overflow-hidden rounded-xl border border-white/10 bg-orbit-panelAlt"
            >
              <img
                src={attachment.previewUrl || safeUrl}
                alt={attachment.title || "GIF attachment"}
                className="max-h-72 w-full object-cover"
                loading="lazy"
              />
              <p className="px-3 py-2 text-xs text-orbit-muted">GIF attachment</p>
            </a>
          );
        }
        return (
          <MediaAttachmentView
            key={`${attachment.mediaId}:${idx}`}
            token={token}
            conversationId={conversationId}
            keyVersion={keyVersion}
            attachment={attachment}
          />
        );
      })}
    </div>
  );
}

async function extractMessageSearchableText(params: {
  secretKey: string | null;
  cipherText: string;
  nonce?: string;
}) {
  const { secretKey, cipherText, nonce } = params;
  if (!secretKey || !nonce) return "";

  try {
    const text = await decryptMessage(cipherText, nonce, secretKey);
    try {
      const parsed = JSON.parse(text) as MessageEnvelope;
      const messageText = parsed?.text?.trim() ?? "";
      const attachmentText = (parsed?.attachments ?? [])
        .map((attachment) => {
          if (attachment.kind === "gif_link") {
            return [attachment.title, attachment.url].filter(Boolean).join(" ");
          }
          return [attachment.name, attachment.mimeType].filter(Boolean).join(" ");
        })
        .join(" ");
      return [messageText, attachmentText].filter(Boolean).join(" ").toLowerCase();
    } catch {
      return text.toLowerCase();
    }
  } catch {
    return "";
  }
}

function App() {
  const [appVersion, setAppVersion] = useState("-");
  const [authMode, setAuthMode] = useState<"login" | "signup" | "recovery">("login");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [mainView, setMainView] = useState<"chat" | "profile-settings">("chat");
  const [navTab, setNavTab] = useState<"home" | "dm" | "groups" | "friends" | "archive">("home");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authValidationError, setAuthValidationError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingGifs, setPendingGifs] = useState<GifLinkAttachment[]>([]);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<GifSearchResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [gifActiveIndex, setGifActiveIndex] = useState(0);
  const [emojiActiveIndex, setEmojiActiveIndex] = useState(0);
  const [messageSendError, setMessageSendError] = useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string | null>(null);
  const [threadRootMessageId, setThreadRootMessageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const gifPickerRef = useRef<HTMLDivElement | null>(null);
  const gifSearchInputRef = useRef<HTMLInputElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const emojiSearchInputRef = useRef<HTMLInputElement | null>(null);
  const gifButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const uploadedAttachmentCacheRef = useRef<Record<string, UploadedAttachment>>({});

  const [profilePopoverUserId, setProfilePopoverUserId] = useState<string | null>(null);
  const [profilePopoverAnchor, setProfilePopoverAnchor] = useState<DOMRect | null>(null);

  /** Passcode for newly created chat (shown once) */
  const [pendingChatPasscode, setPendingChatPasscode] = useState<{ conversationId: string; passcode: string; label: string } | null>(null);
  /** Passcodes waiting to be shown when the user first opens a conversation */
  const [deferredPasscodes, setDeferredPasscodes] = useState<Record<string, { passcode: string; label: string }>>({});
  /** When a locked chat is selected, show the unlock screen */
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [bypassRecoveryCode, setBypassRecoveryCode] = useState("");
  const [showBypassInput, setShowBypassInput] = useState(false);
  /** Chat settings panel */
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [chatSettingsPasscode, setChatSettingsPasscode] = useState("");
  const [chatSettingsName, setChatSettingsName] = useState("");
  const [chatSettingsLength, setChatSettingsLength] = useState(2);
  const [chatSettingsLockMode, setChatSettingsLockMode] = useState<api.ChatLockMode>("on_leave");
  const [chatSettingsTimeout, setChatSettingsTimeout] = useState("");
  const [chatSettingsReadReceipts, setChatSettingsReadReceipts] = useState(true);
  const [chatSettingsTypingIndicators, setChatSettingsTypingIndicators] = useState(true);
  const [chatSettingsError, setChatSettingsError] = useState<string | null>(null);
  const [chatSettingsSaving, setChatSettingsSaving] = useState(false);
  const [chatRealtimePreferences, setChatRealtimePreferences] = useState<Record<string, ChatRealtimePreferences>>(() => loadChatPreferences());
  const [typingByConversation, setTypingByConversation] = useState<Record<string, string[]>>({});
  const [seenByMessageId, setSeenByMessageId] = useState<Record<string, string[]>>({});
  const typingStopTimerRef = useRef<number | null>(null);
  const typingSentConversationRef = useRef<string | null>(null);
  const seenSentRef = useRef<Set<string>>(new Set());
  const typingIndicatorTimeoutsRef = useRef<Record<string, number>>({});

  // Archive (client-side, persisted per-user via localStorage)
  const [archivedConvIds, setArchivedConvIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("orbit:archived");
      return raw ? new Set(JSON.parse(raw)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const persistArchived = useCallback((ids: Set<string>) => {
    setArchivedConvIds(ids);
    localStorage.setItem("orbit:archived", JSON.stringify([...ids]));
  }, []);

  const [pinnedConvIds, setPinnedConvIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("orbit:pinned-chats");
      return raw ? new Set(JSON.parse(raw)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const persistPinned = useCallback((ids: Set<string>) => {
    setPinnedConvIds(ids);
    localStorage.setItem("orbit:pinned-chats", JSON.stringify([...ids]));
  }, []);

  // Context menu
  const ctxMenu = useContextMenu();

  // Delete / leave confirmation modal
  const [deleteModal, setDeleteModal] = useState<{
    conversationId: string;
    type: "dm" | "group";
    displayName: string;
  } | null>(null);
  const [deleteWipeMessages, setDeleteWipeMessages] = useState(true);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Group creation modal
  const [groupCreationModal, setGroupCreationModal] = useState<{
    open: boolean;
    selectedMemberIds: Set<string>;
    groupName: string;
    loading: boolean;
    error: string | null;
  }>({
    open: false,
    selectedMemberIds: new Set(),
    groupName: "",
    loading: false,
    error: null,
  });

  // Add members to group modal
  const [addMembersModal, setAddMembersModal] = useState<{
    open: boolean;
    conversationId: string | null;
    selectedMemberIds: Set<string>;
    loading: boolean;
    error: string | null;
  }>({
    open: false,
    conversationId: null,
    selectedMemberIds: new Set(),
    loading: false,
    error: null,
  });
  const [groupMemberSearch, setGroupMemberSearch] = useState("");
  const [addMemberSearch, setAddMemberSearch] = useState("");

  // Server data
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<api.UserProfile[]>([]);
  const [friends, setFriends] = useState<api.FriendListItem[]>([]);
  const [friendRequests, setFriendRequests] = useState<api.FriendRequestsResponse>({ incoming: [], outgoing: [] });
  const [friendError, setFriendError] = useState<string | null>(null);
  const [friendActionLoading, setFriendActionLoading] = useState<Record<string, boolean>>({});
  const conversationsRef = useRef<Conversation[]>([]);

  const { user, clearSession, token, loading, error, login, signup, loginWithRecoveryCode, pendingRecoveryCodes, clearPendingRecoveryCodes } = useAuthStore();
  const { connected, connectionState, connectionError, connect, disconnect, socket } = useSocketStore();
  const { byConversation, unreadCountByConversation, upsertMessage, setActiveConversation } = useMessagesStore();
  const profileById = useProfilesStore((state) => state.byId);
  const profileLoadingById = useProfilesStore((state) => state.loadingById);
  const profileErrorById = useProfilesStore((state) => state.errorById);
  const fetchProfile = useProfilesStore((state) => state.fetchProfile);
  const fetchMeProfile = useProfilesStore((state) => state.fetchMe);
  const mergeProfiles = useProfilesStore((state) => state.mergeProfiles);
  const mergePresence = useProfilesStore((state) => state.mergePresence);
  const ensureConversationSecretKey = useE2EEStore((state) => state.ensureConversationSecretKey);
  const ensureDeviceKeypair = useE2EEStore((state) => state.ensureDeviceKeypair);
  const getConversationSecretKey = useE2EEStore((state) => state.getConversationSecretKey);
  const getConversationSecretKeyForVersion = useE2EEStore((state) => state.getConversationSecretKeyForVersion);
  const getConversationKeyVersion = useE2EEStore((state) => state.getConversationKeyVersion);
  const setConversationSecretKeyVersion = useE2EEStore((state) => state.setConversationSecretKeyVersion);
  const loadingByConversationId = useE2EEStore((state) => state.loadingByConversationId);

  const chatLock = useChatLockStore();

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConvId) ?? null,
    [conversations, selectedConvId]
  );

  const selectedConversationLabel = useMemo(() => {
    if (!selectedConversation || !user) return "Unknown";
    if (selectedConversation.type !== "dm") return selectedConversation.name ?? "Group";
    if (selectedConversation.name?.trim()) {
      return selectedConversation.name.trim();
    }
    const partnerUsername = selectedConversation.members.find((m) => m.user.id !== user.id)?.user.username ?? "dm";
    return `${partnerUsername}#${shortConversationId(selectedConversation.id)}`;
  }, [selectedConversation, user]);

  const dmPartner = useMemo(() => {
    if (!selectedConversation || !user) return null;
    if (selectedConversation.type !== "dm") return null;
    return selectedConversation.members.find((m) => m.user.id !== user.id)?.user ?? null;
  }, [selectedConversation, user]);

  const messages = useMemo(
    () => (selectedConvId ? byConversation[selectedConvId] ?? [] : []),
    [byConversation, selectedConvId]
  );

  const [messageSearchIndex, setMessageSearchIndex] = useState<Record<string, string>>({});

  const messageById = useMemo(() => {
    const map = new Map<string, (typeof messages)[number]>();
    for (const message of messages) {
      map.set(message.id, message);
    }
    return map;
  }, [messages]);

  const threadRootMessage = useMemo(() => {
    if (!threadRootMessageId) return null;
    return messageById.get(threadRootMessageId) ?? null;
  }, [messageById, threadRootMessageId]);

  const threadMessages = useMemo(() => {
    if (!threadRootMessageId) return [] as typeof messages;
    return messages.filter((message) => message.id === threadRootMessageId || message.parentMessageId === threadRootMessageId);
  }, [messages, threadRootMessageId]);

  const activeMessageSearchQuery = messageSearch.trim().toLowerCase();

  const visibleMessages = useMemo(() => {
    if (!selectedConversation || !activeMessageSearchQuery) return messages;

    return messages.filter((message) => {
      const senderProfile = profileById[message.senderId];
      const senderText = [message.sender, senderProfile?.username, senderProfile?.displayName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const bodyText = messageSearchIndex[message.id] ?? "";
      return senderText.includes(activeMessageSearchQuery) || bodyText.includes(activeMessageSearchQuery);
    });
  }, [activeMessageSearchQuery, messageSearchIndex, messages, profileById, selectedConversation]);

  const activeReplyParentMessageId = useMemo(() => {
    if (threadRootMessageId) return threadRootMessageId;
    return replyTargetMessageId;
  }, [replyTargetMessageId, threadRootMessageId]);

  const selectedConversationPreferences = useMemo(() => {
    if (!selectedConversation) return DEFAULT_CHAT_PREFERENCES;
    return chatRealtimePreferences[selectedConversation.id] ?? DEFAULT_CHAT_PREFERENCES;
  }, [chatRealtimePreferences, selectedConversation]);

  const setRealtimePreferencesForConversation = useCallback((conversationId: string, nextPref: ChatRealtimePreferences) => {
    setChatRealtimePreferences((prev) => {
      const next = { ...prev, [conversationId]: nextPref };
      persistChatPreferences(next);
      return next;
    });
  }, []);

  useEffect(() => {
    setMessageSearch("");
  }, [selectedConvId]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedConversation || !token || messages.length === 0) {
      setMessageSearchIndex({});
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const entries = await Promise.all(
        messages.map(async (message) => {
          const secretKey = getConversationSecretKeyForVersion(selectedConversation.id, message.keyVersion);
          const searchableText = await extractMessageSearchableText({
            secretKey,
            cipherText: message.cipherText,
            nonce: message.nonce,
          });
          return [message.id, searchableText] as const;
        })
      );

      if (!cancelled) {
        setMessageSearchIndex(Object.fromEntries(entries));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getConversationSecretKeyForVersion, messages, selectedConversation, token]);

  const emitTypingStop = useCallback((conversationId?: string | null) => {
    const activeConversationId = conversationId ?? typingSentConversationRef.current;
    if (!activeConversationId || !socket) return;
    socket.emit("typing_stop", { conversationId: activeConversationId });
    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (typingSentConversationRef.current === activeConversationId) {
      typingSentConversationRef.current = null;
    }
  }, [socket]);

  const onMessageDraftChange = useCallback((value: string) => {
    setMessageDraft(value);
    if (!selectedConvId || !socket) return;

    const pref = chatRealtimePreferences[selectedConvId] ?? DEFAULT_CHAT_PREFERENCES;
    if (!pref.typingIndicators || !value.trim()) {
      emitTypingStop(selectedConvId);
      return;
    }

    if (typingSentConversationRef.current !== selectedConvId) {
      if (typingSentConversationRef.current && typingSentConversationRef.current !== selectedConvId) {
        emitTypingStop(typingSentConversationRef.current);
      }
      socket.emit("typing_start", { conversationId: selectedConvId });
      typingSentConversationRef.current = selectedConvId;
    }

    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current);
    }
    typingStopTimerRef.current = window.setTimeout(() => {
      emitTypingStop(selectedConvId);
    }, 1200);
  }, [chatRealtimePreferences, emitTypingStop, selectedConvId, socket]);

  const myMinReadableKeyVersion = useMemo(() => {
    if (!selectedConversation || !user) return 1;
    return selectedConversation.members.find((m) => m.userId === user.id)?.minReadableKeyVersion ?? 1;
  }, [selectedConversation, user]);

  const sortedConversations = useMemo(() => {
    const getConversationLastActivity = (conversation: Conversation) => {
      const convoMessages = byConversation[conversation.id] ?? [];
      const lastMessageAt = convoMessages.length ? convoMessages[convoMessages.length - 1]!.createdAt : 0;
      return Math.max(lastMessageAt, new Date(conversation.createdAt).getTime());
    };

    return conversations
      .filter((c) => !archivedConvIds.has(c.id))
      .slice()
      .sort((a, b) => {
        const aPinned = pinnedConvIds.has(a.id) ? 1 : 0;
        const bPinned = pinnedConvIds.has(b.id) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return getConversationLastActivity(b) - getConversationLastActivity(a);
      });
  }, [byConversation, conversations, archivedConvIds, pinnedConvIds]);

  const archivedConversations = useMemo(() => {
    return conversations.filter((c) => archivedConvIds.has(c.id));
  }, [conversations, archivedConvIds]);

  const directConversations = useMemo(
    () => sortedConversations.filter((conversation) => conversation.type === "dm"),
    [sortedConversations],
  );

  const groupConversations = useMemo(
    () => sortedConversations.filter((conversation) => conversation.type === "group"),
    [sortedConversations],
  );

  const filteredGroupCreationFriends = useMemo(() => {
    const query = groupMemberSearch.trim().toLowerCase();
    if (!query) return friends;
    return friends.filter((friend) => friend.user.username.toLowerCase().includes(query));
  }, [friends, groupMemberSearch]);

  const filteredAddMembersFriends = useMemo(() => {
    const query = addMemberSearch.trim().toLowerCase();
    const currentMemberIds = new Set(selectedConversation?.members.map((m) => m.userId) ?? []);
    return friends.filter((friend) => {
      if (currentMemberIds.has(friend.user.id)) return false;
      if (!query) return true;
      return friend.user.username.toLowerCase().includes(query);
    });
  }, [friends, addMemberSearch, selectedConversation]);

  const hasUnreadDm = useMemo(() => {
    return conversations.some((conv) => {
      if (conv.type !== "dm") return false;
      return (unreadCountByConversation[conv.id] ?? 0) > 0;
    });
  }, [conversations, unreadCountByConversation]);

  const realtimeBadge = useMemo(() => {
    if (connected || connectionState === "connected") {
      return {
        label: "Realtime connected",
        className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
      };
    }
    if (connectionState === "connecting") {
      return {
        label: "Realtime connecting...",
        className: "border-amber-300/30 bg-amber-300/10 text-amber-200",
      };
    }
    if (connectionState === "error") {
      return {
        label: connectionError ? `Realtime error: ${connectionError}` : "Realtime error",
        className: "border-rose-400/30 bg-rose-400/10 text-rose-300",
      };
    }
    return {
      label: "Realtime disconnected",
      className: "border-rose-400/30 bg-rose-400/10 text-rose-300",
    };
  }, [connected, connectionError, connectionState]);

  const formatRecentTimestamp = useCallback((timestampMs: number) => {
    const now = Date.now();
    const diffMs = now - timestampMs;
    const minuteMs = 60_000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;

    if (diffMs < minuteMs) return "now";
    if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)}m`;
    if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h`;
    return `${Math.floor(diffMs / dayMs)}d`;
  }, []);

  const formatMessageTimestamp = useCallback((timestampMs: number) => {
    const tsDate = new Date(timestampMs);
    const now = new Date();
    const isSameDay =
      tsDate.getFullYear() === now.getFullYear() &&
      tsDate.getMonth() === now.getMonth() &&
      tsDate.getDate() === now.getDate();

    if (isSameDay) {
      return tsDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    return tsDate.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, []);

  const presenceLabel = useCallback((presence?: api.Presence | null) => {
    switch (presence) {
      case "online":
        return "Online";
      case "idle":
        return "Idle";
      case "dnd":
        return "Do Not Disturb";
      case "offline":
      default:
        return "Offline";
    }
  }, []);

  const presenceDotClass = useCallback((presence?: api.Presence | null) => {
    switch (presence) {
      case "online":
        return "bg-emerald-400";
      case "idle":
        return "bg-amber-400";
      case "dnd":
        return "bg-rose-400";
      case "offline":
      default:
        return "bg-slate-500";
    }
  }, []);

  // Get the "other" user's name in a DM
  const dmPartnerName = useMemo(() => {
    if (!selectedConversation || !user) return null;
    if (selectedConversation.name?.trim()) {
      return selectedConversation.name.trim();
    }
    const other = selectedConversation.members.find((m) => m.user.id !== user.id);
    const partnerUsername = other?.user.username ?? "Chat";
    return `${partnerUsername}#${shortConversationId(selectedConversation.id)}`;
  }, [selectedConversation, user]);

  const typingDisplayNames = useMemo(() => {
    if (!selectedConversation || !user) return [] as string[];
    const typingUserIds = (typingByConversation[selectedConversation.id] ?? []).filter((id) => id !== user.id);
    return typingUserIds
      .map((userId) => {
        const profile = profileById[userId];
        if (profile?.displayName?.trim()) return profile.displayName.trim();
        if (profile?.username) return profile.username;
        return selectedConversation.members.find((member) => member.userId === userId)?.user.username ?? null;
      })
      .filter((name): name is string => Boolean(name));
  }, [profileById, selectedConversation, typingByConversation, user]);

  const friendStatusByUserId = useMemo(() => {
    const map = new Map<string, "friend" | "incoming" | "outgoing">();
    for (const friend of friends) map.set(friend.user.id, "friend");
    for (const incoming of friendRequests.incoming) map.set(incoming.user.id, "incoming");
    for (const outgoing of friendRequests.outgoing) {
      if (!map.has(outgoing.user.id)) map.set(outgoing.user.id, "outgoing");
    }
    return map;
  }, [friendRequests.incoming, friendRequests.outgoing, friends]);

  const runFriendAction = useCallback(async (actionKey: string, action: () => Promise<void>) => {
    setFriendActionLoading((prev) => ({ ...prev, [actionKey]: true }));
    try {
      await action();
      setFriendError(null);
    } catch (err: any) {
      setFriendError(err?.message ?? "Friend action failed");
    } finally {
      setFriendActionLoading((prev) => ({ ...prev, [actionKey]: false }));
    }
  }, []);

  const loadFriendsData = useCallback(async () => {
    if (!token) return;
    const [friendList, requests] = await Promise.all([
      api.getFriends(token),
      api.getFriendRequests(token),
    ]);

    const profileUpdates: Array<Partial<api.UserProfile> & { id: string }> = [];
    for (const friend of friendList) {
      profileUpdates.push({
        id: friend.user.id,
        username: friend.user.username,
        displayName: friend.user.displayName ?? null,
        avatarUrl: friend.user.avatarUrl ?? null,
        presence: friend.user.presence ?? "offline",
        statusText: friend.user.statusText ?? null,
        statusEmoji: friend.user.statusEmoji ?? null,
      });
    }
    for (const request of [...requests.incoming, ...requests.outgoing]) {
      profileUpdates.push({
        id: request.user.id,
        username: request.user.username,
        displayName: request.user.displayName ?? null,
        avatarUrl: request.user.avatarUrl ?? null,
        presence: request.user.presence ?? "offline",
        statusText: request.user.statusText ?? null,
        statusEmoji: request.user.statusEmoji ?? null,
      });
    }

    mergeProfiles(profileUpdates);
    setFriends(friendList);
    setFriendRequests(requests);
  }, [token, mergeProfiles]);

  const sendFriendRequest = useCallback(async (targetUserId: string) => {
    if (!token) return;
    await runFriendAction(`send:${targetUserId}`, async () => {
      await api.sendFriendRequest(targetUserId, token);
      await loadFriendsData();
    });
  }, [loadFriendsData, runFriendAction, token]);

  const acceptIncomingRequest = useCallback(async (requestId: string) => {
    if (!token) return;
    await runFriendAction(`accept:${requestId}`, async () => {
      await api.acceptFriendRequest(requestId, token);
      await loadFriendsData();
    });
  }, [loadFriendsData, runFriendAction, token]);

  const declineIncomingRequest = useCallback(async (requestId: string) => {
    if (!token) return;
    await runFriendAction(`decline:${requestId}`, async () => {
      await api.declineFriendRequest(requestId, token);
      await loadFriendsData();
    });
  }, [loadFriendsData, runFriendAction, token]);

  const cancelOutgoingRequest = useCallback(async (requestId: string) => {
    if (!token) return;
    await runFriendAction(`cancel:${requestId}`, async () => {
      await api.cancelFriendRequest(requestId, token);
      await loadFriendsData();
    });
  }, [loadFriendsData, runFriendAction, token]);

  const removeFriend = useCallback(async (friendUserId: string) => {
    if (!token) return;
    await runFriendAction(`remove:${friendUserId}`, async () => {
      await api.removeFriend(friendUserId, token);
      // Remove DM conversations with this friend from local state
      setConversations((prev) => prev.filter((c) => {
        if (c.type !== "dm") return true;
        return !c.members.some((m) => m.userId === friendUserId);
      }));
      await loadFriendsData();
    });
  }, [loadFriendsData, runFriendAction, token]);

  const openProfilePopover = useCallback(
    async (userId: string, anchorEl?: HTMLElement | null) => {
      if (!token) return;
      setProfilePopoverUserId(userId);
      setProfilePopoverAnchor(anchorEl ? anchorEl.getBoundingClientRect() : null);
      await fetchProfile(userId, token);
    },
    [fetchProfile, token]
  );

  const closeProfilePopover = useCallback(() => {
    setProfilePopoverUserId(null);
    setProfilePopoverAnchor(null);
  }, []);

  const openMyProfilePopover = useCallback(
    (anchorEl?: HTMLElement | null) => {
      if (!user?.id) return;
      void openProfilePopover(user.id, anchorEl);
    },
    [openProfilePopover, user?.id]
  );

  /* ───── Electron version ───── */
  useEffect(() => {
    window.electronAPI?.getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  /* ───── Connect socket when token changes ───── */
  useEffect(() => {
    if (!token) {
      disconnect();
      return;
    }
    connect(token);
    return () => disconnect();
  }, [token, connect, disconnect]);

  /* ───── Load conversations when authenticated ───── */
  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const convs = await api.getConversations(token);
      setConversations(convs);
    } catch {
      // silently fail — server might not be ready yet
    }
  }, [token]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!token) {
      setFriends([]);
      setFriendRequests({ incoming: [], outgoing: [] });
      return;
    }
    loadFriendsData().catch(() => {
      setFriendError("Unable to load friends right now.");
    });
  }, [loadFriendsData, token]);

  useEffect(() => {
    if (!token) return;

    const refreshFriendsSilently = () => {
      loadFriendsData().catch(() => {
        // Keep background refresh silent to avoid noisy transient network errors.
      });
    };

    const onWindowFocus = () => refreshFriendsSilently();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshFriendsSilently();
      }
    };

    const onFriendshipsUpdated = () => {
      refreshFriendsSilently();
    };

    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    socket?.on("friendships_updated", onFriendshipsUpdated);

    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      socket?.off("friendships_updated", onFriendshipsUpdated);
    };
  }, [loadFriendsData, socket, token]);

  useEffect(() => {
    if (!socket) return;

    const onPresenceUpdated = (data: { userId: string; presence: api.Presence; lastActiveAt: string | null }) => {
      mergePresence(data.userId, data.presence, data.lastActiveAt);

      setFriends((prev) =>
        prev.map((friend) =>
          friend.user.id === data.userId
            ? { ...friend, user: { ...friend.user, presence: data.presence } }
            : friend,
        ),
      );

      setFriendRequests((prev) => ({
        incoming: prev.incoming.map((request) =>
          request.user.id === data.userId
            ? { ...request, user: { ...request.user, presence: data.presence } }
            : request,
        ),
        outgoing: prev.outgoing.map((request) =>
          request.user.id === data.userId
            ? { ...request, user: { ...request.user, presence: data.presence } }
            : request,
        ),
      }));
    };

    socket.on("presence_updated", onPresenceUpdated);
    return () => {
      socket.off("presence_updated", onPresenceUpdated);
    };
  }, [mergePresence, socket]);

  useEffect(() => {
    if (!socket || !user) return;

    const removeTypingUser = (conversationId: string, userId: string) => {
      const timerKey = `${conversationId}:${userId}`;
      const existingTimer = typingIndicatorTimeoutsRef.current[timerKey];
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        delete typingIndicatorTimeoutsRef.current[timerKey];
      }

      setTypingByConversation((prev) => {
        const current = prev[conversationId] ?? [];
        if (!current.includes(userId)) return prev;
        const nextUsers = current.filter((id) => id !== userId);
        if (!nextUsers.length) {
          const { [conversationId]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [conversationId]: nextUsers };
      });
    };

    const onTypingStart = (data: { userId: string; conversationId: string }) => {
      if (data.userId === user.id) return;

      const pref = chatRealtimePreferences[data.conversationId] ?? DEFAULT_CHAT_PREFERENCES;
      if (!pref.typingIndicators) return;

      setTypingByConversation((prev) => {
        const current = prev[data.conversationId] ?? [];
        if (current.includes(data.userId)) return prev;
        return { ...prev, [data.conversationId]: [...current, data.userId] };
      });

      const timerKey = `${data.conversationId}:${data.userId}`;
      const existingTimer = typingIndicatorTimeoutsRef.current[timerKey];
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      typingIndicatorTimeoutsRef.current[timerKey] = window.setTimeout(() => {
        removeTypingUser(data.conversationId, data.userId);
      }, 5000);
    };

    const onTypingStop = (data: { userId: string; conversationId: string }) => {
      if (data.userId === user.id) return;
      removeTypingUser(data.conversationId, data.userId);
    };

    const onMessageSeen = (data: { messageId: string; userId: string }) => {
      setSeenByMessageId((prev) => {
        const current = prev[data.messageId] ?? [];
        if (current.includes(data.userId)) return prev;
        return { ...prev, [data.messageId]: [...current, data.userId] };
      });
    };

    socket.on("typing_start", onTypingStart);
    socket.on("typing_stop", onTypingStop);
    socket.on("message_seen", onMessageSeen);

    return () => {
      socket.off("typing_start", onTypingStart);
      socket.off("typing_stop", onTypingStop);
      socket.off("message_seen", onMessageSeen);

      for (const timeoutId of Object.values(typingIndicatorTimeoutsRef.current)) {
        window.clearTimeout(timeoutId);
      }
      typingIndicatorTimeoutsRef.current = {};
    };
  }, [chatRealtimePreferences, socket, user]);

  useEffect(() => {
    if (!socket || !selectedConvId || !user) return;
    if (selectedConversation?.passcodeEnabled && !chatLock.isUnlocked(selectedConvId)) return;
    const pref = chatRealtimePreferences[selectedConvId] ?? DEFAULT_CHAT_PREFERENCES;
    if (!pref.readReceipts) return;

    const conversationMessages = byConversation[selectedConvId] ?? [];
    for (const message of conversationMessages) {
      if (message.senderId === user.id) continue;
      const dedupeKey = `${selectedConvId}:${message.id}`;
      if (seenSentRef.current.has(dedupeKey)) continue;
      socket.emit("message_seen", { messageId: message.id, conversationId: selectedConvId });
      seenSentRef.current.add(dedupeKey);
    }
  }, [byConversation, chatLock, chatRealtimePreferences, selectedConvId, selectedConversation, socket, user]);

  useEffect(() => {
    if (!token) return;
    if (navTab !== "friends") return;

    loadFriendsData().catch(() => {
      // Explicit refresh when opening the Friends tab.
    });
  }, [loadFriendsData, navTab, token]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (!token || !user) return;
    fetchMeProfile(token, user.id);
  }, [fetchMeProfile, token, user?.id]);

  useEffect(() => {
    if (!token) return;
    const ids = new Set<string>();

    for (const conv of conversations) {
      for (const member of conv.members) {
        ids.add(member.user.id);
      }
    }
    for (const friend of friends) ids.add(friend.user.id);
    for (const request of friendRequests.incoming) ids.add(request.user.id);
    for (const request of friendRequests.outgoing) ids.add(request.user.id);
    for (const result of searchResults) ids.add(result.id);

    ids.forEach((id) => {
      if (!profileById[id]) {
        void fetchProfile(id, token);
      }
    });
  }, [token, conversations, friends, friendRequests.incoming, friendRequests.outgoing, searchResults, profileById, fetchProfile]);

  useEffect(() => {
    if (navTab !== "home" && navTab !== "dm" && navTab !== "groups") {
      setActiveConversation(null);
      return;
    }
    setActiveConversation(selectedConvId);
  }, [navTab, selectedConvId, setActiveConversation]);

  useEffect(() => {
    setPendingFiles([]);
    setPendingGifs([]);
    setShowGifPicker(false);
    setGifQuery("");
    setGifResults([]);
    setGifError(null);
    setShowEmojiPicker(false);
    setEmojiQuery("");
    setGifActiveIndex(0);
    setEmojiActiveIndex(0);
    setMessageSendError(null);
    setReplyTargetMessageId(null);
    setThreadRootMessageId(null);
    setHoveredMessageId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [selectedConvId]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("orbit_recent_emojis");
      if (!stored) return;
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed)) {
        setRecentEmojis(parsed.filter((item) => typeof item === "string").slice(0, 16));
      }
    } catch {
      // Ignore malformed local cache.
    }
  }, []);

  useEffect(() => {
    if (!showChatSettings) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowChatSettings(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showChatSettings]);

  useEffect(() => {
    if (!showGifPicker && !showEmojiPicker) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const clickedInsideGif = Boolean(gifPickerRef.current?.contains(target) || gifButtonRef.current?.contains(target));
      const clickedInsideEmoji = Boolean(emojiPickerRef.current?.contains(target) || emojiButtonRef.current?.contains(target));

      if (!clickedInsideGif) setShowGifPicker(false);
      if (!clickedInsideEmoji) setShowEmojiPicker(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowGifPicker(false);
        setShowEmojiPicker(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showEmojiPicker, showGifPicker]);

  useEffect(() => {
    if (!user || mainView !== "chat" || navTab !== "dm") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const isEditable = Boolean(
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable),
      );

      const key = event.key.toLowerCase();
      const canCompose = Boolean(selectedConversation && !showChatSettings);

      if (key === "i" && canCompose) {
        event.preventDefault();
        fileInputRef.current?.click();
        return;
      }

      if (key === "g" && canCompose) {
        event.preventDefault();
        setShowGifPicker((prev) => {
          const next = !prev;
          if (next) {
            setShowEmojiPicker(false);
            setGifActiveIndex(0);
            requestAnimationFrame(() => gifSearchInputRef.current?.focus());
          }
          return next;
        });
        return;
      }

      if (key === "e" && canCompose) {
        event.preventDefault();
        setShowEmojiPicker((prev) => {
          const next = !prev;
          if (next) {
            setShowGifPicker(false);
            setEmojiActiveIndex(0);
            requestAnimationFrame(() => emojiSearchInputRef.current?.focus());
          }
          return next;
        });
        return;
      }

      if (key === "/" && canCompose && !isEditable) {
        event.preventDefault();
        messageInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [user, mainView, navTab, selectedConversation, showChatSettings]);

  /* ───── Load messages when selecting a conversation ───── */
  useEffect(() => {
    if (!selectedConvId || !token) return;

    // Lock the previously selected conversation when navigating away
    return () => {
      if (selectedConvId) {
        chatLock.onLeave(selectedConvId);
      }
    };
  }, [selectedConvId]);

  useEffect(() => {
    if (!typingSentConversationRef.current) return;
    if (selectedConvId === typingSentConversationRef.current) return;
    emitTypingStop(typingSentConversationRef.current);
  }, [emitTypingStop, selectedConvId]);

  useEffect(() => {
    return () => {
      emitTypingStop(typingSentConversationRef.current);
    };
  }, [emitTypingStop]);

  useEffect(() => {
    if (!selectedConvId || !token) return;
    // Only load messages if the conversation is unlocked or doesn't need a passcode
    const conv = conversations.find((c) => c.id === selectedConvId);
    if (conv?.passcodeEnabled && !chatLock.isUnlocked(selectedConvId)) return;

    api.getMessages(selectedConvId, token).then((msgs) => {
      for (const m of msgs) {
        upsertMessage(selectedConvId, {
          id: m.id,
          senderId: m.sender.id,
          sender: m.sender.username,
          parentMessageId: m.parentMessageId,
          cipherText: m.ciphertext,
          keyVersion: m.keyVersion,
          nonce: m.nonce,
          mediaIds: m.mediaIds ?? [],
          reactions: m.reactions ?? [],
          createdAt: new Date(m.createdAt).getTime(),
        }, { currentUserId: user?.id, markAsRead: true });
      }
    }).catch(() => {});

    // Join the room via socket
    socket?.emit("join_conversation", { conversationId: selectedConvId });
  }, [selectedConvId, token, socket, upsertMessage, user?.id]);

  /* ───── Refresh conversations on first inbound message ───── */
  useEffect(() => {
    if (!socket || !token) return;

    const handleNewMessage = (data: { conversationId: string; keyVersion?: number }) => {
      const existingConv = conversationsRef.current.find((conv) => conv.id === data.conversationId);
      if (!existingConv) {
        void loadConversations();
        return;
      }

      if (typeof data.keyVersion === "number") {
        const currentVersion = getConversationKeyVersion(data.conversationId) ?? 1;
        if (data.keyVersion > currentVersion && user) {
          void ensureConversationSecretKey({
            conversation: existingConv,
            token,
            myUserId: user.id,
            forceRefresh: true,
          });
        }
      }
    };

    socket.on("new_message", handleNewMessage);
    return () => {
      socket.off("new_message", handleNewMessage);
    };
  }, [socket, token, loadConversations, ensureConversationSecretKey, getConversationKeyVersion, user]);

  /* ───── Handle conversation_created: show passcode to recipient ───── */
  useEffect(() => {
    if (!socket || !user) return;

    const handleConversationCreated = (data: { conversation: Conversation; passcode: string | null }) => {
      // Add the new conversation to the list
      setConversations((prev) => {
        const withoutDup = prev.filter((c) => c.id !== data.conversation.id);
        return [data.conversation, ...withoutDup];
      });
      // Store the passcode to show when the recipient first opens this chat (groups only)
      if (data.passcode) {
        const otherMember = data.conversation.members.find((m) => m.userId !== user.id);
        const label = data.conversation.name?.trim()
          ? data.conversation.name.trim()
          : `${otherMember?.user.username ?? "chat"}#${data.conversation.id.slice(0, 4)}`;
        setDeferredPasscodes((prev) => ({
          ...prev,
          [data.conversation.id]: { passcode: data.passcode!, label },
        }));
      }
    };

    socket.on("conversation_created", handleConversationCreated);
    return () => {
      socket.off("conversation_created", handleConversationCreated);
    };
  }, [socket, user]);

  /* ───── Handle chat_settings_updated: sync changes from other member ───── */
  useEffect(() => {
    if (!socket) return;

    const handleSettingsUpdated = (data: { conversation: Conversation }) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === data.conversation.id ? data.conversation : c))
      );
    };

    socket.on("chat_settings_updated", handleSettingsUpdated);
    return () => {
      socket.off("chat_settings_updated", handleSettingsUpdated);
    };
  }, [socket]);

  /* ───── Handle passcode_reenabled: show new passcode to all members ───── */
  useEffect(() => {
    if (!socket || !user) return;

    const handlePasscodeReenabled = (data: { conversation: Conversation; passcode: string }) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === data.conversation.id ? data.conversation : c))
      );
      // Store the passcode to show when the user next opens this chat
      if (data.passcode) {
        const otherMember = data.conversation.members.find((m) => m.userId !== user.id);
        const label = data.conversation.name?.trim()
          ? data.conversation.name.trim()
          : `${otherMember?.user.username ?? "chat"}#${data.conversation.id.slice(0, 4)}`;
        setDeferredPasscodes((prev) => ({
          ...prev,
          [data.conversation.id]: { passcode: data.passcode, label },
        }));
      }
    };

    socket.on("passcode_reenabled", handlePasscodeReenabled);
    return () => {
      socket.off("passcode_reenabled", handlePasscodeReenabled);
    };
  }, [socket, user]);

  /* ───── Handle conversation_deleted: other user deleted a DM ───── */
  useEffect(() => {
    if (!socket || !user) return;

    const handleConversationDeleted = (data: { conversationId: string; deletedByUserId: string; type: string }) => {
      // Remove the conversation from local state
      setConversations((prev) => prev.filter((c) => c.id !== data.conversationId));
      if (selectedConvId === data.conversationId) {
        setSelectedConvId(null);
        setShowChatSettings(false);
      }
      // Also refresh friends since unfriending happened
      loadFriendsData();
    };

    socket.on("conversation_deleted", handleConversationDeleted);
    return () => {
      socket.off("conversation_deleted", handleConversationDeleted);
    };
  }, [socket, user, selectedConvId, loadFriendsData]);

  /* ───── Handle member_removed: current user removed from a group ───── */
  useEffect(() => {
    if (!socket) return;

    const handleMemberRemoved = (data: { conversationId: string; removedByUserId: string }) => {
      setConversations((prev) => prev.filter((c) => c.id !== data.conversationId));
      if (selectedConvId === data.conversationId) {
        setSelectedConvId(null);
        setShowChatSettings(false);
      }
    };

    socket.on("member_removed", handleMemberRemoved);
    return () => {
      socket.off("member_removed", handleMemberRemoved);
    };
  }, [socket, selectedConvId]);

  /* ───── Handle member_left: someone left a group chat ───── */
  useEffect(() => {
    if (!socket || !token || !user) return;

    const handleMemberLeft = (data: { conversationId: string; userId: string; messagesWiped: boolean }) => {
      const existingConv = conversationsRef.current.find((c) => c.id === data.conversationId);

      // Update the conversation member list
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== data.conversationId) return c;
          return { ...c, members: c.members.filter((m) => m.userId !== data.userId) };
        })
      );

      if (existingConv) {
        void ensureConversationSecretKey({
          conversation: existingConv,
          token,
          myUserId: user.id,
          forceRefresh: true,
        });
      }
    };

    socket.on("member_left", handleMemberLeft);
    return () => {
      socket.off("member_left", handleMemberLeft);
    };
  }, [socket, token, user, ensureConversationSecretKey]);

  /* ───── Handle member_added: new member joined group chat ───── */
  useEffect(() => {
    if (!socket || !user || !token) return;

    const handleMemberAdded = (data: { conversation: Conversation; passcode: string | null; addedByUserId: string }) => {
      // Update the conversation with new members list
      setConversations((prev) => {
        const withoutDup = prev.filter((c) => c.id !== data.conversation.id);
        return [data.conversation, ...withoutDup];
      });

      void ensureConversationSecretKey({
        conversation: data.conversation,
        token,
        myUserId: user.id,
        forceRefresh: true,
      });

      // If there's a passcode and I wasn't the one who added the members, show it
      if (data.passcode && data.addedByUserId !== user.id) {
        const label = data.conversation.name?.trim()
          ? data.conversation.name.trim()
          : `Group#${data.conversation.id.slice(0, 4)}`;
        setDeferredPasscodes((prev) => ({
          ...prev,
          [data.conversation.id]: { passcode: data.passcode!, label },
        }));
      }
    };

    socket.on("member_added", handleMemberAdded);
    return () => {
      socket.off("member_added", handleMemberAdded);
    };
  }, [socket, user, token, ensureConversationSecretKey]);

  /* ───── Ensure conversation secret key for selected conversation ───── */
  useEffect(() => {
    if (!token || !user || !selectedConversation) return;
    ensureConversationSecretKey({ conversation: selectedConversation, token, myUserId: user.id });
  }, [token, user?.id, selectedConversation, ensureConversationSecretKey]);

  /* ───── Reset inactivity timer on user interactions ───── */
  useEffect(() => {
    if (!selectedConvId) return;
    const conv = conversations.find((c) => c.id === selectedConvId);
    if (!conv || conv.lockMode !== "after_inactivity") return;
    if (!chatLock.isUnlocked(selectedConvId)) return;

    const handleActivity = () => chatLock.resetInactivity(selectedConvId);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("pointermove", handleActivity);
    window.addEventListener("pointerdown", handleActivity);
    return () => {
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("pointermove", handleActivity);
      window.removeEventListener("pointerdown", handleActivity);
    };
  }, [selectedConvId, conversations, chatLock]);

  /* ───── Search users ───── */
  useEffect(() => {
    const query = search.trim();
    if (!query || !token) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api.searchUsers(query, token).then(setSearchResults).catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, token]);

  useEffect(() => {
    if (!showGifPicker) return;
    const query = gifQuery.trim() || "trending";
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setGifLoading(true);
      setGifError(null);
      try {
        if (!GIPHY_API_KEY) {
          throw new Error("VITE_GIPHY_API_KEY is missing. Set it in orbit-chat/.env.");
        }

        const response = await fetch(
          `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_API_KEY)}&q=${encodeURIComponent(query)}&limit=${GIF_SEARCH_LIMIT}&rating=pg-13&lang=en`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`GIF search failed (${response.status})`);
        }

        const data = await response.json() as {
          data?: Array<{
            id?: string;
            title?: string;
            images?: {
              original?: { url?: string };
              fixed_width_small?: { url?: string };
            };
          }>;
        };
        const parsed = (data.data ?? [])
          .map((item) => {
            const gifUrl = normalizeGifUrl(item.images?.original?.url ?? "");
            const previewUrl = normalizeGifUrl(item.images?.fixed_width_small?.url ?? "") ?? gifUrl;
            if (!gifUrl || !previewUrl || !item.id) return null;
            return {
              id: item.id,
              title: item.title ?? "GIF",
              gifUrl,
              previewUrl,
            } satisfies GifSearchResult;
          })
          .filter((item): item is GifSearchResult => Boolean(item));
        setGifResults(parsed);
      } catch (err: any) {
        if (controller.signal.aborted) return;
        setGifResults([]);
        setGifError(err?.message ?? "Unable to search GIFs right now.");
      } finally {
        if (!controller.signal.aborted) {
          setGifLoading(false);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [gifQuery, showGifPicker]);

  const handleAddGif = useCallback((gif: GifSearchResult) => {
    // Keep a single selected GIF so choosing another one updates the preview.
    setPendingGifs([
      {
        kind: "gif_link",
        url: gif.gifUrl,
        previewUrl: gif.previewUrl,
        title: gif.title,
      },
    ]);
    setMessageSendError(null);
    setShowGifPicker(false);
  }, []);

  const handleInsertEmoji = useCallback((emoji: string) => {
    setMessageDraft((prev) => `${prev}${emoji}`);
    setRecentEmojis((prev) => {
      const next = [emoji, ...prev.filter((value) => value !== emoji)].slice(0, 16);
      try {
        localStorage.setItem("orbit_recent_emojis", JSON.stringify(next));
      } catch {
        // Ignore quota/storage access errors.
      }
      return next;
    });
    setShowEmojiPicker(false);
  }, []);

  const toggleGifPicker = useCallback(() => {
    setShowGifPicker((prev) => {
      const next = !prev;
      if (next) {
        setShowEmojiPicker(false);
        setGifActiveIndex(0);
        requestAnimationFrame(() => gifSearchInputRef.current?.focus());
      }
      return next;
    });
  }, []);

  const toggleEmojiPicker = useCallback(() => {
    setShowEmojiPicker((prev) => {
      const next = !prev;
      if (next) {
        setShowGifPicker(false);
        setEmojiActiveIndex(0);
        requestAnimationFrame(() => emojiSearchInputRef.current?.focus());
      }
      return next;
    });
  }, []);

  const filteredEmojis = useMemo(() => {
    const query = emojiQuery.trim().toLowerCase();
    if (!query) return EMOJI_CATALOG.slice(0, 80);
    return EMOJI_CATALOG.filter((item) => item.tags.some((tag) => tag.includes(query))).slice(0, 40);
  }, [emojiQuery]);

  useEffect(() => {
    setGifActiveIndex((prev) => {
      if (!gifResults.length) return 0;
      return Math.min(prev, gifResults.length - 1);
    });
  }, [gifResults]);

  useEffect(() => {
    setEmojiActiveIndex((prev) => {
      if (!filteredEmojis.length) return 0;
      return Math.min(prev, filteredEmojis.length - 1);
    });
  }, [filteredEmojis]);

  /* ───── Auth submit ───── */
  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUsername = username.trim();
    const strongPasswordRegex = /^(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

    if (!trimmedUsername) {
      setAuthValidationError("Username is required.");
      return;
    }

    if (authMode === "recovery") {
      if (!recoveryCode.trim()) {
        setAuthValidationError("Recovery code is required.");
        return;
      }
      setAuthValidationError(null);
      await loginWithRecoveryCode(trimmedUsername, recoveryCode.trim());
      setRecoveryCode("");
      setPassword("");
      return;
    }

    if (authMode === "signup") {
      if (password !== confirmPassword) {
        setAuthValidationError("Passwords do not match.");
        return;
      }
      if (!strongPasswordRegex.test(password)) {
        setAuthValidationError("Password must be 8+ characters and include a number and special character.");
        return;
      }
    }

    setAuthValidationError(null);
    if (authMode === "login") {
      await login(trimmedUsername, password);
    } else {
      await signup(trimmedUsername, password);
    }
    setPassword("");
    setConfirmPassword("");
  };

  /* ───── Delete DM / Leave Group ───── */
  const handleDeleteOrLeave = async () => {
    if (!deleteModal || !token) {
      devLog.warn(`handleDeleteOrLeave aborted: deleteModal=${!!deleteModal}, token=${!!token}`);
      return;
    }
    devLog.info(`handleDeleteOrLeave: type=${deleteModal.type}, conv=${deleteModal.conversationId}, wipe=${deleteWipeMessages}`);
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      if (deleteModal.type === "dm") {
        await api.deleteConversation(deleteModal.conversationId, deleteWipeMessages, token);
        devLog.info("deleteConversation API call succeeded");
        setConversations((prev) => prev.filter((c) => c.id !== deleteModal.conversationId));
        await loadFriendsData();
      } else {
        const conv = conversations.find((c) => c.id === deleteModal.conversationId);
        let encryptedKeys: Record<string, string> | undefined;
        if (conv && conv.type === "group") {
          const remainingMembers = conv.members.filter((m) => m.userId !== user?.id);
          if (remainingMembers.length > 0) {
            const rotatedSecretKey = await generateSecretKey();
            encryptedKeys = {};
            for (const member of remainingMembers) {
              const memberKeys = await api.getUserKeys(member.userId, token);
              const publicKey = latestPublicKey(memberKeys);
              if (!publicKey) {
                throw new Error(`Could not get public key for member ${member.userId}`);
              }
              encryptedKeys[member.userId] = await sealToPublicKey(rotatedSecretKey, publicKey);
            }
          }
        }
        await api.leaveGroupChat(deleteModal.conversationId, deleteWipeMessages, token, encryptedKeys);
        devLog.info("leaveGroupChat API call succeeded");
        setConversations((prev) => prev.filter((c) => c.id !== deleteModal.conversationId));
      }
      if (selectedConvId === deleteModal.conversationId) {
        setSelectedConvId(null);
        setShowChatSettings(false);
      }
      setDeleteModal(null);
      setDeleteWipeMessages(true);
    } catch (err: any) {
      devLog.error(`handleDeleteOrLeave failed: ${err?.message}`, err?.stack);
      setDeleteError(err?.message ?? "Action failed");
    } finally {
      setDeleteLoading(false);
    }
  };

  const openDeleteModal = (conv: Conversation) => {
    const otherMember = conv.members.find((m) => m.user.id !== user?.id);
    const displayName = conv.type === "dm"
      ? (conv.name?.trim() ? conv.name.trim() : `@${otherMember?.user.username ?? "dm"}`)
      : (conv.name ?? "Group");
    setDeleteWipeMessages(true);
    setDeleteError(null);
    setDeleteModal({ conversationId: conv.id, type: conv.type, displayName });
  };

  /* ───── Archive / Unarchive conversation ───── */
  const archiveConversation = (convId: string) => {
    const next = new Set(archivedConvIds);
    next.add(convId);
    persistArchived(next);
    if (selectedConvId === convId) {
      setSelectedConvId(null);
      setShowChatSettings(false);
    }
  };

  const unarchiveConversation = (convId: string) => {
    const next = new Set(archivedConvIds);
    next.delete(convId);
    persistArchived(next);
  };

  /* ───── Build context menu items for a conversation ───── */
  const buildConvContextMenuItems = (conv: Conversation): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    const isArchived = archivedConvIds.has(conv.id);
    const isPinned = pinnedConvIds.has(conv.id);
    const isLocked = conv.passcodeEnabled && !chatLock.isUnlocked(conv.id);

    // Re-lock
    if (conv.passcodeEnabled && chatLock.isUnlocked(conv.id)) {
      items.push({
        type: "item",
        label: "Relock chat",
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        ),
        onClick: () => chatLock.lock(conv.id),
      });
    }

    items.push({
      type: "item",
      label: isPinned ? "Unpin chat" : "Pin chat",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3l7 7-4 1-2 7-4-4-7 2 2-7-4-4 7-2 1-4z" />
        </svg>
      ),
      onClick: () => {
        const next = new Set(pinnedConvIds);
        if (isPinned) next.delete(conv.id);
        else next.add(conv.id);
        persistPinned(next);
      },
    });

    // Archive / Unarchive
    items.push({
      type: "item",
      label: isArchived ? "Unarchive" : "Archive",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="4" rx="1.2" /><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>
      ),
      onClick: () => isArchived ? unarchiveConversation(conv.id) : archiveConversation(conv.id),
    });

    items.push({ type: "separator" });

    // Delete / Leave
    items.push({
      type: "item",
      label: conv.type === "dm" ? "Delete chat" : "Leave group",
      danger: true,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
      ),
      onClick: () => openDeleteModal(conv),
    });

    return items;
  };

  const renderConversationList = (conversationList: Conversation[], emptyText: string) => (
    <div className="mt-2 flex-1 space-y-2 overflow-y-auto pr-1">
      {conversationList.map((conv) => {
        const isSelected = conv.id === selectedConvId;
        const isPinned = pinnedConvIds.has(conv.id);
        const otherMember = conv.members.find((m) => m.user.id !== user?.id);
        const otherUserId = otherMember?.user.id ?? "";
        const otherUsername = otherMember?.user.username ?? "dm";
        const avatarUrl = profileById[otherUserId]?.avatarUrl ?? null;
        const convoMessages = byConversation[conv.id] ?? [];
        const lastMessage = convoMessages.length ? convoMessages[convoMessages.length - 1] : null;
        const displayName =
          conv.type === "dm"
            ? (conv.name?.trim()
              ? conv.name.trim()
              : `${otherUsername}#${shortConversationId(conv.id)}`)
            : conv.name ?? "Group";
        const preview = lastMessage
          ? `${lastMessage.sender === user?.username ? "You" : lastMessage.sender}: Encrypted message`
          : conv.type === "dm"
            ? "Direct message"
            : `${conv.members.length} members`;
        const activityTime = lastMessage
          ? formatRecentTimestamp(lastMessage.createdAt)
          : formatRecentTimestamp(new Date(conv.createdAt).getTime());
        const unreadCount = unreadCountByConversation[conv.id] ?? 0;

        return (
          <button
            key={conv.id}
            className={`w-full rounded-xl border p-3 text-left transition ${
              isSelected
                ? "border-orbit-accent/60 bg-orbit-accent/10 shadow-[0_8px_20px_rgba(18,201,180,0.15)]"
                : "border-white/5 bg-[#202533] hover:border-white/20"
            }`}
            onContextMenu={(e) => ctxMenu.show(e, buildConvContextMenuItems(conv))}
            onClick={() => {
              setNavTab(conv.type === "dm" ? "dm" : "groups");
              const deferred = deferredPasscodes[conv.id];
              if (deferred) {
                setPendingChatPasscode({ conversationId: conv.id, ...deferred });
                setDeferredPasscodes((prev) => {
                  const next = { ...prev };
                  delete next[conv.id];
                  return next;
                });
              }
              setSelectedConvId(conv.id);
              setPasscodeInput("");
              setPasscodeError(null);
              setShowBypassInput(false);
              setShowChatSettings(false);
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panelAlt text-[11px] font-semibold text-orbit-text">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={`@${otherUsername}`} className="h-full w-full object-cover" />
                  ) : (
                    (otherUsername[0] ?? "D").toUpperCase()
                  )}
                </div>
                {conv.passcodeEnabled && !chatLock.isUnlocked(conv.id) && (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-orbit-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
                <p className="truncate text-sm font-semibold">@{displayName}</p>
                {isPinned && (
                  <span className="rounded-full border border-orbit-accent/30 bg-orbit-accent/10 px-2 py-0.5 text-[10px] font-semibold text-orbit-accent">
                    Pinned
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full bg-orbit-accent px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-950">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-orbit-muted">{activityTime}</span>
              </div>
            </div>
            <p className="mt-1 truncate text-xs text-slate-400">{preview}</p>
          </button>
        );
      })}
      {conversationList.length === 0 && (
        <p className="text-xs text-orbit-muted">{emptyText}</p>
      )}
    </div>
  );

  /* ───── Open or create a DM with a user ───── */
  const startDM = async (targetUser: { id: string; username: string }) => {
    if (!token) return;
    if (!user) return;

    setMainView("chat");
    setNavTab("dm");

    try {
      const { publicKey: myPublicKey } = await ensureDeviceKeypair(user.id, token);
      const otherKeys = await api.getUserKeys(targetUser.id, token);
      const otherPublicKey = latestPublicKey(otherKeys);
      if (!otherPublicKey) return;

      const secretKey = await generateSecretKey();
      const encryptedKeys: Record<string, string> = {
        [user.id]: await sealToPublicKey(secretKey, myPublicKey),
        [targetUser.id]: await sealToPublicKey(secretKey, otherPublicKey),
      };

      const conv = await api.createConversation(
        { type: "dm", memberIds: [targetUser.id], encryptedKeys },
        token
      );

      const mergedConversations = [conv, ...conversations.filter((existingConv) => existingConv.id !== conv.id)];
      setConversations(mergedConversations);

      // Keep exactly one active DM thread per user: unarchive the selected DM, archive older duplicates.
      const dmThreadsWithTarget = mergedConversations.filter(
        (c) => c.type === "dm" && c.members.some((m) => m.user.id === targetUser.id)
      );
      const nextArchived = new Set(archivedConvIds);
      nextArchived.delete(conv.id);
      for (const thread of dmThreadsWithTarget) {
        if (thread.id !== conv.id) {
          nextArchived.add(thread.id);
        }
      }
      persistArchived(nextArchived);

      setSelectedConvId(conv.id);
      setMainView("chat");
      setSearch("");
      setSearchResults([]);

      // Existing DM returned — just navigate, no passcode
      if (conv.created === false) {
        chatLock.unlock(conv.id, conv.lockMode, conv.lockTimeoutSeconds);
        await ensureConversationSecretKey({ conversation: conv, token, myUserId: user.id });
        return;
      }

      // Newly created DM — no passcode for DMs, just auto-unlock
      chatLock.unlock(conv.id, conv.lockMode, conv.lockTimeoutSeconds);

      await ensureConversationSecretKey({ conversation: conv, token, myUserId: user.id });
    } catch {
      // handle error
    }
  };

  /* ───── Create a new group chat ───── */
  const startGroupChat = async () => {
    if (!token) return;
    if (!user) return;
    if (groupCreationModal.selectedMemberIds.size === 0) {
      setGroupCreationModal((prev) => ({ ...prev, error: "Select at least one member" }));
      return;
    }

    setGroupCreationModal((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const { publicKey: myPublicKey } = await ensureDeviceKeypair(user.id, token);
      const memberIds = Array.from(groupCreationModal.selectedMemberIds);

      // Get public keys for all members
      const memberPublicKeys: Record<string, string> = {};
      for (const memberId of memberIds) {
        const memberKeys = await api.getUserKeys(memberId, token);
        const publicKey = latestPublicKey(memberKeys);
        if (!publicKey) {
          throw new Error(`Could not get public key for member ${memberId}`);
        }
        memberPublicKeys[memberId] = publicKey;
      }

      // Create group secret key and encrypt for all members + creator
      const secretKey = await generateSecretKey();
      const encryptedKeys: Record<string, string> = {
        [user.id]: await sealToPublicKey(secretKey, myPublicKey),
      };

      for (const memberId of memberIds) {
        encryptedKeys[memberId] = await sealToPublicKey(secretKey, memberPublicKeys[memberId]);
      }

      // Create group conversation
      const conv = await api.createConversation(
        {
          type: "group",
          name: groupCreationModal.groupName || "New Group",
          memberIds,
          encryptedKeys,
        },
        token
      );

      setConversations((prev) => [conv, ...prev]);
      setSelectedConvId(conv.id);
      setMainView("chat");
      setSearch("");
      setSearchResults([]);

      // Show passcode to creator if present
      if (conv.passcode) {
        setPendingChatPasscode({
          conversationId: conv.id,
          passcode: conv.passcode,
          label: conv.name?.trim() || groupCreationModal.groupName || "New Group",
        });
        // Don't auto-unlock — passcode modal will handle it
      } else {
        // No passcode — auto-unlock with default settings
        chatLock.unlock(conv.id, conv.lockMode, conv.lockTimeoutSeconds);
      }

      await ensureConversationSecretKey({ conversation: conv, token, myUserId: user.id });

      // Close modal and reset
      setGroupCreationModal({
        open: false,
        selectedMemberIds: new Set(),
        groupName: "",
        loading: false,
        error: null,
      });
      setGroupMemberSearch("");
    } catch (err: any) {
      setGroupCreationModal((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to create group",
      }));
    }
  };

  /* ───── Add members to existing group ───── */
  const addMembersToGroup = async () => {
    if (!token) return;
    if (!user) return;
    if (!addMembersModal.conversationId) return;
    if (addMembersModal.selectedMemberIds.size === 0) {
      setAddMembersModal((prev) => ({ ...prev, error: "Select at least one member" }));
      return;
    }

    setAddMembersModal((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const conv = conversations.find((c) => c.id === addMembersModal.conversationId);
      if (!conv) throw new Error("Conversation not found");

      const { publicKey: myPublicKey } = await ensureDeviceKeypair(user.id, token);
      const memberIds = Array.from(addMembersModal.selectedMemberIds);
      const existingMemberIds = conv.members.map((m) => m.userId);
      const resultingMemberIds = Array.from(new Set([...existingMemberIds, ...memberIds]));
      const memberPublicKeys: Record<string, string> = {
        [user.id]: myPublicKey,
      };

      // Get public keys for all resulting members after add.
      for (const memberId of resultingMemberIds) {
        if (memberId === user.id) continue;
        const memberKeys = await api.getUserKeys(memberId, token);
        const publicKey = latestPublicKey(memberKeys);
        if (!publicKey) {
          throw new Error(`Could not get public key for member ${memberId}`);
        }
        memberPublicKeys[memberId] = publicKey;
      }

      // Rotate to a new group key version for this membership change.
      const rotatedSecretKey = await generateSecretKey();
      const encryptedKeys: Record<string, string> = {};
      for (const memberId of resultingMemberIds) {
        encryptedKeys[memberId] = await sealToPublicKey(rotatedSecretKey, memberPublicKeys[memberId]);
      }

      // Add members via API
      await api.addMembers(conv.id, { memberIds, encryptedKeys }, token);

      // Keep local sender key cache aligned to the new version immediately.
      const nextKeyVersion = (getConversationKeyVersion(conv.id) ?? 1) + 1;
      setConversationSecretKeyVersion({
        conversationId: conv.id,
        keyVersion: nextKeyVersion,
        secretKey: rotatedSecretKey,
      });

      // Refresh conversation to get updated member list
      const updated = await api.getConversations(token);
      const updatedConv = updated.find((c) => c.id === conv.id);
      if (updatedConv) {
        setConversations((prev) =>
          prev.map((c) => (c.id === updatedConv.id ? updatedConv : c))
        );
      }

      // Close modal and reset
      setAddMembersModal({
        open: false,
        conversationId: null,
        selectedMemberIds: new Set(),
        loading: false,
        error: null,
      });
      setAddMemberSearch("");
    } catch (err: any) {
      setAddMembersModal((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to add members",
      }));
    }
  };

  const handleAttachFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted = Array.from(files).filter((file) => {
      if (!file.type.startsWith("image/")) return false;
      return file.size <= 50 * 1024 * 1024;
    });
    if (!accepted.length) {
      setMessageSendError("Only image files up to 50MB are supported.");
      return;
    }
    setMessageSendError(null);
    setPendingFiles((prev) => [...prev, ...accepted]);
  };

  const handleToggleReaction = (messageId: string, emoji: "👍" | "❤️" | "😂") => {
    if (!socket || !selectedConvId) return;
    socket.emit("toggle_reaction", { messageId, emoji, conversationId: selectedConvId });
  };

  const handleQuickReply = (messageId: string) => {
    setReplyTargetMessageId(messageId);
    messageInputRef.current?.focus();
  };

  const handlePingMessageAuthor = (username: string) => {
    const mention = `@${username} `;
    setMessageDraft((prev) => {
      if (prev.startsWith(mention)) return prev;
      return `${mention}${prev}`;
    });
    messageInputRef.current?.focus();
  };

  const openThreadView = (messageId: string) => {
    const message = messageById.get(messageId);
    const rootId = message?.parentMessageId ?? messageId;
    setThreadRootMessageId(rootId);
    setReplyTargetMessageId(rootId);
    messageInputRef.current?.focus();
  };

  const buildMessageContextMenuItems = (message: (typeof messages)[number], senderLabel: string): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        type: "item",
        label: `Reply to ${senderLabel}`,
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 17l-5-5 5-5" />
            <path d="M5 12h9a4 4 0 0 1 4 4v3" />
          </svg>
        ),
        onClick: () => handleQuickReply(message.id),
      },
      {
        type: "item",
        label: `Open thread`,
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 6h14" />
            <path d="M5 12h10" />
            <path d="M5 18h6" />
          </svg>
        ),
        onClick: () => openThreadView(message.id),
      },
    ];

    if (message.senderId !== user?.id) {
      items.splice(1, 0, {
        type: "item",
        label: `Ping @${message.sender}`,
        icon: (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4v5a2 2 0 0 0 2 2h3" />
            <path d="M5 20h14" />
            <path d="M7 20V8a4 4 0 0 1 4-4h5" />
          </svg>
        ),
        onClick: () => handlePingMessageAuthor(message.sender),
      });
    }

    items.push({ type: "separator" });
    for (const emoji of ["👍", "❤️", "😂"] as const) {
      items.push({
        type: "item",
        label: `React ${emoji}`,
        icon: <span className="text-sm leading-none">{emoji}</span>,
        onClick: () => handleToggleReaction(message.id, emoji),
      });
    }

    return items;
  };

  /* ───── Send message over socket ───── */
  const handleSendMessage = async () => {
    const draft = messageDraft.trim();
    const hasAttachments = pendingFiles.length > 0 || pendingGifs.length > 0;
    if (!selectedConvId || !user || !socket) return;
    if (!token) return;
    if (!draft && !hasAttachments) return;

    if (!selectedConversation) return;

    try {
      const secretKey = await ensureConversationSecretKey({
        conversation: selectedConversation,
        token,
        myUserId: user.id,
      });
      if (!secretKey) return;

      const attachments: MessageAttachment[] = [];
      const mediaIds: string[] = [];
      const usedCacheKeys: string[] = [];

      for (const file of pendingFiles) {
        const cacheKey = `${selectedConvId}:${file.name}:${file.size}:${file.lastModified}`;
        const cachedAttachment = uploadedAttachmentCacheRef.current[cacheKey];
        if (cachedAttachment) {
          attachments.push(cachedAttachment);
          mediaIds.push(cachedAttachment.mediaId);
          usedCacheKeys.push(cacheKey);
          continue;
        }

        const plainBytes = new Uint8Array(await file.arrayBuffer());
        const fileKey = await generateSecretKey();
        const preferredChunkSize = file.size > 10 * 1024 * 1024 ? 512 * 1024 : 256 * 1024;
        const encrypted = await encryptChunkedBytes(plainBytes, fileKey, preferredChunkSize);
        const encryptedSha256 = await sha256Base64(encrypted.encryptedBytes);

        const reservation = await api.requestMediaUploadUrl(
          {
            conversationId: selectedConvId,
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            contentLength: encrypted.encryptedBytes.length,
            sha256: encryptedSha256,
          },
          token
        );

        await api.uploadEncryptedBlob(
          reservation.uploadUrl,
          new Blob([new Uint8Array(encrypted.encryptedBytes).buffer], { type: "application/octet-stream" })
        );

        const wrappedFileKey = await encryptMessage(fileKey, secretKey);
        const attachment: UploadedAttachment = {
          kind: file.type.startsWith("image/") ? "image" : "file",
          mediaId: reservation.mediaId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          fileKeyCiphertext: wrappedFileKey.cipherText,
          fileKeyNonce: wrappedFileKey.nonce,
          chunkSize: encrypted.chunkSize,
          chunkCount: encrypted.chunkCount,
          encryptedSha256,
        };
        attachments.push(attachment);
        mediaIds.push(reservation.mediaId);
        uploadedAttachmentCacheRef.current[cacheKey] = attachment;
        usedCacheKeys.push(cacheKey);
      }

      for (const gif of pendingGifs) {
        const safeUrl = normalizeGifUrl(gif.url);
        const safePreview = gif.previewUrl ? (normalizeGifUrl(gif.previewUrl) ?? undefined) : undefined;
        if (!safeUrl) continue;
        attachments.push({
          kind: "gif_link",
          url: safeUrl,
          previewUrl: safePreview,
          title: gif.title,
        });
      }

      const envelope: MessageEnvelope = {
        text: draft || undefined,
        attachments,
      };

      const { cipherText, nonce } = await encryptMessage(JSON.stringify(envelope), secretKey);

      socket.emit("send_message", {
        conversationId: selectedConvId,
        ciphertext: cipherText,
        nonce,
        parentMessageId: activeReplyParentMessageId ?? undefined,
        keyVersion: getConversationKeyVersion(selectedConvId) ?? 1,
        mediaIds,
        type: attachments.length ? "media" : "text",
      });

      emitTypingStop(selectedConvId);

      setMessageDraft("");
      setPendingFiles([]);
      setPendingGifs([]);
      setMessageSendError(null);
      if (!threadRootMessageId) {
        setReplyTargetMessageId(null);
      }
      for (const key of usedCacheKeys) {
        delete uploadedAttachmentCacheRef.current[key];
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      setMessageSendError(err?.message ?? "Failed to send message");
    }
  };

  /* ════════════════════════════════════════════════════ */
  /*  NEW CHAT PASSCODE DISPLAY (shown once on creation)  */
  /* ════════════════════════════════════════════════════ */
  if (user && pendingChatPasscode) {
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-gradient-to-br from-orbit-bg via-orbit-panelAlt to-orbit-panel text-orbit-text">
        <TitleBar />
        <div className="flex flex-1 items-start justify-center p-6 sm:items-center">
        <section className="orbit-card relative z-10 w-full max-w-md rounded-3xl p-8">
          <div className="mb-2 flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-orbit-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <h2 className="text-xl font-bold text-orbit-text">Chat Passcode</h2>
          </div>
          <p className="mb-4 text-sm text-orbit-muted">
            This chat has been secured with a passcode. You'll need to enter it every time you open this chat.
            <span className="mt-1 block font-semibold text-amber-300">
              Save this passcode — you will not see it again.
            </span>
          </p>
          <p className="mb-3 text-center text-xs text-orbit-muted">Chat: @{pendingChatPasscode.label}</p>
          <div className="flex items-center justify-center rounded-xl border border-white/10 bg-orbit-panelAlt p-6">
            <span className="font-mono text-4xl font-bold tracking-[0.3em] text-orbit-accent">
              {pendingChatPasscode.passcode}
            </span>
          </div>
          <p className="mt-3 text-center text-xs text-orbit-muted">
            You can use an account recovery code to bypass this passcode if you forget it.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              className="orbit-btn flex-1"
              onClick={() => void navigator.clipboard.writeText(pendingChatPasscode.passcode)}
            >
              Copy
            </button>
            <button
              className="orbit-btn-primary flex-1"
              onClick={() => setPendingChatPasscode(null)}
            >
              I've saved it
            </button>
          </div>
        </section>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════ */
  /*  RECOVERY CODES DISPLAY (shown once after signup)    */
  /* ════════════════════════════════════════════════════ */
  if (user && pendingRecoveryCodes && pendingRecoveryCodes.length > 0) {
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-gradient-to-br from-orbit-bg via-orbit-panelAlt to-orbit-panel text-orbit-text">
        <TitleBar />
        <div className="flex flex-1 items-start justify-center p-6 sm:items-center">
        <section className="orbit-card relative z-10 w-full max-w-lg rounded-3xl p-8">
          <div className="mb-2 flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-orbit-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <h2 className="text-xl font-bold text-orbit-text">Your Recovery Codes</h2>
          </div>
          <p className="mb-4 text-sm text-orbit-muted">
            Save these codes somewhere safe. Each code can only be used once to log in if you forget your password.
            <span className="mt-1 block font-semibold text-amber-300">
              You will not see these codes again after leaving this screen.
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-orbit-panelAlt p-4">
            {pendingRecoveryCodes.map((code, idx) => (
              <div key={idx} className="rounded-lg border border-white/10 bg-orbit-panel px-3 py-2 text-center font-mono text-sm tracking-wider text-orbit-text">
                {code}
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <button
              className="orbit-btn flex-1"
              onClick={() => {
                void navigator.clipboard.writeText(pendingRecoveryCodes.join("\n"));
              }}
            >
              Copy to Clipboard
            </button>
            <button
              className="orbit-btn-primary flex-1"
              onClick={clearPendingRecoveryCodes}
            >
              I've saved my codes
            </button>
          </div>
        </section>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════ */
  /*  AUTH SCREEN                                         */
  /* ════════════════════════════════════════════════════ */
  if (!user) {
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-gradient-to-br from-orbit-bg via-orbit-panelAlt to-orbit-panel text-orbit-text">
        <TitleBar />
        <div className="flex flex-1 items-start justify-center p-6 sm:items-center">
        <section className="orbit-card relative z-10 w-full max-w-5xl rounded-3xl p-8">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-2 rounded-full border border-orbit-accent/40 px-3 py-1 text-xs uppercase tracking-[0.18em] text-orbit-accent">
                <img src="logo.png" alt="Orbit Chat logo" className="h-5 w-5 rounded-full object-cover" />
                Orbit Chat
              </span>
              <h1 className="text-4xl font-bold leading-tight md:text-5xl">
                Private desktop messaging for teams that move fast.
              </h1>
              <p className="max-w-xl text-sm text-slate-300">
                End-to-end encrypted architecture, ephemeral media controls, and a realtime shell built for low-friction conversation.
              </p>
              <div className="grid gap-3 text-xs text-slate-300 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">AES-style payload wrapping</div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">Secure local cache hooks</div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">Realtime socket transport</div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-orbit-panel p-6">
              <div className="mb-6 flex rounded-xl border border-white/10 bg-orbit-panelAlt p-1">
                <button
                  className={`w-1/3 rounded-lg px-2 py-2 text-sm font-semibold transition ${
                    authMode === "login" ? "bg-orbit-accent text-slate-950" : "text-slate-300"
                  }`}
                  onClick={() => {
                    setAuthMode("login");
                    setAuthValidationError(null);
                  }}
                >
                  Login
                </button>
                <button
                  className={`w-1/3 rounded-lg px-2 py-2 text-sm font-semibold transition ${
                    authMode === "signup" ? "bg-orbit-accent text-slate-950" : "text-slate-300"
                  }`}
                  onClick={() => {
                    setAuthMode("signup");
                    setAuthValidationError(null);
                  }}
                >
                  Sign Up
                </button>
                <button
                  className={`w-1/3 rounded-lg px-2 py-2 text-sm font-semibold transition ${
                    authMode === "recovery" ? "bg-orbit-accent text-slate-950" : "text-slate-300"
                  }`}
                  onClick={() => {
                    setAuthMode("recovery");
                    setAuthValidationError(null);
                  }}
                >
                  Recovery
                </button>
              </div>

              {error && (
                <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
                  {error}
                </div>
              )}

              {authValidationError && (
                <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                  {authValidationError}
                </div>
              )}

              <form className="space-y-4" onSubmit={handleAuthSubmit}>
                <label className="block">
                  <span className="orbit-label">Username</span>
                  <input
                    className="orbit-input"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      if (authValidationError) setAuthValidationError(null);
                    }}
                    placeholder="your-name"
                    autoComplete="username"
                  />
                </label>
                {authMode === "recovery" ? (
                  <>
                    <label className="block">
                      <span className="orbit-label">Recovery Code</span>
                      <input
                        className="orbit-input font-mono tracking-wider"
                        value={recoveryCode}
                        onChange={(event) => {
                          setRecoveryCode(event.target.value);
                          if (authValidationError) setAuthValidationError(null);
                        }}
                        placeholder="xxxx-xxxx"
                        autoComplete="off"
                      />
                    </label>
                    <p className="text-xs text-orbit-muted">
                      Enter one of your recovery codes to log in without a password. Each code can only be used once.
                    </p>
                  </>
                ) : (
                  <>
                    <label className="block">
                      <span className="orbit-label">Password</span>
                      <input
                        className="orbit-input"
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          if (authValidationError) setAuthValidationError(null);
                        }}
                        placeholder="********"
                        type="password"
                        autoComplete={authMode === "login" ? "current-password" : "new-password"}
                      />
                    </label>
                    {authMode === "signup" && (
                      <>
                        <label className="block">
                          <span className="orbit-label">Confirm Password</span>
                          <input
                            className="orbit-input"
                            value={confirmPassword}
                            onChange={(event) => {
                              setConfirmPassword(event.target.value);
                              if (authValidationError) setAuthValidationError(null);
                            }}
                            placeholder="********"
                            type="password"
                            autoComplete="new-password"
                          />
                        </label>
                        <p className="text-xs text-orbit-muted">
                          Password must be at least 8 characters and include a number and special character.
                        </p>
                      </>
                    )}
                  </>
                )}
                <button
                  disabled={loading}
                  className="orbit-btn-primary w-full"
                >
                  {loading
                    ? "Please wait..."
                    : authMode === "login"
                      ? "Login"
                      : authMode === "signup"
                        ? "Create Account"
                        : "Login with Recovery Code"}
                </button>
              </form>
            </div>
          </div>
        </section>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════ */
  /*  MAIN CHAT SCREEN                                    */
  /* ════════════════════════════════════════════════════ */
  return (
    <div className="orbit-shell">
      <TitleBar />
      <div className="grid h-full grid-cols-[68px_300px_1fr]">
        {/* ───── Left icon rail ───── */}
        <aside className="flex h-full flex-col overflow-hidden border-r border-white/10 bg-[#141822] p-2">
          <div className="mb-4 flex items-center justify-center rounded-2xl bg-gradient-to-br from-orbit-accent/25 to-cyan-300/5 p-2.5 shadow-[0_10px_25px_rgba(18,201,180,0.15)]">
            <img src="logo.png" alt="Orbit Chat logo" className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/20" />
          </div>
          <div className="space-y-2">
            {[
              {
                key: "home" as const,
                label: "Home",
                icon: (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 10.5L12 3l9 7.5" />
                    <path d="M5.5 9.5V20h13V9.5" />
                  </svg>
                ),
              },
              {
                key: "dm" as const,
                label: "DM",
                icon: (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                ),
              },
              {
                key: "groups" as const,
                label: "Groups",
                icon: (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="8" cy="8" r="3" />
                    <circle cx="16" cy="9" r="2.5" />
                    <path d="M3 19a5 5 0 0 1 10 0" />
                    <path d="M13 19a4 4 0 0 1 8 0" />
                  </svg>
                ),
              },
              {
                key: "friends" as const,
                label: "Friends",
                icon: (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <path d="M20 8v6" />
                    <path d="M23 11h-6" />
                  </svg>
                ),
              },
              {
                key: "archive" as const,
                label: "Archive",
                icon: (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="4" rx="1.2" />
                    <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
                    <path d="M10 12h4" />
                  </svg>
                ),
              },
            ].map((item) => {
              const active = navTab === item.key;
              return (
                <button
                  key={item.key}
                  className={`group orbit-rail-btn ${active ? "orbit-rail-btn-active" : ""}`}
                  onClick={() => {
                    setNavTab(item.key);
                    if (item.key === "friends" || item.key === "archive") {
                      setSelectedConvId(null);
                    }
                    setShowChatSettings(false);
                    setPasscodeInput("");
                    setPasscodeError(null);
                    setShowBypassInput(false);
                  }}
                  aria-pressed={active}
                >
                  <span className="relative mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-slate-200 group-hover:text-orbit-text">
                    {item.icon}
                    {item.key === "friends" && hasUnreadDm && (
                      <span
                        className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-orbit-panelAlt bg-orbit-accent"
                        aria-label="Unread direct messages"
                        title="Unread direct messages"
                      />
                    )}
                  </span>
                  <span className="block leading-none">{item.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ───── Sidebar: search + conversation list ───── */}
        <aside className="flex h-full flex-col overflow-hidden border-r border-white/10 bg-[#1a1e29] p-3">
          {navTab === "home" && (
            <>
              <h1 className="text-lg font-semibold tracking-tight">Home</h1>
              <p className="mt-1 text-[13px] text-orbit-muted">Your recent conversations across DMs and groups</p>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent chats</p>
                <span className="text-xs text-orbit-muted">{sortedConversations.length}</span>
              </div>

              {renderConversationList(sortedConversations, "No recent chats yet.")}
            </>
          )}

          {navTab === "dm" && (
            <>
              <h1 className="text-lg font-semibold tracking-tight">Direct Messages</h1>
              <p className="mt-1 text-[13px] text-orbit-muted">Search users and start secure chats</p>

              <label className="mt-4 block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Search users</span>
                <input
                  className="orbit-input py-2"
                  placeholder="Search username..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

              {searchResults.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-orbit-muted">Search results</p>
                  {searchResults.map((u) => {
                    const relation = friendStatusByUserId.get(u.id);
                    const incomingRequest = friendRequests.incoming.find((request) => request.user.id === u.id);
                    const outgoingRequest = friendRequests.outgoing.find((request) => request.user.id === u.id);
                    const avatarUrl = u.avatarUrl ?? profileById[u.id]?.avatarUrl ?? null;

                    return (
                      <div key={u.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-orbit-panelAlt p-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panel text-[11px] font-semibold text-orbit-text">
                          {avatarUrl ? (
                            <img src={avatarUrl} alt={`@${u.username}`} className="h-full w-full object-cover" />
                          ) : (
                            (u.username[0] ?? "U").toUpperCase()
                          )}
                        </div>
                        <button
                          className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-orbit-text hover:underline"
                          onClick={(event) => openProfilePopover(u.id, event.currentTarget)}
                        >
                          @{u.username}
                        </button>
                        {u.id === user.id ? (
                          <span className="rounded-lg border border-white/10 px-2 py-1 text-xs text-orbit-muted">You</span>
                        ) : relation === "friend" ? (
                          <button
                            className="orbit-btn px-3 py-2 text-xs"
                            onClick={() => startDM(u)}
                          >
                            Message
                          </button>
                        ) : relation === "incoming" && incomingRequest ? (
                          <button
                            className="orbit-btn-primary px-3 py-2 text-xs"
                            disabled={friendActionLoading[`accept:${incomingRequest.id}`]}
                            onClick={() => void acceptIncomingRequest(incomingRequest.id)}
                          >
                            {friendActionLoading[`accept:${incomingRequest.id}`] ? "Accepting..." : "Accept"}
                          </button>
                        ) : relation === "outgoing" && outgoingRequest ? (
                          <button
                            className="orbit-btn px-3 py-2 text-xs"
                            disabled={friendActionLoading[`cancel:${outgoingRequest.id}`]}
                            onClick={() => void cancelOutgoingRequest(outgoingRequest.id)}
                          >
                            {friendActionLoading[`cancel:${outgoingRequest.id}`] ? "Cancelling..." : "Pending"}
                          </button>
                        ) : (
                          <button
                            className="orbit-btn-primary px-3 py-2 text-xs"
                            disabled={friendActionLoading[`send:${u.id}`]}
                            onClick={() => void sendFriendRequest(u.id)}
                          >
                            {friendActionLoading[`send:${u.id}`] ? "Sending..." : "Add Friend"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Direct messages</p>
                <span className="text-xs text-orbit-muted">{directConversations.length}</span>
              </div>

              {renderConversationList(directConversations, "No direct messages yet. Search for a user above to start one.")}
            </>
          )}

          {navTab === "groups" && (
            <>
              <h1 className="text-lg font-semibold tracking-tight">Group Chats</h1>
              <p className="mt-1 text-[13px] text-orbit-muted">Create and manage your group conversations</p>

              <button
                className="orbit-btn-primary mt-4 w-full px-3 py-2 text-xs font-semibold"
                onClick={() => setGroupCreationModal((prev) => ({ ...prev, open: true }))}
              >
                Create Group Chat
              </button>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Groups</p>
                <span className="text-xs text-orbit-muted">{groupConversations.length}</span>
              </div>

              {renderConversationList(groupConversations, "No group chats yet. Create one to get started.")}
            </>
          )}

          {navTab === "friends" && (
            <>
              <h1 className="text-lg font-semibold">Friends</h1>
              <p className="mt-1 text-[13px] text-orbit-muted">Manage your network and jump into DMs fast</p>

              <label className="mt-4 block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Add friend by username</span>
                <input
                  className="orbit-input py-2"
                  placeholder="Find people..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

              {friendError && (
                <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {friendError}
                </div>
              )}

              {searchResults.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Directory</p>
                  {searchResults.slice(0, 6).map((u) => {
                    const relation = friendStatusByUserId.get(u.id);
                    const incomingRequest = friendRequests.incoming.find((request) => request.user.id === u.id);
                    const outgoingRequest = friendRequests.outgoing.find((request) => request.user.id === u.id);
                    const avatarUrl = u.avatarUrl ?? profileById[u.id]?.avatarUrl ?? null;
                    return (
                      <div key={u.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-orbit-panelAlt p-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panel text-[11px] font-semibold text-orbit-text">
                          {avatarUrl ? (
                            <img src={avatarUrl} alt={`@${u.username}`} className="h-full w-full object-cover" />
                          ) : (
                            (u.username[0] ?? "U").toUpperCase()
                          )}
                        </div>
                        <button
                          className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-orbit-text hover:underline"
                          onClick={(event) => openProfilePopover(u.id, event.currentTarget)}
                        >
                          @{u.username}
                        </button>
                        {u.id === user.id ? (
                          <span className="rounded-lg border border-white/10 px-2 py-1 text-xs text-orbit-muted">You</span>
                        ) : relation === "friend" ? (
                          <button className="orbit-btn px-3 py-2 text-xs" onClick={() => startDM(u)}>Message</button>
                        ) : relation === "incoming" && incomingRequest ? (
                          <button
                            className="orbit-btn-primary px-3 py-2 text-xs"
                            disabled={friendActionLoading[`accept:${incomingRequest.id}`]}
                            onClick={() => void acceptIncomingRequest(incomingRequest.id)}
                          >
                            Accept
                          </button>
                        ) : relation === "outgoing" && outgoingRequest ? (
                          <button
                            className="orbit-btn px-3 py-2 text-xs"
                            disabled={friendActionLoading[`cancel:${outgoingRequest.id}`]}
                            onClick={() => void cancelOutgoingRequest(outgoingRequest.id)}
                          >
                            Pending
                          </button>
                        ) : (
                          <button
                            className="orbit-btn-primary px-3 py-2 text-xs"
                            disabled={friendActionLoading[`send:${u.id}`]}
                            onClick={() => void sendFriendRequest(u.id)}
                          >
                            Add
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Incoming Requests</p>
                <span className="text-xs text-orbit-muted">{friendRequests.incoming.length}</span>
              </div>
              <div className="mt-2 space-y-2">
                {friendRequests.incoming.slice(0, 4).map((request) => (
                  <div key={request.id} className="rounded-xl border border-white/10 bg-orbit-panelAlt p-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panel text-[11px] font-semibold text-orbit-text">
                        {(request.user.avatarUrl ?? profileById[request.user.id]?.avatarUrl) ? (
                          <img src={(request.user.avatarUrl ?? profileById[request.user.id]?.avatarUrl) ?? ""} alt={`@${request.user.username}`} className="h-full w-full object-cover" />
                        ) : (
                          (request.user.username[0] ?? "U").toUpperCase()
                        )}
                      </div>
                      <button
                        className="text-sm font-semibold hover:underline"
                        onClick={(event) => openProfilePopover(request.user.id, event.currentTarget)}
                      >
                        @{request.user.username}
                      </button>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="orbit-btn-primary flex-1 px-3 py-2 text-xs"
                        disabled={friendActionLoading[`accept:${request.id}`]}
                        onClick={() => void acceptIncomingRequest(request.id)}
                      >
                        Accept
                      </button>
                      <button
                        className="orbit-btn flex-1 px-3 py-2 text-xs"
                        disabled={friendActionLoading[`decline:${request.id}`]}
                        onClick={() => void declineIncomingRequest(request.id)}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
                {friendRequests.incoming.length === 0 && (
                  <p className="text-xs text-orbit-muted">No incoming requests.</p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Outgoing Requests</p>
                <span className="text-xs text-orbit-muted">{friendRequests.outgoing.length}</span>
              </div>
              <div className="mt-2 space-y-2">
                {friendRequests.outgoing.slice(0, 3).map((request) => (
                  <div key={request.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-orbit-panelAlt p-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panel text-[11px] font-semibold text-orbit-text">
                      {(request.user.avatarUrl ?? profileById[request.user.id]?.avatarUrl) ? (
                        <img src={(request.user.avatarUrl ?? profileById[request.user.id]?.avatarUrl) ?? ""} alt={`@${request.user.username}`} className="h-full w-full object-cover" />
                      ) : (
                        (request.user.username[0] ?? "U").toUpperCase()
                      )}
                    </div>
                    <button
                      className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-orbit-text hover:underline"
                      onClick={(event) => openProfilePopover(request.user.id, event.currentTarget)}
                    >
                      @{request.user.username}
                    </button>
                    <button
                      className="orbit-btn px-3 py-2 text-xs"
                      disabled={friendActionLoading[`cancel:${request.id}`]}
                      onClick={() => void cancelOutgoingRequest(request.id)}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
                {friendRequests.outgoing.length === 0 && (
                  <p className="text-xs text-orbit-muted">No outgoing requests.</p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">All Friends</p>
                <span className="text-xs text-orbit-muted">{friends.length}</span>
              </div>
              <div className="mt-2 flex-1 space-y-2 overflow-y-auto pr-1">
                {friends.map((friend) => (
                  <div key={friend.id} className="rounded-xl border border-white/10 bg-orbit-panelAlt p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panel text-[11px] font-semibold text-orbit-text">
                          {(friend.user.avatarUrl ?? profileById[friend.user.id]?.avatarUrl) ? (
                            <img src={(friend.user.avatarUrl ?? profileById[friend.user.id]?.avatarUrl) ?? ""} alt={`@${friend.user.username}`} className="h-full w-full object-cover" />
                          ) : (
                            (friend.user.username[0] ?? "U").toUpperCase()
                          )}
                        </div>
                        <button
                          className="min-w-0 flex-1 text-left"
                          onClick={(event) => openProfilePopover(friend.user.id, event.currentTarget)}
                        >
                          <p className="truncate text-sm font-semibold">@{friend.user.username}</p>
                          <p className="truncate text-xs text-orbit-muted">
                            {friend.user.statusEmoji ? `${friend.user.statusEmoji} ` : ""}
                            {presenceLabel(friend.user.presence)}
                            {friend.user.statusText ? ` • ${friend.user.statusText}` : ""}
                          </p>
                        </button>
                      </div>
                      <span className={`h-2.5 w-2.5 rounded-full ${presenceDotClass(friend.user.presence)}`} />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="orbit-btn flex-1 px-3 py-2 text-xs"
                        onClick={() => {
                          setNavTab("dm");
                          void startDM({ id: friend.user.id, username: friend.user.username });
                        }}
                      >
                        Message
                      </button>
                      <button
                        className="orbit-btn flex-1 px-3 py-2 text-xs"
                        disabled={friendActionLoading[`remove:${friend.user.id}`]}
                        onClick={() => void removeFriend(friend.user.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {friends.length === 0 && (
                  <p className="text-xs text-orbit-muted">No friends yet. Send a request from the directory above.</p>
                )}
              </div>
            </>
          )}

          {navTab === "archive" && (
            <>
              <h1 className="text-lg font-semibold">Archive</h1>
              <p className="mt-1 text-[13px] text-orbit-muted">Archived chats are hidden from DMs but still active</p>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Archived</p>
                <span className="text-xs text-orbit-muted">{archivedConversations.length}</span>
              </div>

              <div className="mt-2 space-y-2">
                {archivedConversations.map((conv) => {
                  const otherMember = conv.members.find((m) => m.user.id !== user.id);
                  const otherUserId = otherMember?.user.id ?? "";
                  const otherUsername = otherMember?.user.username ?? "dm";
                  const avatarUrl = profileById[otherUserId]?.avatarUrl ?? null;
                  const displayName =
                    conv.type === "dm"
                      ? (conv.name?.trim() ? conv.name.trim() : `${otherUsername}#${shortConversationId(conv.id)}`)
                      : conv.name ?? "Group";

                  return (
                    <div key={conv.id} className="flex items-center gap-2 rounded-xl border border-white/5 bg-[#202533] p-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panelAlt text-[11px] font-semibold text-orbit-text">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt={`@${otherUsername}`} className="h-full w-full object-cover" />
                        ) : (
                          (otherUsername[0] ?? "D").toUpperCase()
                        )}
                      </div>
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">@{displayName}</p>
                      <button
                        className="orbit-btn px-2 py-1 text-[11px]"
                        onClick={() => {
                          unarchiveConversation(conv.id);
                          setNavTab("dm");
                          setSelectedConvId(conv.id);
                        }}
                      >
                        Unarchive
                      </button>
                      <button
                        className="orbit-btn px-2 py-1 text-[11px] text-rose-400 hover:bg-rose-500/15"
                        onClick={() => openDeleteModal(conv)}
                      >
                        Delete
                      </button>
                    </div>
                  );
                })}
                {archivedConversations.length === 0 && (
                  <p className="text-xs text-orbit-muted">No archived chats.</p>
                )}
              </div>
            </>
          )}

        </aside>

        {/* ───── Main content area ───── */}
        <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-[#171b25] to-[#141822]">
          <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#1b2030]/85 px-3 py-2 backdrop-blur">
            <div className="flex items-center gap-3">
              <img src="logo.png" alt="Orbit Chat logo" className="h-7 w-7 rounded-lg ring-1 ring-white/20" />
              <div>
                <p className="text-sm font-semibold text-orbit-text">Orbit Chat</p>
                <p className="text-[11px] text-orbit-muted">Private by default</p>
              </div>
              <div className="ml-2 hidden items-center gap-2 md:flex">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-orbit-muted">Build {appVersion}</span>
                <span className={`max-w-[340px] truncate rounded-full border px-2 py-1 text-[11px] ${realtimeBadge.className}`} title={realtimeBadge.label}>
                  {realtimeBadge.label}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-orbit-text hover:border-white/20"
              onClick={(event) => openMyProfilePopover(event.currentTarget)}
            >
              @{user.username}
            </button>
            <button
              className="orbit-btn h-10 w-10 p-0"
              onClick={() => {
                setMainView("profile-settings");
                setSelectedConvId(null);
                closeProfilePopover();
              }}
              aria-label="Open profile settings"
              title="Profile settings"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3.5" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .38.13.74.36 1.03.23.29.56.49.92.56H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1 .33 1.65 1.65 0 0 0-.6 1z" />
              </svg>
            </button>
            <button
              className="orbit-btn-danger px-4 py-2 text-xs"
              onClick={() => {
                chatLock.onLogout();
                clearSession();
                setSelectedConvId(null);
                setSearch("");
                setConversations([]);
                setFriends([]);
                setFriendRequests({ incoming: [], outgoing: [] });
                setFriendError(null);
                setMainView("chat");
                closeProfilePopover();
              }}
            >
              Sign Out
            </button>
            </div>
          </header>

          <section className={`min-h-0 flex-1 ${mainView === "profile-settings" ? "overflow-y-auto" : "overflow-hidden"}`}>
            {mainView === "profile-settings" && token && user ? (
              <ProfileSettings
                token={token}
                myUserId={user.id}
                onClose={() => {
                  setMainView("chat");
                }}
              />
            ) : navTab === "friends" ? (
              <div className="flex h-full items-center justify-center p-8">
                <div className="orbit-card max-w-2xl rounded-3xl p-8 text-center">
                  <h2 className="text-3xl font-bold">Friends Hub</h2>
                  <p className="mt-3 text-sm text-slate-300">
                    Accept requests, remove connections, and jump into private chats from the Friends panel.
                  </p>
                  <div className="mt-6 grid gap-3 text-left text-sm text-slate-300 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="font-semibold">Accepted</p>
                      <p className="mt-1 text-xs text-orbit-muted">{friends.length} friends</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="font-semibold">Incoming</p>
                      <p className="mt-1 text-xs text-orbit-muted">{friendRequests.incoming.length} requests</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="font-semibold">Outgoing</p>
                      <p className="mt-1 text-xs text-orbit-muted">{friendRequests.outgoing.length} pending</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : navTab === "archive" ? (
              <div className="flex h-full items-center justify-center p-8">
                <div className="orbit-card max-w-xl rounded-3xl p-8 text-center">
                  <h2 className="text-3xl font-bold">Archive</h2>
                  <p className="mt-3 text-sm text-slate-300">
                    {archivedConversations.length
                      ? `${archivedConversations.length} archived chat${archivedConversations.length > 1 ? "s" : ""}. You can unarchive or delete them from the sidebar.`
                      : "No archived chats. Right-click a conversation to archive it."}
                  </p>
                </div>
              </div>
            ) : !selectedConversation ? (
              <div className="flex h-full items-center justify-center p-8">
                <div className="orbit-card max-w-xl rounded-3xl p-8 text-center">
                  <h2 className="text-3xl font-bold">Welcome back, {user.username}</h2>
                  <p className="mt-3 text-sm text-slate-300">
                    Pick someone from the sidebar to start a private conversation. Message history and encrypted payload previews will appear here.
                  </p>
                  <div className="mt-6 grid gap-3 text-left text-sm text-slate-300 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">Search users by username</div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">View online presence</div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">Open secure DM threads</div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">Send encrypted payloads</div>
                  </div>
                </div>
              </div>
            ) : selectedConversation.passcodeEnabled && !chatLock.isUnlocked(selectedConversation.id) ? (
              /* ════ LOCKED CHAT – passcode entry ════ */
              <div className="flex h-full items-center justify-center p-8">
                <div className="orbit-card w-full max-w-sm rounded-3xl p-8 text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-orbit-panelAlt">
                    <svg viewBox="0 0 24 24" className="h-7 w-7 text-orbit-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold">Chat Locked</h2>
                  <p className="mt-2 text-sm text-orbit-muted">
                    Enter the {selectedConversation.passcodeLength}-digit passcode to unlock this chat.
                  </p>
                  <p className="mt-1 text-xs text-orbit-muted">Chat: @{selectedConversationLabel}</p>

                  {passcodeError && (
                    <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
                      {passcodeError}
                    </div>
                  )}

                  {!showBypassInput ? (
                    <>
                      <input
                        className="orbit-input mt-4 text-center font-mono text-2xl tracking-[0.3em]"
                        value={passcodeInput}
                        onChange={(e) => {
                          setPasscodeInput(e.target.value.replace(/\D/g, "").slice(0, 6));
                          setPasscodeError(null);
                        }}
                        placeholder={"•".repeat(selectedConversation.passcodeLength)}
                        maxLength={6}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (!token || !passcodeInput) return;
                            api.verifyPasscode(selectedConversation.id, passcodeInput, token)
                              .then(() => {
                                chatLock.unlock(selectedConversation.id, selectedConversation.lockMode, selectedConversation.lockTimeoutSeconds);
                                setPasscodeInput("");
                                setPasscodeError(null);
                              })
                              .catch((err: any) => setPasscodeError(err?.message ?? "Invalid passcode"));
                          }
                        }}
                      />
                      <button
                        className="orbit-btn-primary mt-4 w-full"
                        onClick={() => {
                          if (!token || !passcodeInput) return;
                          api.verifyPasscode(selectedConversation.id, passcodeInput, token)
                            .then(() => {
                              chatLock.unlock(selectedConversation.id, selectedConversation.lockMode, selectedConversation.lockTimeoutSeconds);
                              setPasscodeInput("");
                              setPasscodeError(null);
                            })
                            .catch((err: any) => setPasscodeError(err?.message ?? "Invalid passcode"));
                        }}
                      >
                        Unlock
                      </button>
                      <button
                        className="mt-3 text-xs text-orbit-muted hover:text-orbit-text"
                        onClick={() => {
                          setShowBypassInput(true);
                          setPasscodeError(null);
                        }}
                      >
                        Forgot passcode? Use a recovery code
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="mt-4 text-left text-xs text-orbit-muted">
                        Enter an account recovery code to bypass this chat's passcode.
                        <span className="block font-semibold text-amber-300">This will disable the passcode on this chat and consume the recovery code.</span>
                      </p>
                      <input
                        className="orbit-input mt-3 font-mono tracking-wider"
                        value={bypassRecoveryCode}
                        onChange={(e) => {
                          setBypassRecoveryCode(e.target.value);
                          setPasscodeError(null);
                        }}
                        placeholder="xxxx-xxxx"
                        autoFocus
                      />
                      <div className="mt-4 flex gap-3">
                        <button
                          className="orbit-btn flex-1"
                          onClick={() => {
                            setShowBypassInput(false);
                            setBypassRecoveryCode("");
                            setPasscodeError(null);
                          }}
                        >
                          Back
                        </button>
                        <button
                          className="orbit-btn-primary flex-1"
                          onClick={() => {
                            if (!token || !bypassRecoveryCode.trim()) return;
                            api.bypassPasscode(selectedConversation.id, bypassRecoveryCode.trim(), token)
                              .then(() => {
                                chatLock.unlock(selectedConversation.id, selectedConversation.lockMode, selectedConversation.lockTimeoutSeconds);
                                setBypassRecoveryCode("");
                                setShowBypassInput(false);
                                setPasscodeError(null);
                                // Refresh conversations to get updated passcodeEnabled state
                                void loadConversations();
                              })
                              .catch((err: any) => setPasscodeError(err?.message ?? "Bypass failed"));
                          }}
                        >
                          Bypass
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
            <header className="flex items-center justify-between border-b border-white/10 bg-[#1b2030]/85 px-4 py-2.5 backdrop-blur">
              <div>
                <button
                  className="text-left text-base font-semibold text-orbit-text hover:underline"
                  onClick={(e) => {
                    if (!dmPartner?.id) return;
                    openProfilePopover(dmPartner.id, e.currentTarget);
                  }}
                >
                  @{dmPartnerName}
                </button>
                <p className={`text-xs ${typingDisplayNames.length ? "text-orbit-accent" : "text-orbit-muted"}`}>
                  {typingDisplayNames.length
                    ? `${typingDisplayNames.length === 1 ? typingDisplayNames[0] : `${typingDisplayNames.length} people`} typing...`
                    : "Direct encrypted chat"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative w-[280px] max-w-[36vw]">
                  <input
                    className="orbit-input h-9 pr-8 text-xs"
                    value={messageSearch}
                    onChange={(event) => setMessageSearch(event.target.value)}
                    placeholder="Search this chat"
                  />
                  {messageSearch && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-orbit-muted hover:text-orbit-text"
                      onClick={() => setMessageSearch("")}
                      aria-label="Clear chat search"
                      title="Clear chat search"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {getConversationSecretKey(selectedConversation.id) ? (
                  <span className="rounded-full border border-orbit-accent/40 px-3 py-1 text-xs text-orbit-accent">E2E Encrypted</span>
                ) : loadingByConversationId[selectedConversation.id] ? (
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-orbit-muted">Setting up encryption…</span>
                ) : (
                  <span className="rounded-full border border-orbit-danger/40 px-3 py-1 text-xs text-orbit-danger">Encryption unavailable</span>
                )}
                <button
                  className="orbit-btn h-9 w-9 p-0"
                  onClick={() => {
                    setShowChatSettings(!showChatSettings);
                    if (!showChatSettings) {
                      const realtimePref = chatRealtimePreferences[selectedConversation.id] ?? DEFAULT_CHAT_PREFERENCES;
                      setChatSettingsName(selectedConversation.name ?? "");
                      setChatSettingsLength(selectedConversation.passcodeLength);
                      setChatSettingsLockMode(selectedConversation.lockMode);
                      setChatSettingsTimeout(selectedConversation.lockTimeoutSeconds?.toString() ?? "");
                      setChatSettingsReadReceipts(realtimePref.readReceipts);
                      setChatSettingsTypingIndicators(realtimePref.typingIndicators);
                      setChatSettingsPasscode("");
                      setChatSettingsError(null);
                    }
                  }}
                  aria-label="Chat settings"
                  title="Chat settings"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="3.5" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .38.13.74.36 1.03.23.29.56.49.92.56H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1 .33 1.65 1.65 0 0 0-.6 1z" />
                  </svg>
                </button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1">
              <section className={`space-y-2 overflow-y-auto px-3 py-2 ${threadRootMessage ? "w-[65%] border-r border-white/10" : "w-full"}`}>
                {visibleMessages.length === 0 && (
                  <p className="text-sm text-orbit-muted">
                    {activeMessageSearchQuery ? "No messages match this search." : "No messages yet. Send your first encrypted payload."}
                  </p>
                )}
                {visibleMessages.map((msg) => {
                  const mine = msg.sender === user.username;
                  const senderProfile = profileById[msg.senderId] ?? null;
                  const senderLabel = senderProfile?.displayName?.trim() || msg.sender;
                  const senderAvatar = senderProfile?.avatarUrl ?? null;
                  const senderInitial = senderLabel.trim()?.[0]?.toUpperCase() ?? msg.sender[0]?.toUpperCase() ?? "?";
                  const parentMessage = msg.parentMessageId ? messageById.get(msg.parentMessageId) ?? null : null;
                  const threadReplyCount = messages.filter((candidate) => candidate.parentMessageId === msg.id).length;
                  const quickActionsVisible = hoveredMessageId === msg.id;

                  return (
                    <article
                      key={msg.id}
                      className={`group relative flex max-w-[82%] items-end gap-2 ${mine ? "ml-auto flex-row-reverse" : ""}`}
                      onMouseEnter={() => setHoveredMessageId(msg.id)}
                      onMouseLeave={() => setHoveredMessageId((prev) => (prev === msg.id ? null : prev))}
                      onContextMenu={(e) => ctxMenu.show(e, buildMessageContextMenuItems(msg, senderLabel))}
                    >
                      <button
                        className="mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/10 bg-orbit-panelAlt text-[11px] font-semibold text-orbit-text"
                        onClick={(e) => openProfilePopover(msg.senderId, e.currentTarget)}
                        aria-label={`Open profile for ${senderLabel}`}
                        title={senderLabel}
                      >
                        {senderAvatar ? (
                          <img src={senderAvatar} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center">{senderInitial}</span>
                        )}
                      </button>

                      <div
                        className={`min-w-0 rounded-xl border px-3 py-2 text-[13px] leading-snug shadow-sm ${
                          mine
                            ? "border-orbit-accent/20 bg-orbit-accent/15 shadow-[0_8px_20px_rgba(18,201,180,0.12)]"
                            : "border-white/10 bg-[#202533]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            className="max-w-[180px] truncate text-[11px] font-semibold text-orbit-accent hover:underline"
                            onClick={(e) => openProfilePopover(msg.senderId, e.currentTarget)}
                          >
                            {mine ? "You" : senderLabel}
                          </button>
                          <span className="text-[10px] uppercase tracking-wide text-orbit-muted">{formatMessageTimestamp(msg.createdAt)}</span>
                        </div>

                        {parentMessage && (
                          <button
                            className="mt-1 flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-left text-[11px] text-orbit-muted hover:border-white/20"
                            onClick={() => openThreadView(parentMessage.id)}
                          >
                            <span className="font-semibold text-orbit-accent">Replying to {parentMessage.sender}</span>
                            <span className="truncate">in thread</span>
                          </button>
                        )}

                        <div className="mt-1">
                          {typeof msg.keyVersion === "number" && msg.keyVersion < myMinReadableKeyVersion ? (
                            <p className="break-words text-orbit-muted">
                              Encrypted message unavailable (sent before you joined this key version).
                            </p>
                          ) : (
                            <DecryptedMessageBody
                              conversationId={selectedConversation.id}
                              token={token}
                              cipherText={msg.cipherText}
                              nonce={msg.nonce}
                              keyVersion={msg.keyVersion}
                            />
                          )}
                        </div>

                        {(msg.reactions ?? []).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(msg.reactions ?? []).map((reaction) => {
                              const active = reaction.userIds.includes(user.id);
                              return (
                                <button
                                  key={`${msg.id}:${reaction.emoji}`}
                                  className={`rounded-full border px-2 py-0.5 text-xs ${active ? "border-orbit-accent/60 bg-orbit-accent/20 text-orbit-accent" : "border-white/10 bg-black/20 text-slate-300"}`}
                                  onClick={() => handleToggleReaction(msg.id, reaction.emoji as "👍" | "❤️" | "😂")}
                                >
                                  {reaction.emoji} {reaction.count}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {threadReplyCount > 0 && (
                          <button
                            className="mt-2 text-[11px] text-orbit-muted hover:text-orbit-accent"
                            onClick={() => openThreadView(msg.id)}
                          >
                            {threadReplyCount} {threadReplyCount === 1 ? "reply" : "replies"} in thread
                          </button>
                        )}

                        {mine && (seenByMessageId[msg.id] ?? []).some((seenUserId) => seenUserId !== user.id) && (
                          <p className="mt-1 text-right text-[10px] uppercase tracking-wide text-orbit-muted">Seen</p>
                        )}
                      </div>

                      {quickActionsVisible && (
                        <div className={`absolute -top-3 flex items-center gap-1 rounded-full border border-white/10 bg-orbit-panelAlt px-1.5 py-1 shadow-lg ${mine ? "right-10" : "left-10"}`}>
                          {(["👍", "❤️", "😂"] as const).map((emoji) => (
                            <button
                              key={`${msg.id}:quick:${emoji}`}
                              className="rounded-full px-1.5 py-0.5 text-sm hover:bg-white/10"
                              onClick={() => handleToggleReaction(msg.id, emoji)}
                              title={`React ${emoji}`}
                            >
                              {emoji}
                            </button>
                          ))}
                          <button
                            className="rounded-full px-2 py-0.5 text-[11px] text-orbit-muted hover:bg-white/10 hover:text-orbit-text"
                            onClick={() => handleQuickReply(msg.id)}
                            title="Quick reply"
                          >
                            Reply
                          </button>
                          <button
                            className="rounded-full px-2 py-0.5 text-[11px] text-orbit-muted hover:bg-white/10 hover:text-orbit-text"
                            onClick={() => openThreadView(msg.id)}
                            title="Open thread"
                          >
                            Thread
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>

              {threadRootMessage && (
                <aside className="flex w-[35%] min-w-[280px] flex-col bg-[#171b27]/80">
                  <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Thread</p>
                      <p className="text-xs text-orbit-muted">{threadMessages.length - 1} replies</p>
                    </div>
                    <button
                      className="orbit-btn px-2 py-1 text-xs"
                      onClick={() => {
                        setThreadRootMessageId(null);
                        setReplyTargetMessageId(null);
                      }}
                    >
                      Close
                    </button>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
                    {threadMessages.map((threadMessage) => (
                      <div key={`thread:${threadMessage.id}`} className="rounded-lg border border-white/10 bg-orbit-panelAlt px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-orbit-accent">{threadMessage.sender}</span>
                          <span className="text-[10px] uppercase tracking-wide text-orbit-muted">{formatMessageTimestamp(threadMessage.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-xs">
                          <DecryptedMessageBody
                            conversationId={selectedConversation.id}
                            token={token}
                            cipherText={threadMessage.cipherText}
                            nonce={threadMessage.nonce}
                            keyVersion={threadMessage.keyVersion}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </aside>
              )}
            </div>

            <footer className="border-t border-white/10 bg-[#1b2030]/90 px-3 py-2 backdrop-blur">
              {(activeReplyParentMessageId || threadRootMessage) && (
                <div className="mb-2 flex items-center justify-between rounded-lg border border-white/10 bg-orbit-panelAlt px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-orbit-accent">
                      {threadRootMessage ? "Replying in thread" : "Quick reply"}
                    </p>
                    <p className="truncate text-[11px] text-orbit-muted">
                      {activeReplyParentMessageId ? `Linked to message ${activeReplyParentMessageId.slice(0, 8)}` : ""}
                    </p>
                  </div>
                  <button
                    className="orbit-btn px-2 py-1 text-xs"
                    onClick={() => {
                      if (threadRootMessage) {
                        setThreadRootMessageId(null);
                      }
                      setReplyTargetMessageId(null);
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}

              {(pendingFiles.length > 0 || pendingGifs.length > 0) && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {pendingFiles.map((file, idx) => (
                    <span key={`${file.name}:${file.size}:${idx}`} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-orbit-panelAlt px-2 py-0.5 text-[11px] text-orbit-text">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-orbit-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <circle cx="8.5" cy="9" r="1.5" />
                        <path d="M21 16l-5.5-5.5a1 1 0 0 0-1.4 0L7 17" />
                      </svg>
                      {file.name}
                      <button
                        className="text-orbit-muted hover:text-orbit-text"
                        onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        x
                      </button>
                    </span>
                  ))}
                  {pendingGifs.map((gif, idx) => (
                    <div
                      key={`${gif.url}:${idx}`}
                      className="group flex items-center gap-2 rounded-lg border border-white/10 bg-orbit-panelAlt p-1.5"
                    >
                      <img
                        src={gif.previewUrl || gif.url}
                        alt={gif.title || "Selected GIF"}
                        className="h-12 w-16 rounded-md border border-white/10 object-cover"
                        loading="lazy"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-orbit-accent">GIF preview</p>
                        <p className="truncate text-[10px] text-orbit-muted">{gif.title || "Selected from GIF picker"}</p>
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          className="orbit-btn px-2 py-1 text-[10px]"
                          onClick={() => toggleGifPicker()}
                          title="Choose another GIF"
                        >
                          Change
                        </button>
                        <button
                          className="orbit-btn px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-500/15"
                          onClick={() => setPendingGifs([])}
                          title="Remove selected GIF"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-2 flex gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => handleAttachFiles(event.target.files)}
                />
                <button className="orbit-btn h-8 px-2.5 text-xs" onClick={() => fileInputRef.current?.click()} title="Attach image">
                  <span className="inline-flex items-center gap-1">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <circle cx="8.5" cy="9" r="1.5" />
                      <path d="M21 16l-5.5-5.5a1 1 0 0 0-1.4 0L7 17" />
                    </svg>
                    Image
                  </span>
                </button>
                <button
                  ref={gifButtonRef}
                  className={`orbit-btn h-8 px-2.5 text-xs ${showGifPicker ? "border-orbit-accent/50 text-orbit-accent" : ""}`}
                  onClick={toggleGifPicker}
                  title="GIFs"
                >
                  <span className="inline-flex items-center gap-1">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="M8 10h-.5A1.5 1.5 0 0 0 6 11.5v1A1.5 1.5 0 0 0 7.5 14H9" />
                      <path d="M9 12H7.75" />
                      <path d="M11 10v4" />
                      <path d="M11 10h2" />
                      <path d="M11 12h1.5" />
                      <path d="M11 14h2" />
                      <path d="M17 14v-4h1.5A1.5 1.5 0 0 1 20 11.5v1A1.5 1.5 0 0 1 18.5 14H17z" />
                    </svg>
                    GIF
                  </span>
                </button>
                <button
                  ref={emojiButtonRef}
                  className={`orbit-btn h-8 px-2.5 text-xs ${showEmojiPicker ? "border-orbit-accent/50 text-orbit-accent" : ""}`}
                  onClick={toggleEmojiPicker}
                  title="Emoji"
                >
                  <span className="inline-flex items-center gap-1">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
                      <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
                      <path d="M8.5 14.5c.8 1 2.05 1.5 3.5 1.5s2.7-.5 3.5-1.5" />
                    </svg>
                    Emoji
                  </span>
                </button>
              </div>

              <p className="mb-2 text-[10px] text-orbit-muted">
                Shortcuts: Cmd/Ctrl+I attach image, Cmd/Ctrl+G GIF picker, Cmd/Ctrl+E emoji picker, Cmd/Ctrl+/ focus message.
              </p>

              {showGifPicker && (
                <div ref={gifPickerRef} className="mb-2 rounded-lg border border-white/10 bg-orbit-panelAlt p-2">
                  <div className="mb-2 flex gap-1.5">
                    <input
                      ref={gifSearchInputRef}
                      className="orbit-input h-8 flex-1 px-2.5 text-xs"
                      value={gifQuery}
                      onChange={(event) => setGifQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setShowGifPicker(false);
                          messageInputRef.current?.focus();
                          return;
                        }
                        if (!gifResults.length) return;
                        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                          event.preventDefault();
                          setGifActiveIndex((prev) => (prev + 1) % gifResults.length);
                        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                          event.preventDefault();
                          setGifActiveIndex((prev) => (prev - 1 + gifResults.length) % gifResults.length);
                        } else if (event.key === "Tab") {
                          event.preventDefault();
                          setGifActiveIndex((prev) => {
                            if (event.shiftKey) {
                              return (prev - 1 + gifResults.length) % gifResults.length;
                            }
                            return (prev + 1) % gifResults.length;
                          });
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          const candidate = gifResults[gifActiveIndex];
                          if (candidate) {
                            handleAddGif(candidate);
                          }
                        }
                      }}
                      placeholder="Search GIFs"
                    />
                    <button className="orbit-btn h-8 px-2.5 text-xs" onClick={() => setShowGifPicker(false)}>
                      Close
                    </button>
                  </div>
                  {gifError && <p className="mb-2 text-xs text-rose-300">{gifError}</p>}
                  {gifLoading ? (
                    <p className="text-xs text-orbit-muted">Loading GIFs...</p>
                  ) : (
                    <div className="grid max-h-36 grid-cols-4 gap-1.5 overflow-y-auto pr-1">
                      {gifResults.map((gif) => (
                        <button
                          key={gif.id}
                          className={`overflow-hidden rounded-lg border hover:border-orbit-accent/40 ${gifResults[gifActiveIndex]?.id === gif.id ? "border-orbit-accent/70 ring-1 ring-orbit-accent/40" : "border-white/10"}`}
                          onClick={() => handleAddGif(gif)}
                          onFocus={() => {
                            const index = gifResults.findIndex((item) => item.id === gif.id);
                            if (index >= 0) setGifActiveIndex(index);
                          }}
                          title={gif.title || "GIF"}
                        >
                          <img src={gif.previewUrl} alt={gif.title || "GIF"} className="h-16 w-full object-cover" loading="lazy" />
                        </button>
                      ))}
                      {!gifResults.length && (
                        <p className="col-span-3 text-xs text-orbit-muted">No GIFs found for that search.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {showEmojiPicker && (
                <div ref={emojiPickerRef} className="mb-2 rounded-lg border border-white/10 bg-orbit-panelAlt p-2">
                  <div className="mb-2 flex gap-1.5">
                    <input
                      ref={emojiSearchInputRef}
                      className="orbit-input h-8 flex-1 px-2.5 text-xs"
                      value={emojiQuery}
                      onChange={(event) => setEmojiQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setShowEmojiPicker(false);
                          messageInputRef.current?.focus();
                          return;
                        }
                        if (!filteredEmojis.length) return;
                        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                          event.preventDefault();
                          setEmojiActiveIndex((prev) => (prev + 1) % filteredEmojis.length);
                        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                          event.preventDefault();
                          setEmojiActiveIndex((prev) => (prev - 1 + filteredEmojis.length) % filteredEmojis.length);
                        } else if (event.key === "Tab") {
                          event.preventDefault();
                          setEmojiActiveIndex((prev) => {
                            if (event.shiftKey) {
                              return (prev - 1 + filteredEmojis.length) % filteredEmojis.length;
                            }
                            return (prev + 1) % filteredEmojis.length;
                          });
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          const candidate = filteredEmojis[emojiActiveIndex];
                          if (candidate) {
                            handleInsertEmoji(candidate.value);
                          }
                        }
                      }}
                      placeholder="Search emoji"
                    />
                    <button className="orbit-btn h-8 px-2.5 text-xs" onClick={() => setShowEmojiPicker(false)}>
                      Close
                    </button>
                  </div>
                  {recentEmojis.length > 0 && !emojiQuery.trim() && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {recentEmojis.slice(0, 10).map((emoji) => (
                        <button
                          key={`recent:${emoji}`}
                          className="rounded-md border border-white/10 px-2 py-1 text-lg hover:border-orbit-accent/40"
                          onClick={() => handleInsertEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid max-h-36 grid-cols-10 gap-1 overflow-y-auto pr-1">
                    {filteredEmojis.map((item) => (
                      <button
                        key={item.value}
                        className={`rounded-md border px-2 py-1 text-lg hover:border-orbit-accent/40 ${filteredEmojis[emojiActiveIndex]?.value === item.value ? "border-orbit-accent/70 ring-1 ring-orbit-accent/40" : "border-white/10"}`}
                        onClick={() => handleInsertEmoji(item.value)}
                        onFocus={() => {
                          const index = filteredEmojis.findIndex((entry) => entry.value === item.value);
                          if (index >= 0) setEmojiActiveIndex(index);
                        }}
                        title={item.tags.join(", ")}
                      >
                        {item.value}
                      </button>
                    ))}
                    {!filteredEmojis.length && (
                      <p className="col-span-8 text-xs text-orbit-muted">No emoji matched that search.</p>
                    )}
                  </div>
                </div>
              )}

              {messageSendError && (
                <p className="mb-2 text-xs text-rose-300">{messageSendError}</p>
              )}

              <div className="flex gap-1.5">
                <input
                  ref={messageInputRef}
                  className="orbit-input h-9 flex-1 px-3 text-sm"
                  value={messageDraft}
                  onChange={(event) => onMessageDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                  placeholder="Type message..."
                />
                <button
                  className="orbit-btn-primary h-9 px-3 text-xs"
                  onClick={() => void handleSendMessage()}
                >
                  Send
                </button>
              </div>
            </footer>
              </div>
            )}
          </section>

          {showChatSettings && selectedConversation && (
            <div
              className="orbit-modal-overlay pointer-events-none"
            >
              <div
                className="orbit-modal pointer-events-auto"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Chat settings"
              >
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-orbit-text">Chat Settings</h3>
                    <p className="mt-1 text-xs text-orbit-muted">Customize this chat: display name, lock mode, and passcode.</p>
                  </div>
                  <button
                    className="orbit-btn px-2.5 py-1.5 text-xs"
                    onClick={() => setShowChatSettings(false)}
                    disabled={chatSettingsSaving}
                  >
                    Close
                  </button>
                </div>

                {chatSettingsError && (
                  <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {chatSettingsError}
                  </div>
                )}

                <div className="space-y-3">
                  <div className="rounded-xl border border-white/10 bg-orbit-panelAlt/70 p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Identity</p>
                    <label className="block">
                      <span className="orbit-label">Chat display name (optional)</span>
                      <input
                        className="orbit-input"
                        value={chatSettingsName}
                        onChange={(e) => setChatSettingsName(e.target.value)}
                        placeholder="Leave blank to use @username#chatId"
                        maxLength={64}
                      />
                      <span className="mt-1 block text-[11px] text-orbit-muted">Use a unique name for easier chat switching.</span>
                    </label>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-orbit-panelAlt/70 p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Lock and Passcode</p>
                    <label className="block">
                      <span className="orbit-label">New passcode (optional)</span>
                      <input
                        className="orbit-input font-mono tracking-[0.24em]"
                        value={chatSettingsPasscode}
                        onChange={(e) => setChatSettingsPasscode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder={"•".repeat(chatSettingsLength)}
                        maxLength={6}
                      />
                      <span className="mt-1 block text-[11px] text-orbit-muted">Leave blank to keep current passcode.</span>
                    </label>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="orbit-label">Passcode length</span>
                      <input
                        type="number"
                        className="orbit-input"
                        min={2}
                        max={6}
                        value={chatSettingsLength}
                        onChange={(e) => setChatSettingsLength(Math.min(6, Math.max(2, Number(e.target.value))))}
                      />
                    </label>

                    <label className="block">
                      <span className="orbit-label">Lock mode</span>
                      <select
                        className="orbit-select"
                        value={chatSettingsLockMode}
                        onChange={(e) => setChatSettingsLockMode(e.target.value as api.ChatLockMode)}
                      >
                        <option value="on_leave">On Leave</option>
                        <option value="on_logout">On Logout</option>
                        <option value="after_time">After Time</option>
                        <option value="after_inactivity">After Inactivity</option>
                      </select>
                    </label>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-orbit-panelAlt/70 p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Realtime</p>
                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-orbit-panel px-3 py-2">
                        <input
                          type="checkbox"
                          checked={chatSettingsReadReceipts}
                          onChange={(e) => setChatSettingsReadReceipts(e.target.checked)}
                          className="h-4 w-4 accent-orbit-accent"
                        />
                        <div>
                          <p className="text-sm text-slate-200">Send read receipts</p>
                          <p className="text-[11px] text-orbit-muted">When enabled, your client sends "seen" updates for this chat.</p>
                        </div>
                      </label>

                      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-orbit-panel px-3 py-2">
                        <input
                          type="checkbox"
                          checked={chatSettingsTypingIndicators}
                          onChange={(e) => setChatSettingsTypingIndicators(e.target.checked)}
                          className="h-4 w-4 accent-orbit-accent"
                        />
                        <div>
                          <p className="text-sm text-slate-200">Show typing indicators</p>
                          <p className="text-[11px] text-orbit-muted">When disabled, you won’t send or display typing activity for this chat.</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {(chatSettingsLockMode === "after_time" || chatSettingsLockMode === "after_inactivity") && (
                    <div className="mt-3 space-y-2">
                      <label className="block">
                        <span className="orbit-label">Lock timeout in seconds</span>
                        <input
                          type="number"
                          className="orbit-input"
                          min={10}
                          value={chatSettingsTimeout}
                          onChange={(e) => setChatSettingsTimeout(e.target.value)}
                          placeholder="300"
                        />
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {[30, 60, 300, 900].map((seconds) => (
                          <button
                            key={seconds}
                            type="button"
                            className="orbit-btn px-2 py-1 text-[11px]"
                            onClick={() => setChatSettingsTimeout(String(seconds))}
                          >
                            {seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  </div>

                  {/* ── Chat Code Protection ── */}
                  <div className="rounded-xl border border-white/10 bg-orbit-panelAlt/70 p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Chat Code Protection</p>
                    {(() => {
                      const conv = selectedConversation;
                      const myId = user?.id;
                      if (!conv || !myId) return null;

                      // Passcode is currently disabled
                      if (!conv.passcodeEnabled) {
                        return (
                          <div>
                            <p className="mb-2 text-xs text-orbit-muted">
                              Chat codes are <span className="font-semibold text-amber-300">disabled</span> for this chat.
                              Either person can re-enable protection, which will generate a new code shown to both members.
                            </p>
                            <button
                              className="orbit-btn px-3 py-2 text-xs"
                              disabled={chatSettingsSaving}
                              onClick={async () => {
                                if (!token) return;
                                setChatSettingsSaving(true);
                                setChatSettingsError(null);
                                try {
                                  const result = await api.reenablePasscode(conv.id, token);
                                  setConversations((prev) =>
                                    prev.map((c) => (c.id === result.conversation.id ? result.conversation : c))
                                  );
                                  // Show the new passcode to the caller
                                  const otherMember = result.conversation.members.find((m) => m.userId !== myId);
                                  const label = result.conversation.name?.trim()
                                    ? result.conversation.name.trim()
                                    : `${otherMember?.user.username ?? "chat"}#${result.conversation.id.slice(0, 4)}`;
                                  setPendingChatPasscode({
                                    conversationId: result.conversation.id,
                                    passcode: result.passcode,
                                    label,
                                  });
                                  setShowChatSettings(false);
                                } catch (err: any) {
                                  setChatSettingsError(err?.message ?? "Failed to re-enable passcode");
                                } finally {
                                  setChatSettingsSaving(false);
                                }
                              }}
                            >
                              {chatSettingsSaving ? "Enabling..." : "Re-enable chat code"}
                            </button>
                          </div>
                        );
                      }

                      // I requested to disable, waiting for other member
                      if (conv.passcodeDisableRequestedBy === myId) {
                        return (
                          <div>
                            <p className="mb-2 text-xs text-orbit-muted">
                              You've requested to <span className="font-semibold text-amber-300">disable</span> the chat code.
                              Waiting for the other person to approve.
                            </p>
                            <button
                              className="orbit-btn px-3 py-2 text-xs"
                              disabled={chatSettingsSaving}
                              onClick={async () => {
                                if (!token) return;
                                setChatSettingsSaving(true);
                                setChatSettingsError(null);
                                try {
                                  const updated = await api.cancelDisableRequest(conv.id, token);
                                  setConversations((prev) =>
                                    prev.map((c) => (c.id === updated.id ? updated : c))
                                  );
                                } catch (err: any) {
                                  setChatSettingsError(err?.message ?? "Failed to cancel request");
                                } finally {
                                  setChatSettingsSaving(false);
                                }
                              }}
                            >
                              {chatSettingsSaving ? "Cancelling..." : "Cancel request"}
                            </button>
                          </div>
                        );
                      }

                      // The other member requested to disable, I can approve
                      if (conv.passcodeDisableRequestedBy && conv.passcodeDisableRequestedBy !== myId) {
                        const requester = conv.members.find((m) => m.userId === conv.passcodeDisableRequestedBy);
                        return (
                          <div>
                            <p className="mb-2 text-xs text-orbit-muted">
                              <span className="font-semibold text-orbit-accent">@{requester?.user.username ?? "Other member"}</span> has
                              requested to disable the chat code. Both members must agree.
                            </p>
                            <div className="flex gap-2">
                              <button
                                className="orbit-btn-primary px-3 py-2 text-xs"
                                disabled={chatSettingsSaving}
                                onClick={async () => {
                                  if (!token) return;
                                  setChatSettingsSaving(true);
                                  setChatSettingsError(null);
                                  try {
                                    const result = await api.requestDisablePasscode(conv.id, token);
                                    setConversations((prev) =>
                                      prev.map((c) => (c.id === result.conversation.id ? result.conversation : c))
                                    );
                                    if (result.status === "disabled") {
                                      chatLock.unlock(result.conversation.id, result.conversation.lockMode, result.conversation.lockTimeoutSeconds);
                                    }
                                  } catch (err: any) {
                                    setChatSettingsError(err?.message ?? "Failed to approve");
                                  } finally {
                                    setChatSettingsSaving(false);
                                  }
                                }}
                              >
                                {chatSettingsSaving ? "Approving..." : "Approve & disable"}
                              </button>
                            </div>
                          </div>
                        );
                      }

                      // Default: passcode enabled, no pending request — user can request to disable
                      return (
                        <div>
                          <p className="mb-2 text-xs text-orbit-muted">
                            Chat codes are <span className="font-semibold text-green-400">enabled</span>.
                            To disable, both members must agree. Either person can re-enable at any time.
                          </p>
                          <button
                            className="orbit-btn px-3 py-2 text-xs"
                            disabled={chatSettingsSaving}
                            onClick={async () => {
                              if (!token) return;
                              setChatSettingsSaving(true);
                              setChatSettingsError(null);
                              try {
                                const result = await api.requestDisablePasscode(conv.id, token);
                                setConversations((prev) =>
                                  prev.map((c) => (c.id === result.conversation.id ? result.conversation : c))
                                );
                              } catch (err: any) {
                                setChatSettingsError(err?.message ?? "Failed to request disable");
                              } finally {
                                setChatSettingsSaving(false);
                              }
                            }}
                          >
                            {chatSettingsSaving ? "Requesting..." : "Request to disable chat code"}
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  {/* ── Group Member Management ── */}
                  {selectedConversation && selectedConversation.type === "group" && (
                    <div className="rounded-xl border border-white/10 bg-orbit-panelAlt/70 p-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Members ({selectedConversation.members.length})
                      </p>
                      <div className="mb-3 max-h-32 space-y-1.5 overflow-y-auto">
                        {selectedConversation.members.map((member) => (
                          <div key={member.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2 py-1.5">
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panel text-[9px] font-semibold text-orbit-text">
                                {(profileById[member.userId]?.avatarUrl) ? (
                                  <img src={profileById[member.userId]?.avatarUrl ?? ""} alt={`@${member.user.username}`} className="h-full w-full object-cover" />
                                ) : (
                                  (member.user.username[0] ?? "U").toUpperCase()
                                )}
                              </div>
                              <span className="min-w-0 truncate text-xs font-semibold text-orbit-text">
                                @{member.user.username}
                                {member.userId === selectedConversation.createdBy && (
                                  <span className="ml-1 text-[10px] text-orbit-accent"> (owner)</span>
                                )}
                                {user && member.userId === user.id && (
                                  <span className="ml-1 text-[10px] text-orbit-muted"> (you)</span>
                                )}
                              </span>
                            </div>
                            {/* TODO: Add remove button here for group owners in future */}
                          </div>
                        ))}
                      </div>
                      <button
                        className="orbit-btn w-full px-3 py-2 text-xs"
                        onClick={() => {
                          setAddMemberSearch("");
                          setAddMembersModal((prev) => ({
                            ...prev,
                            open: true,
                            conversationId: selectedConversation.id,
                          }));
                        }}
                      >
                        Add Members
                      </button>
                    </div>
                  )}

                  {/* ── Danger Zone ── */}
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-rose-400">Danger Zone</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="orbit-btn px-3 py-2 text-xs"
                        onClick={() => {
                          archiveConversation(selectedConversation.id);
                          setShowChatSettings(false);
                        }}
                      >
                        {archivedConvIds.has(selectedConversation.id) ? "Unarchive chat" : "Archive chat"}
                      </button>
                      <button
                        className="orbit-btn px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/15"
                        onClick={() => {
                          openDeleteModal(selectedConversation);
                          setShowChatSettings(false);
                        }}
                      >
                        {selectedConversation.type === "dm" ? "Delete chat" : "Leave group"}
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      className="orbit-btn px-3 py-2"
                      onClick={() => setShowChatSettings(false)}
                      disabled={chatSettingsSaving}
                    >
                      Cancel
                    </button>
                    <button
                      className="orbit-btn-primary px-4 py-2"
                      disabled={chatSettingsSaving}
                      onClick={async () => {
                        if (!token) return;
                        setChatSettingsSaving(true);
                        setChatSettingsError(null);
                        try {
                          const data: Parameters<typeof api.updateChatSettings>[1] = {
                            name: chatSettingsName,
                            lockMode: chatSettingsLockMode,
                            passcodeLength: chatSettingsLength,
                          };
                          if (chatSettingsPasscode) {
                            data.passcode = chatSettingsPasscode;
                          }
                          if (chatSettingsLockMode === "after_time" || chatSettingsLockMode === "after_inactivity") {
                            data.lockTimeoutSeconds = Math.max(10, Number(chatSettingsTimeout) || 300);
                          }
                          const updated = await api.updateChatSettings(selectedConversation.id, data, token);
                          setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
                          setRealtimePreferencesForConversation(selectedConversation.id, {
                            readReceipts: chatSettingsReadReceipts,
                            typingIndicators: chatSettingsTypingIndicators,
                          });
                          if (!chatSettingsTypingIndicators) {
                            emitTypingStop(selectedConversation.id);
                            setTypingByConversation((prev) => {
                              const { [selectedConversation.id]: _removed, ...rest } = prev;
                              return rest;
                            });
                          }
                          chatLock.unlock(updated.id, updated.lockMode, updated.lockTimeoutSeconds);
                          setShowChatSettings(false);
                        } catch (err: any) {
                          setChatSettingsError(err?.message ?? "Failed to save settings");
                        } finally {
                          setChatSettingsSaving(false);
                        }
                      }}
                    >
                      {chatSettingsSaving ? "Saving..." : "Save settings"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Group creation modal */}
        {groupCreationModal.open && (
          <div
            className="orbit-modal-overlay"
            onClick={() => {
              if (!groupCreationModal.loading) {
                setGroupCreationModal((prev) => ({
                  ...prev,
                  open: false,
                  selectedMemberIds: new Set(),
                  groupName: "",
                  error: null,
                }));
                setGroupMemberSearch("");
              }
            }}
          >
            <div
              className="orbit-modal max-w-sm"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <h3 className="text-base font-bold text-orbit-text">Create Group Chat</h3>
              <p className="mt-1 text-xs text-orbit-muted">Add members from your friends and give the group a name.</p>

              {groupCreationModal.error && (
                <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {groupCreationModal.error}
                </div>
              )}

              <label className="mt-4 block">
                <span className="orbit-label">Group name</span>
                <input
                  className="orbit-input"
                  placeholder="My Team"
                  value={groupCreationModal.groupName}
                  onChange={(e) => setGroupCreationModal((prev) => ({ ...prev, groupName: e.target.value, error: null }))}
                  maxLength={64}
                />
              </label>

              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold text-slate-400">Select members ({groupCreationModal.selectedMemberIds.size})</p>
                <input
                  className="orbit-input mb-2"
                  placeholder="Search members..."
                  value={groupMemberSearch}
                  onChange={(e) => setGroupMemberSearch(e.target.value)}
                />
                <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-white/10 bg-orbit-panelAlt p-2">
                  {friends.length === 0 ? (
                    <p className="text-center text-xs text-orbit-muted">No friends to add yet. Add some friends first.</p>
                  ) : filteredGroupCreationFriends.length === 0 ? (
                    <p className="text-center text-xs text-orbit-muted">No members match that search.</p>
                  ) : (
                    filteredGroupCreationFriends.map((friend) => {
                      const isSelected = groupCreationModal.selectedMemberIds.has(friend.user.id);
                      const avatarUrl = friend.user.avatarUrl ?? profileById[friend.user.id]?.avatarUrl ?? null;
                      return (
                        <label
                          key={friend.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 transition ${
                            isSelected
                              ? "border-orbit-accent/50 bg-orbit-accent/10"
                              : "border-white/5 bg-white/[0.02] hover:border-white/10"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const newIds = new Set(groupCreationModal.selectedMemberIds);
                              if (e.target.checked) {
                                newIds.add(friend.user.id);
                              } else {
                                newIds.delete(friend.user.id);
                              }
                              setGroupCreationModal((prev) => ({
                                ...prev,
                                selectedMemberIds: newIds,
                                error: null,
                              }));
                            }}
                            className="h-4 w-4 accent-orbit-accent"
                          />
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panel text-[10px] font-semibold text-orbit-text">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt={`@${friend.user.username}`} className="h-full w-full object-cover" />
                            ) : (
                              (friend.user.username[0] ?? "U").toUpperCase()
                            )}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">@{friend.user.username}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="orbit-btn px-3 py-2"
                  disabled={groupCreationModal.loading}
                  onClick={() => {
                    setGroupCreationModal((prev) => ({
                      ...prev,
                      open: false,
                      selectedMemberIds: new Set(),
                      groupName: "",
                      error: null,
                    }));
                    setGroupMemberSearch("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="orbit-btn-primary px-4 py-2"
                  disabled={groupCreationModal.loading || groupCreationModal.selectedMemberIds.size === 0}
                  onClick={() => void startGroupChat()}
                >
                  {groupCreationModal.loading ? "Creating..." : "Create Group"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add members to group modal */}
        {addMembersModal.open && (
          <div
            className="orbit-modal-overlay"
            onClick={() => {
              if (!addMembersModal.loading) {
                setAddMembersModal((prev) => ({
                  ...prev,
                  open: false,
                  conversationId: null,
                  selectedMemberIds: new Set(),
                  error: null,
                }));
                setAddMemberSearch("");
              }
            }}
          >
            <div
              className="orbit-modal max-w-sm"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <h3 className="text-base font-bold text-orbit-text">Add Members to Group</h3>
              <p className="mt-1 text-xs text-orbit-muted">Select friends to invite to this group.</p>

              {addMembersModal.error && (
                <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {addMembersModal.error}
                </div>
              )}

              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold text-slate-400">Select members to invite ({addMembersModal.selectedMemberIds.size})</p>
                <input
                  className="orbit-input mb-2"
                  placeholder="Search members..."
                  value={addMemberSearch}
                  onChange={(e) => setAddMemberSearch(e.target.value)}
                />
                <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-white/10 bg-orbit-panelAlt p-2">
                  {friends.length === 0 ? (
                    <p className="text-center text-xs text-orbit-muted">No friends available.</p>
                  ) : filteredAddMembersFriends.length === 0 ? (
                    <p className="text-center text-xs text-orbit-muted">No members match that search.</p>
                  ) : (
                    filteredAddMembersFriends.map((friend) => {
                      const isSelected = addMembersModal.selectedMemberIds.has(friend.user.id);
                      const avatarUrl = friend.user.avatarUrl ?? profileById[friend.user.id]?.avatarUrl ?? null;

                      return (
                        <label
                          key={friend.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 transition ${
                            isSelected
                              ? "border-orbit-accent/50 bg-orbit-accent/10"
                              : "border-white/5 bg-white/[0.02] hover:border-white/10"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const newIds = new Set(addMembersModal.selectedMemberIds);
                              if (e.target.checked) {
                                newIds.add(friend.user.id);
                              } else {
                                newIds.delete(friend.user.id);
                              }
                              setAddMembersModal((prev) => ({
                                ...prev,
                                selectedMemberIds: newIds,
                                error: null,
                              }));
                            }}
                            className="h-4 w-4 accent-orbit-accent"
                          />
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panel text-[10px] font-semibold text-orbit-text">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt={`@${friend.user.username}`} className="h-full w-full object-cover" />
                            ) : (
                              (friend.user.username[0] ?? "U").toUpperCase()
                            )}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">@{friend.user.username}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="orbit-btn px-3 py-2"
                  disabled={addMembersModal.loading}
                  onClick={() => {
                    setAddMembersModal((prev) => ({
                      ...prev,
                      open: false,
                      conversationId: null,
                      selectedMemberIds: new Set(),
                      error: null,
                    }));
                    setAddMemberSearch("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="orbit-btn-primary px-4 py-2"
                  disabled={addMembersModal.loading || addMembersModal.selectedMemberIds.size === 0}
                  onClick={() => void addMembersToGroup()}
                >
                  {addMembersModal.loading ? "Adding..." : "Add Members"}
                </button>
              </div>
            </div>
          </div>
        )}

        <UserProfilePopover
          open={Boolean(profilePopoverUserId)}
          anchorRect={profilePopoverAnchor}
          profile={profilePopoverUserId ? profileById[profilePopoverUserId] ?? null : null}
          loading={profilePopoverUserId ? profileLoadingById[profilePopoverUserId] ?? false : false}
          error={profilePopoverUserId ? profileErrorById[profilePopoverUserId] ?? null : null}
          onClose={closeProfilePopover}
          canEdit={Boolean(user && profilePopoverUserId && user.id === profilePopoverUserId)}
          onEditClick={() => {
            setMainView("profile-settings");
            setSelectedConvId(null);
          }}
        />

        {/* Context menu */}
        <ContextMenuPortal menu={ctxMenu.menu} onClose={ctxMenu.hide} />

        {/* Dev overlay — only renders in dev builds */}
        {import.meta.env.DEV && <DevOverlay />}

        {/* Delete / Leave confirmation modal */}
        {deleteModal && (
          <div className="orbit-modal-overlay" onClick={() => { if (!deleteLoading) setDeleteModal(null); }}>
            <div className="orbit-modal max-w-md" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <h3 className="text-base font-bold text-orbit-text">
                {deleteModal.type === "dm" ? "Delete Chat & Unfriend" : "Leave Group Chat"}
              </h3>

              {deleteModal.type === "dm" ? (
                <p className="mt-2 text-sm text-slate-300">
                  This will permanently <strong className="text-rose-400">delete the chat</strong>, remove the friendship, and erase the chat media from the server for both sides.
                  The conversation will no longer be available to either person.
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-300">
                  You are about to leave <strong className="text-orbit-accent">{deleteModal.displayName}</strong>.
                  Other members will still see the group. If you are the last member, the group and all its data will be permanently deleted.
                </p>
              )}

              {deleteModal.type === "group" ? (
                <>
                  <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={deleteWipeMessages}
                      onChange={(e) => setDeleteWipeMessages(e.target.checked)}
                      className="h-4 w-4 accent-orbit-accent"
                    />
                    <span className="text-sm text-slate-200">
                      Delete all my messages from this chat
                    </span>
                  </label>
                  <p className="mt-1 text-[11px] text-orbit-muted">
                    {deleteWipeMessages
                      ? "Your messages and any files you sent will be permanently wiped from the server."
                      : "Your messages will remain visible to the other member(s)."}
                  </p>
                </>
              ) : (
                <p className="mt-4 text-[11px] text-orbit-muted">
                  This action always removes the DM, its messages, and any uploaded media from the server.
                </p>
              )}

              {deleteError && (
                <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {deleteError}
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="orbit-btn px-3 py-2"
                  disabled={deleteLoading}
                  onClick={() => setDeleteModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="orbit-btn-danger px-4 py-2"
                  disabled={deleteLoading}
                  onClick={handleDeleteOrLeave}
                >
                  {deleteLoading
                    ? "Processing..."
                    : deleteModal.type === "dm"
                      ? "Delete & Unfriend"
                      : "Leave Group"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
