import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import { decryptChunkedBytes, decryptMessage, sha256Base64 } from "../../lib/crypto";
import { useAuthStore } from "../../stores/authStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import { safeHttpsUrl, type GifLinkAttachment, type UploadedAttachment } from "./envelope";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Downloads, integrity-checks and decrypts an attachment into a blob URL that lives
 * only while this component is mounted.
 */
function useDecryptedMedia(conversationId: string, keyVersion: number | undefined, attachment: UploadedAttachment) {
  const secretKey = useE2EEStore((s) => s.getConversationSecretKeyForVersion(conversationId, keyVersion));
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });

  useEffect(() => {
    const token = useAuthStore.getState().token;
    if (!secretKey || !token) return;
    let cancelled = false;
    let url: string | null = null;

    (async () => {
      try {
        const fileKey = await decryptMessage(attachment.fileKeyCiphertext, attachment.fileKeyNonce, secretKey);
        const encrypted = await api.downloadEncryptedMedia(attachment.mediaId, token);
        if (attachment.encryptedSha256 && (await sha256Base64(encrypted)) !== attachment.encryptedSha256) {
          throw new Error("This attachment failed its integrity check and wasn't opened.");
        }
        const plain = await decryptChunkedBytes(encrypted, fileKey);
        url = URL.createObjectURL(new Blob([plain], { type: attachment.mimeType || "application/octet-stream" }));
        if (!cancelled) setState({ url, error: null });
      } catch (err) {
        if (!cancelled) setState({ url: null, error: err instanceof Error ? err.message : "Couldn't open this attachment." });
      }
    })();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [secretKey, attachment.mediaId, attachment.fileKeyCiphertext, attachment.fileKeyNonce, attachment.encryptedSha256, attachment.mimeType]);

  return { ...state, waitingForKey: !secretKey };
}

export function MediaAttachment({
  conversationId,
  keyVersion,
  attachment
}: {
  conversationId: string;
  keyVersion?: number;
  attachment: UploadedAttachment;
}) {
  const { url, error, waitingForKey } = useDecryptedMedia(conversationId, keyVersion, attachment);

  if (error) {
    return <p className="rounded-lg border border-orbit-danger/30 bg-orbit-danger/10 px-3 py-2 text-xs text-rose-300">{error}</p>;
  }

  if (attachment.kind === "image") {
    return url ? (
      <a href={url} download={attachment.name} className="block w-fit overflow-hidden rounded-xl border border-white/10">
        <img src={url} alt={attachment.name} className="max-h-72 max-w-full object-contain" />
      </a>
    ) : (
      <div className="flex h-40 w-56 animate-pulse items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-[11px] text-orbit-muted">
        {waitingForKey ? "Waiting for key…" : "Decrypting image…"}
      </div>
    );
  }

  return (
    <a
      href={url ?? undefined}
      download={attachment.name}
      aria-disabled={!url}
      className="flex w-fit max-w-full items-center gap-3 rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-2 hover:border-white/20 aria-disabled:pointer-events-none aria-disabled:opacity-60"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orbit-accent/15 text-[10px] font-bold uppercase text-orbit-accent">
        {attachment.name.split(".").pop()?.slice(0, 4) || "file"}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{attachment.name}</span>
        <span className="block text-[11px] text-orbit-muted">{url ? formatBytes(attachment.size) || "Download" : "Decrypting…"}</span>
      </span>
    </a>
  );
}

/** GIFs are links to the provider, not encrypted uploads, so only https URLs are shown. */
export function GifAttachment({ attachment }: { attachment: GifLinkAttachment }) {
  const href = safeHttpsUrl(attachment.url);
  const preview = safeHttpsUrl(attachment.previewUrl) ?? href;
  if (!href || !preview) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="block w-fit overflow-hidden rounded-xl border border-white/10">
      <img src={preview} alt={attachment.title || "GIF"} loading="lazy" className="max-h-64 max-w-full object-cover" />
    </a>
  );
}
