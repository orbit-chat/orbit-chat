import { decryptMessage } from "../../lib/crypto";

/** An encrypted file: the file key is itself encrypted with the conversation key. */
export type UploadedAttachment = {
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

export type GifLinkAttachment = {
  kind: "gif_link";
  url: string;
  previewUrl?: string;
  title?: string;
};

export type MessageAttachment = UploadedAttachment | GifLinkAttachment;

/** What's inside a message ciphertext. Older clients sent bare text, which decodes to `{ text }`. */
export type MessageEnvelope = {
  text: string;
  attachments: MessageAttachment[];
};

function isAttachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "gif_link") return typeof (value as GifLinkAttachment).url === "string";
  if (kind === "image" || kind === "file") {
    const a = value as UploadedAttachment;
    return typeof a.mediaId === "string" && typeof a.fileKeyCiphertext === "string" && typeof a.fileKeyNonce === "string";
  }
  return false;
}

/**
 * Parses decrypted plaintext. Anything that isn't a JSON object with the expected
 * shape is treated as plain text, and malformed attachments are dropped rather than
 * trusted, since the plaintext comes from another user's client.
 */
export function parseEnvelope(plaintext: string): MessageEnvelope {
  try {
    const value = JSON.parse(plaintext) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const raw = value as { text?: unknown; attachments?: unknown };
      return {
        text: typeof raw.text === "string" ? raw.text : "",
        attachments: Array.isArray(raw.attachments) ? raw.attachments.filter(isAttachment) : []
      };
    }
  } catch {
    // Not JSON: a plain-text message from an older client.
  }
  return { text: plaintext, attachments: [] };
}

export async function decryptEnvelope(cipherText: string, nonce: string, secretKey: string): Promise<MessageEnvelope> {
  return parseEnvelope(await decryptMessage(cipherText, nonce, secretKey));
}

/** Plain text used for search and mention detection. */
export function searchableText(envelope: MessageEnvelope) {
  const attachmentText = envelope.attachments
    .map((a) => (a.kind === "gif_link" ? a.title ?? "" : a.name))
    .filter(Boolean)
    .join(" ");
  return [envelope.text.trim(), attachmentText].filter(Boolean).join(" ");
}

/** Only https URLs are rendered or opened from message content. */
export function safeHttpsUrl(input: string | undefined | null) {
  if (!input) return null;
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
