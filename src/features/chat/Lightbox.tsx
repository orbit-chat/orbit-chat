import { useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { IconButton, Tooltip } from "../../ui";
import { CloseIcon } from "../../ui/icons";
import { downloadLinkProps, externalLinkProps } from "../../platform";

export type LightboxImage = {
  src: string;
  alt: string;
  /** Offered as the download name; omitted for remote GIFs, which link out instead. */
  downloadName?: string;
  /** For GIFs: the provider page to open externally. */
  externalHref?: string;
};

/**
 * Full-window image viewer. Portalled, focus-trapped and closed with Escape, a click
 * outside the image, or the close button. Click the image to toggle actual size.
 */
export function Lightbox({ image, open, onOpenChange }: { image: LightboxImage; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [actualSize, setActualSize] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setActualSize(false);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-dialog bg-black/85 backdrop-blur-sm data-[state=open]:animate-orbit-fade-in data-[state=closed]:animate-orbit-fade-out" />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          // Focus the viewer, not the first button: a focused tooltip trigger would swallow the first Escape.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
          className="fixed inset-0 z-dialog flex flex-col outline-none data-[state=open]:animate-orbit-fade-in data-[state=closed]:animate-orbit-fade-out"
          onPointerDown={(event) => {
            // A click on the backdrop area (not the image or toolbar) closes it.
            if (event.target === event.currentTarget) onOpenChange(false);
          }}
        >
          <DialogPrimitive.Title className="sr-only">{image.alt || "Image"}</DialogPrimitive.Title>
          <div className="flex shrink-0 items-center justify-end gap-1 p-3">
            <span className="mr-auto truncate px-2 text-sm text-slate-300">{image.alt}</span>
            {image.downloadName && (
              <a
                {...downloadLinkProps(image.downloadName, image.src)}
                className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm font-semibold text-orbit-text hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
              >
                Download
              </a>
            )}
            {image.externalHref && (
              <a
                {...externalLinkProps(image.externalHref)}
                className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm font-semibold text-orbit-text hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
              >
                Open original
              </a>
            )}
            <Tooltip content="Close (Esc)">
              <DialogPrimitive.Close asChild>
                <IconButton label="Close image" variant="secondary">
                  <CloseIcon />
                </IconButton>
              </DialogPrimitive.Close>
            </Tooltip>
          </div>
          <div
            className={actualSize ? "min-h-0 flex-1 overflow-auto p-4" : "flex min-h-0 flex-1 items-center justify-center p-4 pt-0"}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) onOpenChange(false);
            }}
          >
            <img
              src={image.src}
              alt={image.alt}
              onClick={() => setActualSize((v) => !v)}
              className={actualSize ? "m-auto max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in rounded-lg object-contain shadow-2xl"}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
