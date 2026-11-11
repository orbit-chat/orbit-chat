import { useEffect } from "react";
import { getPlatform } from "../../platform";
import { useAuthStore } from "../../stores/authStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { routeConversationId, useNavigationStore } from "../../stores/navigationStore";
import { DEFAULT_NOTIFICATIONS, usePrefsStore } from "../../stores/prefsStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useSocketStore } from "../../stores/socketStore";
import { useConversationsStore } from "../conversations/conversationsStore";
import { conversationTitle } from "../conversations/selectors";
import { useDecryptedStore } from "../chat/decryptedStore";
import type { MessageEnvelope } from "../chat/envelope";
import { notificationContent, shouldNotify, windowTitle } from "./notificationRules";

/** A short two-tone chime made with Web Audio, so there's no sound file to ship. */
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.25);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Audio can be unavailable (no output device, autoplay policy); notifications still work.
  }
}

export const notificationsSupported = () => getPlatform().notifications.supported();

/** Shows a notification that opens the conversation when clicked. */
export function showNotification(params: { title: string; body: string; conversationId: string; onClick?: () => void }) {
  getPlatform().notifications.show({ title: params.title, body: params.body, tag: params.conversationId, onClick: params.onClick });
}

async function decryptIfPossible(data: { id: string; conversationId: string; ciphertext: string; nonce?: string; keyVersion?: number }): Promise<MessageEnvelope | null> {
  const key = useE2EEStore.getState().getConversationSecretKeyForVersion(data.conversationId, data.keyVersion);
  if (!key) return null;
  const entry = await useDecryptedStore.getState().ensure({ id: data.id, cipherText: data.ciphertext, nonce: data.nonce }, key);
  return entry.status === "ok" ? entry.envelope : null;
}

/**
 * Desktop notifications, the new-message chime, taskbar attention, and an unread count in
 * the window title.
 */
export function useNotifications() {
  const socket = useSocketStore((s) => s.socket);
  const me = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!socket || !me) return;
    const onNewMessage = async (data: { id: string; conversationId: string; senderId: string; sender: string; ciphertext: string; nonce?: string; keyVersion?: number }) => {
      const prefsState = usePrefsStore.getState();
      const userPrefs = prefsState.userId ? prefsState.byUser[prefsState.userId] : undefined;
      const prefs = userPrefs?.notifications ?? DEFAULT_NOTIFICATIONS;
      if (data.senderId === me.id || prefs.mode === "off") return;
      const conversation = useConversationsStore.getState().conversations.find((c) => c.id === data.conversationId);
      // Locked chats are never decrypted for a notification.
      const needsText = !conversation?.passcodeEnabled && (prefs.mode === "mentions" || prefs.showPreview);
      const envelope = needsText ? await decryptIfPossible(data) : null;
      const notify = shouldNotify({
        message: data,
        myUserId: me.id,
        myUsername: me.username,
        prefs,
        muted: userPrefs?.mutedConversationIds.includes(data.conversationId) ?? false,
        windowFocused: document.hasFocus(),
        openConversationId: routeConversationId(useNavigationStore.getState().route),
        envelope
      });
      if (!notify) return;

      const profiles = useProfilesStore.getState().byId;
      const content = notificationContent({
        message: data,
        conversation,
        senderName: profiles[data.senderId]?.displayName?.trim() || data.sender,
        conversationTitle: conversation ? conversationTitle(conversation, me.id, profiles) : "a chat",
        prefs,
        envelope
      });
      showNotification({
        ...content,
        conversationId: data.conversationId,
        onClick: () => conversation && useNavigationStore.getState().openConversation(conversation)
      });
      if (prefs.sound) playChime();
      getPlatform().requestAttention();
    };
    socket.on("new_message", onNewMessage);
    return () => {
      socket.off("new_message", onNewMessage);
    };
  }, [socket, me]);

  // Unread count in the window/taskbar title.
  const unread = useMessagesStore((s) => s.unreadCountByConversation);
  const muted = usePrefsStore((s) => (s.userId ? s.byUser[s.userId]?.mutedConversationIds : undefined));
  useEffect(() => {
    document.title = windowTitle(unread, muted ?? []);
    return () => {
      document.title = "Orbit Chat";
    };
  }, [unread, muted]);
}
