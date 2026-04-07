import { useEffect, useMemo, useRef } from "react";
import type * as api from "../lib/api";

export type UserProfilePopoverProps = {
  profile: api.UserProfile | null;
  open: boolean;
  anchorRect: DOMRect | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  canEdit?: boolean;
  onEditClick?: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatJoined(createdAt?: string) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatLastActive(lastActiveAt?: string | null) {
  if (!lastActiveAt) return null;
  const d = new Date(lastActiveAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function initials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || trimmed[0]!.toUpperCase();
}

function presenceLabel(p?: api.Presence | null) {
  switch (p) {
    case "online":
      return "Online";
    case "idle":
      return "Idle";
    case "dnd":
      return "Do Not Disturb";
    case "offline":
      return "Offline";
    default:
      return null;
  }
}

function presenceDotClass(p?: api.Presence | null) {
  switch (p) {
    case "online":
      return "bg-emerald-400";
    case "idle":
      return "bg-amber-400";
    case "dnd":
      return "bg-rose-400";
    case "offline":
      return "bg-slate-500";
    default:
      return "bg-slate-500";
  }
}

export function UserProfilePopover({
  profile,
  open,
  anchorRect,
  loading,
  error,
  onClose,
  canEdit,
  onEditClick,
}: UserProfilePopoverProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const onMouseDown = (e: MouseEvent) => {
      const el = cardRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, onClose]);

  const style = useMemo(() => {
    if (!open || !anchorRect) return { display: "none" } as const;

    const width = 360;
    const height = 460;
    const margin = 12;

    const preferredLeft = anchorRect.left;
    const preferredTop = anchorRect.bottom + 10;

    const left = clamp(preferredLeft, margin, window.innerWidth - width - margin);
    const top = clamp(preferredTop, margin, window.innerHeight - height - margin);

    return {
      position: "fixed" as const,
      left,
      top,
      width,
      maxWidth: `calc(100vw - ${margin * 2}px)`,
      zIndex: 60,
    };
  }, [open, anchorRect]);

  if (!open) return null;

  const name = profile?.displayName?.trim() || profile?.username || "User";
  const handleEdit = () => {
    onClose();
    onEditClick?.();
  };

  return (
    <div ref={cardRef} style={style} className="overflow-hidden rounded-2xl border border-white/10 bg-orbit-panel shadow-2xl">
      {/* Banner */}
      <div
        className="relative h-24 bg-gradient-to-r from-orbit-accent/30 to-orbit-danger/25"
        style={
          profile?.bannerUrl
            ? {
                backgroundImage: `url(${profile.bannerUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        <div className="absolute inset-0 bg-black/35" />
      </div>

      {/* Avatar + basics */}
      <div className="relative px-4 pb-4">
        <div className="-mt-10 flex items-end justify-between gap-3">
          <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-white/10 bg-orbit-panelAlt">
            {profile?.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-bold text-orbit-text">
                {initials(name)}
              </div>
            )}
            <div className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-orbit-panel ${presenceDotClass(profile?.presence)}`} />
          </div>

          {canEdit && (
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-orbit-text hover:border-white/20"
              onClick={handleEdit}
            >
              Edit profile
            </button>
          )}
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-orbit-text">{name}</h3>
            {profile?.statusEmoji && <span className="text-sm">{profile.statusEmoji}</span>}
          </div>
          <p className="text-xs text-orbit-muted">@{profile?.username ?? "unknown"}</p>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">
            {presenceLabel(profile?.presence) && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{presenceLabel(profile?.presence)}</span>
            )}
            {profile?.statusText && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{profile.statusText}</span>
            )}
          </div>

          {profile?.bio && <p className="mt-3 text-sm text-slate-200">{profile.bio}</p>}

          <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-orbit-panelAlt p-3 text-xs text-slate-300">
            {formatJoined(profile?.createdAt) && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Joined Orbit Chat</span>
                <span className="text-slate-200">{formatJoined(profile?.createdAt)}</span>
              </div>
            )}

            {profile?.pronouns && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Pronouns</span>
                <span className="text-slate-200">{profile.pronouns}</span>
              </div>
            )}

            {profile?.timezone && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Timezone</span>
                <span className="text-slate-200">{profile.timezone}</span>
              </div>
            )}

            {formatLastActive(profile?.lastActiveAt) && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Last active</span>
                <span className="text-slate-200">{formatLastActive(profile?.lastActiveAt)}</span>
              </div>
            )}
          </div>

          {/* Roles */}
          {profile?.roles && profile.roles.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Roles</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {profile.roles.map((r) => (
                  <span key={r.id} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200">
                    {r.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Links */}
          {profile?.links && profile.links.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Links</p>
              <div className="mt-2 space-y-2">
                {profile.links.map((l, idx) => (
                  <a
                    key={`${l.url}-${idx}`}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-2 text-xs text-orbit-accent hover:border-white/20"
                  >
                    <span className="mr-2 text-slate-200">{l.label || "Link"}</span>
                    <span className="text-slate-400">{l.url}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {(loading || error) && (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
              {loading && <span>Loading profile…</span>}
              {!loading && error && <span className="text-rose-300">{error}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
