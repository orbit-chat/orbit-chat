import type { ChatMessage } from "../../stores/messagesStore";
import { GifAttachment, MediaAttachment } from "./Attachments";
import { MessageText } from "./MessageText";
import type { DecryptState } from "./useDecryptedMessage";

/** Decrypted text and attachments, or an honest placeholder when they can't be shown. */
export function MessageBody({
  conversationId,
  message,
  decrypted,
  myUsername,
  unreadableVersion
}: {
  conversationId: string;
  message: ChatMessage;
  decrypted: DecryptState;
  myUsername?: string;
  /** Sent under a key version from before you joined; the server shouldn't send these, but old caches may hold them. */
  unreadableVersion: boolean;
}) {
  if (unreadableVersion) {
    return <p className="italic text-orbit-muted">Sent before you joined, so this device can't read it.</p>;
  }
  if (decrypted.status === "pending") {
    return <span className="block h-3 w-40 max-w-full animate-pulse rounded bg-white/10" aria-label="Decrypting" />;
  }
  if (decrypted.status === "nokey") {
    return <p className="italic text-orbit-muted">Waiting for this conversation's key…</p>;
  }
  if (decrypted.status === "failed") {
    return <p className="italic text-orbit-muted">This message couldn't be decrypted on this device.</p>;
  }

  const { text, attachments } = decrypted.envelope;
  return (
    <div className="space-y-2">
      {text && <MessageText text={text} myUsername={myUsername} />}
      {attachments.map((attachment, i) =>
        attachment.kind === "gif_link" ? (
          <GifAttachment key={`${attachment.url}:${i}`} attachment={attachment} />
        ) : (
          <MediaAttachment key={attachment.mediaId} conversationId={conversationId} keyVersion={message.keyVersion} attachment={attachment} />
        )
      )}
    </div>
  );
}
