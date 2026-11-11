import type { ReactNode } from "react";
import { Avatar, Badge, cn, type Presence } from "../../ui";
import type { UserProfile } from "../../lib/api";
import { safeHttpsUrl } from "../chat/envelope";
import { PRESENCE_OPTIONS, localTimeIn } from "./profileSchema";
import { externalLinkProps } from "../../platform";

function formatDate(value?: string | null, withTime = false) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return withTime ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * A person's profile: banner, avatar, names, status, bio and details. Used in the
 * popover, the friends page and as the live preview while editing your own.
 */
export function ProfileCard({
  profile,
  username,
  actions,
  className,
  compact = false
}: {
  profile: Partial<UserProfile> | undefined;
  username: string;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const name = profile?.displayName?.trim() || username;
  const presence = (profile?.presence ?? undefined) as Presence | undefined;
  const presenceLabel = PRESENCE_OPTIONS.find((p) => p.value === presence)?.label;
  // Banners are uploaded through our server (not typed in by users), so http(s) and local previews are fine.
  const banner = profile?.bannerUrl && /^(https?:|blob:)/.test(profile.bannerUrl) ? profile.bannerUrl.replace(/"/g, "%22") : null;
  const localTime = localTimeIn(profile?.timezone);
  const links = (profile?.links ?? []).flatMap((l) => {
    const href = safeHttpsUrl(l.url);
    return href ? [{ label: l.label?.trim() || new URL(href).hostname, href }] : [];
  });

  return (
    <article className={cn("overflow-hidden rounded-2xl border border-white/10 bg-orbit-overlay", className)} aria-label={`Profile of ${name}`}>
      <div
        className={cn("bg-gradient-to-br from-orbit-accent/40 via-orbit-accent/10 to-orbit-panelAlt bg-cover bg-center", compact ? "h-16" : "h-24")}
        style={banner ? { backgroundImage: `url("${banner}")` } : undefined}
      />
      <div className="px-4 pb-4">
        <div className="-mt-9 flex items-end justify-between gap-2">
          <span className="rounded-full ring-4 ring-orbit-overlay">
            <Avatar name={name} src={profile?.avatarUrl} size="xl" presence={presence} />
          </span>
          {actions && <div className="flex gap-1.5 pb-1">{actions}</div>}
        </div>
        <h2 className="mt-2 text-lg font-bold leading-tight">{name}</h2>
        <p className="text-xs text-orbit-muted">
          @{username}
          {profile?.pronouns && <span> · {profile.pronouns}</span>}
        </p>
        {(profile?.statusEmoji || profile?.statusText || presenceLabel) && (
          <p className="mt-2 text-sm">
            {profile?.statusEmoji && <span className="mr-1">{profile.statusEmoji}</span>}
            {profile?.statusText || <span className="text-orbit-muted">{presenceLabel}</span>}
          </p>
        )}
        {profile?.roles && profile.roles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {profile.roles.map((role) => (
              <Badge key={role.id} tone="accent">
                {role.name}
              </Badge>
            ))}
          </div>
        )}
        {profile?.bio && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-300">{profile.bio}</p>}

        {!compact && (
          <dl className="mt-3 space-y-1 text-xs">
            {localTime && <Detail label="Local time">{`${localTime} (${profile?.timezone})`}</Detail>}
            {formatDate(profile?.createdAt) && <Detail label="Joined">{formatDate(profile?.createdAt)}</Detail>}
            {presence === "offline" && formatDate(profile?.lastActiveAt, true) && <Detail label="Last active">{formatDate(profile?.lastActiveAt, true)}</Detail>}
          </dl>
        )}

        {links.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Links">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  {...externalLinkProps(link.href)}
                  className="inline-flex max-w-[14rem] items-center truncate rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-sky-300 hover:border-white/20"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-orbit-muted">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}
