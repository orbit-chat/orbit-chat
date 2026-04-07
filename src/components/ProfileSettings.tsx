import { FormEvent, useEffect, useMemo, useState } from "react";
import type * as api from "../lib/api";
import { useProfilesStore } from "../stores/profilesStore";

type Props = {
  token: string;
  myUserId: string;
  onClose: () => void;
};

type LinkRow = { label: string; url: string };

function safeLinks(links?: api.ProfileLink[] | null): LinkRow[] {
  if (!links) return [];
  return links
    .filter((l) => Boolean(l?.url))
    .map((l) => ({ label: l.label ?? "", url: l.url ?? "" }));
}

export function ProfileSettings({ token, myUserId, onClose }: Props) {
  const { byId, loadingById, errorById, fetchMe, updateMyProfile, uploadMyAvatar, uploadMyBanner } = useProfilesStore();

  const profile = byId[myUserId] ?? null;
  const loading = loadingById[myUserId] ?? false;
  const error = errorById[myUserId] ?? null;

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [timezone, setTimezone] = useState("");
  const [presence, setPresence] = useState<api.Presence>("online");
  const [statusText, setStatusText] = useState("");
  const [statusEmoji, setStatusEmoji] = useState("");
  const [links, setLinks] = useState<LinkRow[]>([]);

  useEffect(() => {
    fetchMe(token, myUserId);
  }, [fetchMe, token, myUserId]);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName ?? "");
    setBio(profile.bio ?? "");
    setPronouns(profile.pronouns ?? "");
    setTimezone(profile.timezone ?? "");
    setPresence((profile.presence as api.Presence) ?? "online");
    setStatusText(profile.statusText ?? "");
    setStatusEmoji(profile.statusEmoji ?? "");
    setLinks(safeLinks(profile.links));
  }, [profile?.id]);

  const bannerStyle = useMemo(() => {
    if (profile?.bannerUrl) {
      return {
        backgroundImage: `url(${profile.bannerUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      } as const;
    }
    return undefined;
  }, [profile?.bannerUrl]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const cleanedLinks = links
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.url.length > 0);

    await updateMyProfile(
      {
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
        pronouns: pronouns.trim() || null,
        timezone: timezone.trim() || null,
        presence,
        statusText: statusText.trim() || null,
        statusEmoji: statusEmoji.trim() || null,
        links: cleanedLinks.length ? cleanedLinks : null,
      },
      token,
      myUserId
    );
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-orbit-text">Profile Settings</h2>
          <p className="mt-1 text-sm text-orbit-muted">Update your profile card, status, and links.</p>
        </div>
        <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:border-white/20" onClick={onClose}>
          Back
        </button>
      </div>

      {error && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}

      <div className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-orbit-panel">
        <div className="relative h-36 bg-gradient-to-r from-orbit-accent/30 to-orbit-danger/25" style={bannerStyle}>
          <div className="absolute inset-0 bg-black/35" />
          <div className="absolute right-4 top-4">
            <label className="cursor-pointer rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-semibold text-orbit-text hover:border-white/20">
              Change banner
              <input
                className="hidden"
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await uploadMyBanner(file, token, myUserId);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        <div className="relative px-6 pb-6">
          <div className="-mt-10 flex items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="h-24 w-24 overflow-hidden rounded-2xl border border-white/10 bg-orbit-panelAlt">
                {profile?.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-lg font-bold">{profile?.username?.[0]?.toUpperCase() ?? "?"}</div>
                )}
              </div>
              <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-orbit-text hover:border-white/20">
                Change avatar
                <input
                  className="hidden"
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    await uploadMyAvatar(file, token, myUserId);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            <div className="text-right">
              <p className="text-sm font-semibold text-orbit-text">@{profile?.username ?? "me"}</p>
              <p className="text-xs text-orbit-muted">This is the username others DM.</p>
            </div>
          </div>

          <form className="mt-6 grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Display name</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Optional"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Pronouns</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                  value={pronouns}
                  onChange={(e) => setPronouns(e.target.value)}
                  placeholder="e.g. she/her"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Bio</span>
              <textarea
                className="min-h-[92px] w-full resize-y rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A short description about you…"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Presence</span>
                <select
                  className="w-full rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                  value={presence}
                  onChange={(e) => setPresence(e.target.value as api.Presence)}
                >
                  <option value="online">Online</option>
                  <option value="idle">Idle</option>
                  <option value="dnd">Do Not Disturb</option>
                  <option value="offline">Offline</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Timezone</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="e.g. America/New_York"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Status text</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                  value={statusText}
                  onChange={(e) => setStatusText(e.target.value)}
                  placeholder="What’s up?"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Status emoji</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                  value={statusEmoji}
                  onChange={(e) => setStatusEmoji(e.target.value)}
                  placeholder="e.g. 🙂"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-white/10 bg-orbit-panelAlt p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Links</p>
                <button
                  type="button"
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:border-white/20"
                  onClick={() => setLinks((prev) => [...prev, { label: "", url: "" }])}
                >
                  Add link
                </button>
              </div>

              <div className="mt-3 grid gap-3">
                {links.length === 0 && <p className="text-xs text-slate-400">No links yet.</p>}
                {links.map((l, idx) => (
                  <div key={idx} className="grid gap-3 md:grid-cols-[1fr_1.6fr_auto]">
                    <input
                      className="w-full rounded-xl border border-white/10 bg-orbit-panel px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                      value={l.label}
                      onChange={(e) =>
                        setLinks((prev) => prev.map((row, i) => (i === idx ? { ...row, label: e.target.value } : row)))
                      }
                      placeholder="Label"
                    />
                    <input
                      className="w-full rounded-xl border border-white/10 bg-orbit-panel px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                      value={l.url}
                      onChange={(e) =>
                        setLinks((prev) => prev.map((row, i) => (i === idx ? { ...row, url: e.target.value } : row)))
                      }
                      placeholder="https://…"
                    />
                    <button
                      type="button"
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm hover:border-white/20"
                      onClick={() => setLinks((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="Remove link"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button type="button" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm hover:border-white/20" onClick={onClose}>
                Cancel
              </button>
              <button
                disabled={loading}
                className="rounded-xl bg-orbit-accent px-5 py-3 text-sm font-bold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
              >
                {loading ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
