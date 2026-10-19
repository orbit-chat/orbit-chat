import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Input } from "../../ui";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { safeHttpsUrl, type GifLinkAttachment } from "../chat/envelope";

// Same default as the old client (Giphy's public beta key); set VITE_GIPHY_API_KEY for production.
const GIPHY_API_KEY = (import.meta.env.VITE_GIPHY_API_KEY || "dc6zaTOxFJmzC").trim();
const LIMIT = 18;

type GifResult = { id: string; title: string; url: string; previewUrl: string };

export async function searchGifs(query: string, signal?: AbortSignal): Promise<GifResult[]> {
  const params = new URLSearchParams({ api_key: GIPHY_API_KEY, limit: String(LIMIT), rating: "pg-13" });
  const endpoint = query ? "search" : "trending";
  if (query) params.set("q", query);
  const response = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`, { signal });
  if (!response.ok) throw new Error(`GIF search failed (${response.status}).`);
  const data = (await response.json()) as {
    data?: Array<{ id?: string; title?: string; images?: { original?: { url?: string }; fixed_width_small?: { url?: string } } }>;
  };
  return (data.data ?? []).flatMap((item) => {
    const url = safeHttpsUrl(item.images?.original?.url);
    const previewUrl = safeHttpsUrl(item.images?.fixed_width_small?.url) ?? url;
    return item.id && url && previewUrl ? [{ id: item.id, title: item.title || "GIF", url, previewUrl }] : [];
  });
}

/**
 * Search Giphy and pick one. GIFs are sent as links (fetched from Giphy by whoever views
 * them), not as encrypted uploads, which the picker says up front.
 */
export function GifPicker({ onPick }: { onPick: (gif: GifLinkAttachment) => void }) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 250);
  const results = useQuery({
    queryKey: ["gifs", debounced],
    queryFn: ({ signal }) => searchGifs(debounced, signal),
    staleTime: 60_000
  });

  return (
    <div className="w-[22rem] p-2">
      <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Giphy" aria-label="Search GIFs" className="h-8 text-[13px]" />
      <p className="mt-1.5 px-1 text-[10px] text-orbit-muted">GIFs are sent as Giphy links and aren't end-to-end encrypted.</p>
      {results.isError && (
        <Alert tone="danger" className="mt-2 text-xs">
          {results.error.message}
        </Alert>
      )}
      <div className="mt-2 grid max-h-72 grid-cols-3 gap-1 overflow-y-auto" role="listbox" aria-label="GIF results" aria-busy={results.isFetching}>
        {results.isPending &&
          Array.from({ length: 9 }, (_, i) => <span key={i} className="h-20 animate-pulse rounded-md bg-white/[0.06]" />)}
        {results.data?.map((gif) => (
          <button
            key={gif.id}
            type="button"
            role="option"
            aria-selected={false}
            title={gif.title}
            onClick={() => onPick({ kind: "gif_link", url: gif.url, previewUrl: gif.previewUrl, title: gif.title })}
            className="overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
          >
            <img src={gif.previewUrl} alt={gif.title} loading="lazy" className="h-20 w-full object-cover transition-transform hover:scale-105" />
          </button>
        ))}
      </div>
      {results.data?.length === 0 && <p className="py-6 text-center text-xs text-orbit-muted">No GIFs found.</p>}
    </div>
  );
}
