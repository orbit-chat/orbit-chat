import { z } from "zod";
import type { Presence, UpdateMyProfileInput, UserProfile } from "../../lib/api";

/** Mirrors the server's UpdateMyProfileDto limits so errors show before saving. */
export const PROFILE_LIMITS = { displayName: 64, bio: 280, pronouns: 32, timezone: 64, statusText: 80, statusEmoji: 16, linkLabel: 48, linkUrl: 512, links: 5 } as const;

export const PRESENCE_OPTIONS: Array<{ value: Presence; label: string; description: string }> = [
  { value: "online", label: "Online", description: "Shown as available." },
  { value: "idle", label: "Idle", description: "Shown as away." },
  { value: "dnd", label: "Do not disturb", description: "Shown as busy." },
  { value: "offline", label: "Invisible", description: "Shown as offline while you use Orbit." }
];

const optionalText = (max: number, label: string) => z.string().trim().max(max, `${label} can be at most ${max} characters.`);

export const profileSchema = z.object({
  displayName: optionalText(PROFILE_LIMITS.displayName, "Display name"),
  pronouns: optionalText(PROFILE_LIMITS.pronouns, "Pronouns"),
  bio: optionalText(PROFILE_LIMITS.bio, "Bio"),
  statusEmoji: optionalText(PROFILE_LIMITS.statusEmoji, "Status emoji"),
  statusText: optionalText(PROFILE_LIMITS.statusText, "Status"),
  presence: z.enum(["online", "idle", "dnd", "offline"]),
  timezone: optionalText(PROFILE_LIMITS.timezone, "Time zone"),
  links: z
    .array(
      z.object({
        label: optionalText(PROFILE_LIMITS.linkLabel, "Link label"),
        url: z
          .string()
          .trim()
          .max(PROFILE_LIMITS.linkUrl, `Links can be at most ${PROFILE_LIMITS.linkUrl} characters.`)
          .refine((value) => {
            if (!value) return true;
            try {
              return new URL(value).protocol === "https:";
            } catch {
              return false;
            }
          }, "Links must start with https://")
      })
    )
    .max(PROFILE_LIMITS.links, `Up to ${PROFILE_LIMITS.links} links.`)
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

export function profileToForm(profile: UserProfile | undefined): ProfileFormValues {
  return {
    displayName: profile?.displayName ?? "",
    pronouns: profile?.pronouns ?? "",
    bio: profile?.bio ?? "",
    statusEmoji: profile?.statusEmoji ?? "",
    statusText: profile?.statusText ?? "",
    presence: profile?.presence ?? "online",
    timezone: profile?.timezone ?? "",
    links: (profile?.links ?? []).map((l) => ({ label: l.label ?? "", url: l.url ?? "" }))
  };
}

/** Form values → API payload: blanks become null, empty link rows are dropped. */
export function formToUpdate(values: ProfileFormValues): UpdateMyProfileInput {
  const orNull = (v: string) => (v.trim() ? v.trim() : null);
  const links = values.links.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() }));
  return {
    displayName: orNull(values.displayName),
    pronouns: orNull(values.pronouns),
    bio: orNull(values.bio),
    statusEmoji: orNull(values.statusEmoji),
    statusText: orNull(values.statusText),
    presence: values.presence,
    timezone: orNull(values.timezone),
    links: links.length ? links : null
  };
}

/** Current time in a time zone, or null if the zone isn't valid. */
export function localTimeIn(timezone: string | null | undefined, now = new Date()) {
  if (!timezone) return null;
  try {
    return now.toLocaleTimeString(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}
