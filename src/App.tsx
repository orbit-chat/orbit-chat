import { FormEvent, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useAuthStore } from "./stores/authStore";
import { useMessagesStore } from "./stores/messagesStore";
import { useSocketStore } from "./stores/socketStore";
import { useProfilesStore } from "./stores/profilesStore";
import { useE2EEStore } from "./stores/e2eeStore";
import { useChatLockStore } from "./stores/chatLockStore";
import * as api from "./lib/api";
import type { Conversation } from "./lib/api";
import { decryptMessage, encryptMessage, generateSecretKey, sealToPublicKey } from "./lib/crypto";
import { UserProfilePopover } from "./components/UserProfilePopover";
import { ProfileSettings } from "./components/ProfileSettings";

function latestPublicKey(keys: { publicKey: string; createdAt: string }[]) {
  if (!keys.length) return null;
  return keys
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]!
    .publicKey;
}

function DecryptedMessageText(props: {
  conversationId: string;
  cipherText: string;
  nonce?: string;
  keyVersion?: number;
}) {
  const { conversationId, cipherText, nonce, keyVersion } = props;
  const secretKey = useE2EEStore((state) => state.getConversationSecretKeyForVersion(conversationId, keyVersion));
  const [plain, setPlain] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!secretKey || !nonce) {
        setPlain(null);
        return;
      }

      try {
        const text = await decryptMessage(cipherText, nonce, secretKey);
        if (!cancelled) setPlain(text);
      } catch {
        if (!cancelled) setPlain(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [cipherText, nonce, secretKey]);

  return <p className="mt-1 break-words text-orbit-text">{plain ?? "Encrypted message (unable to decrypt on this device)."}</p>;
}

function App() {
  const [appVersion, setAppVersion] = useState("-");
  const [authMode, setAuthMode] = useState<"login" | "signup" | "recovery">("login");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [mainView, setMainView] = useState<"chat" | "profile-settings">("chat");
  const [navTab, setNavTab] = useState<"dm" | "friends" | "archive">("dm");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authValidationError, setAuthValidationError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [messageDraft, setMessageDraft] = useState("");

  const [profilePopoverUserId, setProfilePopoverUserId] = useState<string | null>(null);
  const [profilePopoverAnchor, setProfilePopoverAnchor] = useState<DOMRect | null>(null);

  /** Passcode for newly created chat (shown once) */
  const [pendingChatPasscode, setPendingChatPasscode] = useState<{ conversationId: string; passcode: string } | null>(null);
  /** When a locked chat is selected, show the unlock screen */
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [bypassRecoveryCode, setBypassRecoveryCode] = useState("");
  const [showBypassInput, setShowBypassInput] = useState(false);
  /** Chat settings panel */
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [chatSettingsPasscode, setChatSettingsPasscode] = useState("");
  const [chatSettingsLength, setChatSettingsLength] = useState(2);
  const [chatSettingsLockMode, setChatSettingsLockMode] = useState<api.ChatLockMode>("on_leave");
  const [chatSettingsTimeout, setChatSettingsTimeout] = useState("");
  const [chatSettingsError, setChatSettingsError] = useState<string | null>(null);
  const [chatSettingsSaving, setChatSettingsSaving] = useState(false);

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
  const { connected, connect, disconnect, socket } = useSocketStore();
  const { byConversation, unreadCountByConversation, upsertMessage, setActiveConversation } = useMessagesStore();
  const profiles = useProfilesStore();
  const ensureConversationSecretKey = useE2EEStore((state) => state.ensureConversationSecretKey);
  const ensureDeviceKeypair = useE2EEStore((state) => state.ensureDeviceKeypair);
  const getConversationSecretKey = useE2EEStore((state) => state.getConversationSecretKey);
  const getConversationKeyVersion = useE2EEStore((state) => state.getConversationKeyVersion);
  const loadingByConversationId = useE2EEStore((state) => state.loadingByConversationId);

  const chatLock = useChatLockStore();

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConvId) ?? null,
    [conversations, selectedConvId]
  );

  const dmPartner = useMemo(() => {
    if (!selectedConversation || !user) return null;
    if (selectedConversation.type !== "dm") return null;
    return selectedConversation.members.find((m) => m.user.id !== user.id)?.user ?? null;
  }, [selectedConversation, user]);

  const messages = useMemo(
    () => (selectedConvId ? byConversation[selectedConvId] ?? [] : []),
    [byConversation, selectedConvId]
  );

  const sortedConversations = useMemo(() => {
    const getConversationLastActivity = (conversation: Conversation) => {
      const convoMessages = byConversation[conversation.id] ?? [];
      const lastMessageAt = convoMessages.length ? convoMessages[convoMessages.length - 1]!.createdAt : 0;
      return Math.max(lastMessageAt, new Date(conversation.createdAt).getTime());
    };

    return conversations
      .slice()
      .sort((a, b) => getConversationLastActivity(b) - getConversationLastActivity(a));
  }, [byConversation, conversations]);

  const hasUnreadDm = useMemo(() => {
    return conversations.some((conv) => {
      if (conv.type !== "dm") return false;
      return (unreadCountByConversation[conv.id] ?? 0) > 0;
    });
  }, [conversations, unreadCountByConversation]);

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

  // Get the "other" user's name in a DM
  const dmPartnerName = useMemo(() => {
    if (!selectedConversation || !user) return null;
    const other = selectedConversation.members.find((m) => m.user.id !== user.id);
    return other?.user.username ?? selectedConversation.name ?? "Chat";
  }, [selectedConversation, user]);

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
    setFriends(friendList);
    setFriendRequests(requests);
  }, [token]);

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
      await loadFriendsData();
    });
  }, [loadFriendsData, runFriendAction, token]);

  const openProfilePopover = useCallback(
    async (userId: string, anchorEl?: HTMLElement | null) => {
      if (!token) return;
      setProfilePopoverUserId(userId);
      setProfilePopoverAnchor(anchorEl ? anchorEl.getBoundingClientRect() : null);
      await profiles.fetchProfile(userId, token);
    },
    [profiles, token]
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
    profiles.fetchMe(token, user.id);
  }, [token, user?.id]);

  useEffect(() => {
    if (navTab !== "dm") {
      setActiveConversation(null);
      return;
    }
    setActiveConversation(selectedConvId);
  }, [navTab, selectedConvId, setActiveConversation]);

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
          cipherText: m.ciphertext,
          keyVersion: m.keyVersion,
          nonce: m.nonce,
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

    const handleNewMessage = (data: { conversationId: string }) => {
      const exists = conversationsRef.current.some((conv) => conv.id === data.conversationId);
      if (!exists) {
        void loadConversations();
      }
    };

    socket.on("new_message", handleNewMessage);
    return () => {
      socket.off("new_message", handleNewMessage);
    };
  }, [socket, token, loadConversations]);

  /* ───── Ensure conversation secret key for DMs ───── */
  useEffect(() => {
    if (!token || !user || !selectedConversation) return;
    if (selectedConversation.type !== "dm") return;
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

  /* ───── Start DM with a searched user (always creates a new chat) ───── */
  const startDM = async (targetUser: { id: string; username: string }) => {
    if (!token) return;
    if (!user) return;

    setMainView("chat");

    // Always create a new DM conversation (multiple chats per person allowed)
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

      setConversations((prev) => {
        const withoutDup = prev.filter((existingConv) => existingConv.id !== conv.id);
        return [conv, ...withoutDup];
      });
      setSelectedConvId(conv.id);
      setMainView("chat");
      setSearch("");
      setSearchResults([]);

      // Show the one-time passcode to the user
      if (conv.passcode) {
        setPendingChatPasscode({ conversationId: conv.id, passcode: conv.passcode });
      }

      // Auto-unlock the newly created chat
      chatLock.unlock(conv.id, conv.lockMode, conv.lockTimeoutSeconds);

      await ensureConversationSecretKey({ conversation: conv, token, myUserId: user.id });
    } catch {
      // handle error
    }
  };

  /* ───── Send message over socket ───── */
  const handleSendMessage = () => {
    const draft = messageDraft.trim();
    if (!draft || !selectedConvId || !user || !socket) return;
    if (!token) return;

    if (!selectedConversation || selectedConversation.type !== "dm") return;

    (async () => {
      try {
        const secretKey = await ensureConversationSecretKey({
          conversation: selectedConversation,
          token,
          myUserId: user.id,
        });
        if (!secretKey) return;

        const { cipherText, nonce } = await encryptMessage(draft, secretKey);

        socket.emit("send_message", {
          conversationId: selectedConvId,
          ciphertext: cipherText,
          nonce,
          keyVersion: getConversationKeyVersion(selectedConvId) ?? 1,
        });

        setMessageDraft("");
      } catch {
        // ignore
      }
    })();
  };

  /* ════════════════════════════════════════════════════ */
  /*  NEW CHAT PASSCODE DISPLAY (shown once on creation)  */
  /* ════════════════════════════════════════════════════ */
  if (user && pendingChatPasscode) {
    return (
      <div className="relative flex h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-orbit-bg via-orbit-panelAlt to-orbit-panel p-6 text-orbit-text">
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
    );
  }

  /* ════════════════════════════════════════════════════ */
  /*  RECOVERY CODES DISPLAY (shown once after signup)    */
  /* ════════════════════════════════════════════════════ */
  if (user && pendingRecoveryCodes && pendingRecoveryCodes.length > 0) {
    return (
      <div className="relative flex h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-orbit-bg via-orbit-panelAlt to-orbit-panel p-6 text-orbit-text">
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
    );
  }

  /* ════════════════════════════════════════════════════ */
  /*  AUTH SCREEN                                         */
  /* ════════════════════════════════════════════════════ */
  if (!user) {
    return (
      <div className="relative flex h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-orbit-bg via-orbit-panelAlt to-orbit-panel p-6 text-orbit-text">
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
    );
  }

  /* ════════════════════════════════════════════════════ */
  /*  MAIN CHAT SCREEN                                    */
  /* ════════════════════════════════════════════════════ */
  return (
    <div className="h-screen overflow-hidden bg-gradient-to-b from-orbit-bg to-orbit-panelAlt text-orbit-text">
      <div className="grid h-full grid-cols-[74px_300px_1fr]">
        {/* ───── Left icon rail ───── */}
        <aside className="border-r border-white/10 bg-orbit-panelAlt/60 p-2.5">
          <div className="mb-4 flex items-center justify-center rounded-2xl bg-orbit-accent/15 p-2.5">
            <img src="logo.png" alt="Orbit Chat logo" className="h-9 w-9 rounded-xl object-cover" />
          </div>
          <div className="space-y-2.5">
            {[
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
                  className={`group w-full rounded-2xl border px-2 py-2 text-[11px] font-semibold transition ${
                    active
                      ? "border-orbit-accent/60 bg-gradient-to-br from-orbit-accent/20 to-orbit-accent/5 text-orbit-text shadow-[0_0_0_1px_rgba(0,0,0,0.15)_inset]"
                      : "border-white/10 bg-orbit-panel/80 text-orbit-muted hover:border-white/25 hover:bg-orbit-panel"
                  }`}
                  onClick={() => {
                    setNavTab(item.key);
                    if (item.key !== "dm") {
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
        <aside className="border-r border-white/10 bg-orbit-panel p-3.5">
          {navTab === "dm" && (
            <>
              <h1 className="text-lg font-semibold">Orbit Direct Messages</h1>
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

                    return (
                      <div key={u.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-orbit-panelAlt p-2">
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
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent chats</p>
                <span className="text-xs text-orbit-muted">{sortedConversations.length}</span>
              </div>

              <div className="mt-2 space-y-2 overflow-y-auto pr-1">
                {sortedConversations.map((conv) => {
                  const isSelected = conv.id === selectedConvId;
                  const otherMember = conv.members.find((m) => m.user.id !== user.id);
                  const convoMessages = byConversation[conv.id] ?? [];
                  const lastMessage = convoMessages.length ? convoMessages[convoMessages.length - 1] : null;
                  const displayName =
                    conv.type === "dm"
                      ? otherMember?.user.username ?? "DM"
                      : conv.name ?? "Group";
                  const preview = lastMessage
                    ? `${lastMessage.sender === user.username ? "You" : lastMessage.sender}: Encrypted message`
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
                          ? "border-orbit-accent/60 bg-orbit-accent/10"
                          : "border-white/5 bg-orbit-panelAlt hover:border-white/20"
                      }`}
                      onClick={() => {
                        setSelectedConvId(conv.id);
                        setPasscodeInput("");
                        setPasscodeError(null);
                        setShowBypassInput(false);
                        setShowChatSettings(false);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {conv.passcodeEnabled && !chatLock.isUnlocked(conv.id) && (
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-orbit-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          )}
                          <p className="truncate text-sm font-semibold">@{displayName}</p>
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
                {sortedConversations.length === 0 && (
                  <p className="text-xs text-orbit-muted">No conversations yet. Search for a user above to start one.</p>
                )}
              </div>
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
                    return (
                      <div key={u.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-orbit-panelAlt p-2.5">
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
                    <button
                      className="text-sm font-semibold hover:underline"
                      onClick={(event) => openProfilePopover(request.user.id, event.currentTarget)}
                    >
                      @{request.user.username}
                    </button>
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
              <div className="mt-2 max-h-[240px] space-y-2 overflow-y-auto pr-1">
                {friends.map((friend) => (
                  <div key={friend.id} className="rounded-xl border border-white/10 bg-orbit-panelAlt p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={(event) => openProfilePopover(friend.user.id, event.currentTarget)}
                      >
                        <p className="truncate text-sm font-semibold">@{friend.user.username}</p>
                        <p className="truncate text-xs text-orbit-muted">
                          {friend.user.statusEmoji ? `${friend.user.statusEmoji} ` : ""}
                          {friend.user.statusText || friend.user.presence || "Available"}
                        </p>
                      </button>
                      <span className={`h-2.5 w-2.5 rounded-full ${friend.user.presence === "online" ? "bg-emerald-400" : friend.user.presence === "idle" ? "bg-amber-400" : friend.user.presence === "dnd" ? "bg-rose-400" : "bg-slate-500"}`} />
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
              <p className="mt-2 text-sm text-orbit-muted">Archive tools are coming soon.</p>
            </>
          )}

          <div className="orbit-card-solid mt-4 rounded-xl bg-orbit-panelAlt p-4 text-sm">
            <p className="font-semibold">Build {appVersion}</p>
            <p className={connected ? "text-emerald-400" : "text-rose-400"}>
              Socket: {connected ? "Connected" : "Disconnected"}
            </p>
          </div>
        </aside>

        {/* ───── Main content area ───── */}
        <main className="flex h-full flex-col overflow-hidden bg-gradient-to-b from-orbit-bg to-orbit-panelAlt">
          <header className="flex items-center justify-end gap-3 border-b border-white/10 bg-orbit-panel/40 px-4 py-3 backdrop-blur">
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
          </header>

          <section className="min-h-0 flex-1 overflow-y-auto">
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
                    Archived threads and media controls will appear here in a future update.
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
              <div className="flex h-full flex-col">
            <header className="flex items-center justify-between border-b border-white/10 bg-orbit-panel/40 p-4 backdrop-blur">
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
                <p className="text-xs text-orbit-muted">Direct encrypted chat</p>
              </div>
              <div className="flex items-center gap-2">
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
                      setChatSettingsLength(selectedConversation.passcodeLength);
                      setChatSettingsLockMode(selectedConversation.lockMode);
                      setChatSettingsTimeout(selectedConversation.lockTimeoutSeconds?.toString() ?? "");
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

            {/* ════ Chat Settings Panel ════ */}
            {showChatSettings && (
              <div className="border-b border-white/10 bg-orbit-panel/80 p-4 backdrop-blur">
                <div className="mx-auto max-w-md space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-orbit-text">Chat Settings</h3>
                    <button
                      className="text-xs text-orbit-muted hover:text-orbit-text"
                      onClick={() => setShowChatSettings(false)}
                    >
                      Close
                    </button>
                  </div>

                  {chatSettingsError && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                      {chatSettingsError}
                    </div>
                  )}

                  {/* Passcode */}
                  <div>
                    <label className="orbit-label">New Passcode (leave blank to keep current)</label>
                    <input
                      className="orbit-input font-mono tracking-widest"
                      value={chatSettingsPasscode}
                      onChange={(e) => setChatSettingsPasscode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="••••"
                      maxLength={6}
                    />
                  </div>

                  {/* Passcode length */}
                  <div>
                    <label className="orbit-label">Passcode Length (2-6 digits)</label>
                    <input
                      type="number"
                      className="orbit-input"
                      min={2}
                      max={6}
                      value={chatSettingsLength}
                      onChange={(e) => setChatSettingsLength(Math.min(6, Math.max(2, Number(e.target.value))))}
                    />
                  </div>

                  {/* Lock mode */}
                  <div>
                    <label className="orbit-label">Lock Mode</label>
                    <select
                      className="orbit-input"
                      value={chatSettingsLockMode}
                      onChange={(e) => setChatSettingsLockMode(e.target.value as api.ChatLockMode)}
                    >
                      <option value="on_leave">On Leave (lock when you switch away)</option>
                      <option value="on_logout">On Logout (lock on sign out)</option>
                      <option value="after_time">After Time (lock after fixed duration)</option>
                      <option value="after_inactivity">After Inactivity (lock after idle period)</option>
                    </select>
                  </div>

                  {/* Timeout (for time-based lock modes) */}
                  {(chatSettingsLockMode === "after_time" || chatSettingsLockMode === "after_inactivity") && (
                    <div>
                      <label className="orbit-label">Lock Timeout (seconds)</label>
                      <input
                        type="number"
                        className="orbit-input"
                        min={10}
                        value={chatSettingsTimeout}
                        onChange={(e) => setChatSettingsTimeout(e.target.value)}
                        placeholder="300"
                      />
                    </div>
                  )}

                  <button
                    className="orbit-btn-primary w-full"
                    disabled={chatSettingsSaving}
                    onClick={async () => {
                      if (!token) return;
                      setChatSettingsSaving(true);
                      setChatSettingsError(null);
                      try {
                        const data: Parameters<typeof api.updateChatSettings>[1] = {
                          lockMode: chatSettingsLockMode,
                          passcodeLength: chatSettingsLength,
                        };
                        if (chatSettingsPasscode) {
                          data.passcode = chatSettingsPasscode;
                        }
                        if (chatSettingsLockMode === "after_time" || chatSettingsLockMode === "after_inactivity") {
                          data.lockTimeoutSeconds = Number(chatSettingsTimeout) || 300;
                        }
                        const updated = await api.updateChatSettings(selectedConversation.id, data, token);
                        // Update local conversation state
                        setConversations((prev) =>
                          prev.map((c) => (c.id === updated.id ? updated : c))
                        );
                        // Re-unlock with new settings
                        chatLock.unlock(updated.id, updated.lockMode, updated.lockTimeoutSeconds);
                        setShowChatSettings(false);
                      } catch (err: any) {
                        setChatSettingsError(err?.message ?? "Failed to save settings");
                      } finally {
                        setChatSettingsSaving(false);
                      }
                    }}
                  >
                    {chatSettingsSaving ? "Saving..." : "Save Settings"}
                  </button>
                </div>
              </div>
            )}

            <section className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="text-sm text-orbit-muted">No messages yet. Send your first encrypted payload.</p>
              )}
              {messages.map((msg) => {
                const mine = msg.sender === user.username;
                return (
                  <article
                    key={msg.id}
                    className={`max-w-[80%] rounded-2xl border p-3 text-sm ${
                      mine
                        ? "ml-auto border-orbit-accent/20 bg-orbit-accent/15"
                        : "border-white/10 bg-orbit-panel/90"
                    }`}
                  >
                    <button
                      className="font-semibold text-orbit-accent hover:underline"
                      onClick={(e) => openProfilePopover(msg.senderId, e.currentTarget)}
                    >
                      {msg.sender}
                    </button>
                    <DecryptedMessageText
                      conversationId={selectedConversation.id}
                      cipherText={msg.cipherText}
                      nonce={msg.nonce}
                      keyVersion={msg.keyVersion}
                    />
                    <p className={`mt-2 text-[11px] ${mine ? "text-right text-slate-300" : "text-orbit-muted"}`}>
                      {formatMessageTimestamp(msg.createdAt)}
                    </p>
                  </article>
                );
              })}
            </section>

            <footer className="border-t border-white/10 bg-orbit-panel/40 p-4 backdrop-blur">
              <div className="flex gap-3">
                <input
                  className="orbit-input flex-1 px-4"
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Type message..."
                />
                <button
                  className="orbit-btn-primary px-5"
                  onClick={handleSendMessage}
                >
                  Send
                </button>
              </div>
            </footer>
              </div>
            )}
          </section>
        </main>

        <UserProfilePopover
          open={Boolean(profilePopoverUserId)}
          anchorRect={profilePopoverAnchor}
          profile={profilePopoverUserId ? profiles.byId[profilePopoverUserId] ?? null : null}
          loading={profilePopoverUserId ? profiles.loadingById[profilePopoverUserId] ?? false : false}
          error={profilePopoverUserId ? profiles.errorById[profilePopoverUserId] ?? null : null}
          onClose={closeProfilePopover}
          canEdit={Boolean(user && profilePopoverUserId && user.id === profilePopoverUserId)}
          onEditClick={() => {
            setMainView("profile-settings");
            setSelectedConvId(null);
          }}
        />
      </div>
    </div>
  );
}

export default App;
