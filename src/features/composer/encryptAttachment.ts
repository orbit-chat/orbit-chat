import * as api from "../../lib/api";
import { encryptChunkedBytes, encryptMessage, generateSecretKey, sha256Base64 } from "../../lib/crypto";
import type { UploadedAttachment } from "../chat/envelope";

/** Server limit on the encrypted upload. Chunk overhead is small, so plaintext is checked against the same number. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Why a file can't be attached, or null if it can. */
export function rejectReason(file: File): string | null {
  if (file.type.startsWith("video/")) return `${file.name}: videos can't be uploaded. Send a link instead.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is over the 50 MB limit.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/**
 * Encrypts a file with its own random key, uploads only ciphertext, and returns the
 * attachment record. The file key is wrapped with the conversation key, so only
 * members can open it; the server stores bytes it can't read.
 */
export async function encryptAndUpload(params: {
  file: File;
  conversationId: string;
  conversationKey: string;
  token: string;
}): Promise<UploadedAttachment> {
  const { file, conversationId, conversationKey, token } = params;
  const plain = new Uint8Array(await file.arrayBuffer());
  const fileKey = await generateSecretKey();
  const chunkSize = file.size > 10 * 1024 * 1024 ? 512 * 1024 : 256 * 1024;
  const encrypted = await encryptChunkedBytes(plain, fileKey, chunkSize);
  if (encrypted.encryptedBytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is over the 50 MB limit once encrypted.`);
  const encryptedSha256 = await sha256Base64(encrypted.encryptedBytes);
  const mimeType = file.type || "application/octet-stream";

  const reservation = await api.requestMediaUploadUrl(
    { conversationId, fileName: file.name, contentType: mimeType, contentLength: encrypted.encryptedBytes.length, sha256: encryptedSha256 },
    token
  );
  await api.uploadEncryptedBlob(reservation.uploadUrl, new Blob([new Uint8Array(encrypted.encryptedBytes)], { type: "application/octet-stream" }));

  const wrapped = await encryptMessage(fileKey, conversationKey);
  return {
    kind: mimeType.startsWith("image/") ? "image" : "file",
    mediaId: reservation.mediaId,
    name: file.name,
    mimeType,
    size: file.size,
    fileKeyCiphertext: wrapped.cipherText,
    fileKeyNonce: wrapped.nonce,
    chunkSize: encrypted.chunkSize,
    chunkCount: encrypted.chunkCount,
    encryptedSha256
  };
}
