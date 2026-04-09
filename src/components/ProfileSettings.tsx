import { FormEvent, useEffect, useMemo, useState } from "react";
import type * as api from "../lib/api";
import * as apiCalls from "../lib/api";
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
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-orbit-text">Profile Settings</h2>
          <p className="mt-1 text-sm text-orbit-muted">Update your profile card, status, and links.</p>
        </div>
        <button className="orbit-btn" onClick={onClose}>
          Back
        </button>
      </div>

      {error && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}

      <div className="orbit-card-solid mt-6 overflow-hidden rounded-3xl">
        <div className="relative h-36 bg-gradient-to-r from-orbit-accent/30 to-orbit-danger/25" style={bannerStyle}>
          <div className="absolute inset-0 bg-black/35" />
          <div className="absolute right-4 top-4">
            <label className="cursor-pointer rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-semibold text-orbit-text transition hover:border-white/20">
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
                <span className="orbit-label">Display name</span>
                <input
                  className="orbit-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Optional"
                />
              </label>

              <label className="block">
                <span className="orbit-label">Pronouns</span>
                <input
                  className="orbit-input"
                  value={pronouns}
                  onChange={(e) => setPronouns(e.target.value)}
                  placeholder="e.g. she/her"
                />
              </label>
            </div>

            <label className="block">
              <span className="orbit-label">Bio</span>
              <textarea
                className="orbit-textarea"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A short description about you…"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="orbit-label">Presence</span>
                <select
                  className="orbit-select"
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
                <span className="orbit-label">Timezone</span>
                <input
                  className="orbit-input"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="e.g. America/New_York"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="orbit-label">Status text</span>
                <input
                  className="orbit-input"
                  value={statusText}
                  onChange={(e) => setStatusText(e.target.value)}
                  placeholder="What’s up?"
                />
              </label>

              <label className="block">
                <span className="orbit-label">Status emoji</span>
                <input
                  className="orbit-input"
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
                  className="orbit-btn px-3 py-2 text-xs"
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
                      className="orbit-input bg-orbit-panel"
                      value={l.label}
                      onChange={(e) =>
                        setLinks((prev) => prev.map((row, i) => (i === idx ? { ...row, label: e.target.value } : row)))
                      }
                      placeholder="Label"
                    />
                    <input
                      className="orbit-input bg-orbit-panel"
                      value={l.url}
                      onChange={(e) =>
                        setLinks((prev) => prev.map((row, i) => (i === idx ? { ...row, url: e.target.value } : row)))
                      }
                      placeholder="https://…"
                    />
                    <button
                      type="button"
                      className="orbit-btn px-3 py-3 text-sm"
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
              <button type="button" className="orbit-btn px-4 py-3" onClick={onClose}>
                Cancel
              </button>
              <button
                disabled={loading}
                className="orbit-btn-primary px-5 py-3"
              >
                {loading ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ───── Recovery Codes Section ───── */}
      <RecoveryCodesSection token={token} />
    </div>
  );
}

/* ────────────────────────────────────────────────────── */
/*  Recovery Codes Management                              */
/* ────────────────────────────────────────────────────── */
function RecoveryCodesSection({ token }: { token: string }) {
  const [status, setStatus] = useState<api.RecoveryCodeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [codesInput, setCodesInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMode, setActionMode] = useState<"idle" | "disable" | "refresh">("idle");

  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const [confirmDisable, setConfirmDisable] = useState(false);

  const fetchStatus = async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await apiCalls.getRecoveryCodeStatus(token);
      setStatus(s);
    } catch (err: any) {
      setStatusError(err?.message ?? "Failed to load recovery code status");
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [token]);

  const parseCodes = (): string[] => {
    return codesInput
      .split(/[\n,]+/)
      .map((c) => c.trim())
      .filter(Boolean);
  };

  const handleDisable = async () => {
    setActionError(null);
    setActionLoading(true);
    try {
      const codes = parseCodes();
      await apiCalls.disableRecoveryCodes(codes, token);
      setCodesInput("");
      setActionMode("idle");
      setConfirmDisable(false);
      await fetchStatus();
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to disable recovery codes");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRefresh = async () => {
    setActionError(null);
    setActionLoading(true);
    try {
      const codes = parseCodes();
      const result = await apiCalls.refreshRecoveryCodes(codes, token);
      setNewCodes(result.recoveryCodes);
      setCodesInput("");
      setActionMode("idle");
      await fetchStatus();
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to refresh recovery codes");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="orbit-card-solid mt-6 overflow-hidden rounded-3xl">
      <div className="px-6 py-6">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-orbit-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h3 className="text-lg font-bold text-orbit-text">Recovery Codes</h3>
        </div>
        <p className="mt-1 text-sm text-orbit-muted">
          Recovery codes let you log in if you lose your password. Each code is single-use.
        </p>

        {statusError && (
          <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {statusError}
          </div>
        )}

        {statusLoading && !status && (
          <p className="mt-3 text-sm text-orbit-muted">Loading…</p>
        )}

        {status && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-4">
              <div className="rounded-xl border border-white/10 bg-orbit-panelAlt px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</p>
                <p className={`mt-1 text-sm font-semibold ${status.active ? "text-emerald-400" : "text-rose-400"}`}>
                  {status.active ? "Active" : "Permanently Disabled"}
                </p>
              </div>
              {status.active && (
                <div className="rounded-xl border border-white/10 bg-orbit-panelAlt px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Remaining</p>
                  <p className="mt-1 text-sm font-semibold text-orbit-text">
                    {status.remaining} / {status.total}
                  </p>
                </div>
              )}
            </div>

            {!status.active && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                Recovery codes have been permanently disabled. This cannot be undone. If you forget your password, you will not be able to recover this account.
              </div>
            )}

            {/* New codes display after refresh */}
            {newCodes && (
              <div className="rounded-xl border border-orbit-accent/30 bg-orbit-accent/10 p-4">
                <p className="mb-2 text-sm font-semibold text-orbit-accent">New Recovery Codes Generated</p>
                <p className="mb-3 text-xs text-orbit-muted">Save these now — you won't see them again.</p>
                <div className="grid grid-cols-2 gap-2">
                  {newCodes.map((code, idx) => (
                    <div key={idx} className="rounded-lg border border-white/10 bg-orbit-panel px-3 py-2 text-center font-mono text-sm tracking-wider text-orbit-text">
                      {code}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="orbit-btn flex-1 text-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(newCodes.join("\n"));
                    }}
                  >
                    Copy to Clipboard
                  </button>
                  <button
                    className="orbit-btn-primary flex-1 text-xs"
                    onClick={() => setNewCodes(null)}
                  >
                    I've saved them
                  </button>
                </div>
              </div>
            )}

            {status.active && actionMode === "idle" && (
              <div className="flex gap-3">
                <button
                  className="orbit-btn px-4 py-2 text-sm"
                  onClick={() => {
                    setActionMode("refresh");
                    setActionError(null);
                    setCodesInput("");
                  }}
                >
                  Refresh Codes
                </button>
                <button
                  className="orbit-btn-danger px-4 py-2 text-sm"
                  onClick={() => {
                    setActionMode("disable");
                    setActionError(null);
                    setCodesInput("");
                    setConfirmDisable(false);
                  }}
                >
                  Disable Permanently
                </button>
              </div>
            )}

            {status.active && actionMode !== "idle" && (
              <div className="rounded-xl border border-white/10 bg-orbit-panelAlt p-4">
                <p className="mb-1 text-sm font-semibold text-orbit-text">
                  {actionMode === "disable"
                    ? "Disable Recovery Codes"
                    : "Refresh Recovery Codes"}
                </p>
                <p className="mb-3 text-xs text-orbit-muted">
                  {actionMode === "disable"
                    ? "This action is PERMANENT and cannot be undone. You must provide all your active recovery codes to confirm."
                    : "Provide all your active recovery codes to generate a new set."}
                </p>

                {actionError && (
                  <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {actionError}
                  </div>
                )}

                <label className="block">
                  <span className="orbit-label">
                    Paste all {status.remaining} active recovery codes (one per line or comma-separated)
                  </span>
                  <textarea
                    className="orbit-textarea min-h-[120px] font-mono text-sm tracking-wider"
                    value={codesInput}
                    onChange={(e) => setCodesInput(e.target.value)}
                    placeholder={"xxxx-xxxx\nxxxx-xxxx\n..."}
                  />
                </label>

                {actionMode === "disable" && !confirmDisable && (
                  <div className="mt-3 flex gap-3">
                    <button
                      className="orbit-btn px-4 py-2 text-sm"
                      onClick={() => setActionMode("idle")}
                    >
                      Cancel
                    </button>
                    <button
                      className="orbit-btn-danger px-4 py-2 text-sm"
                      onClick={() => setConfirmDisable(true)}
                      disabled={parseCodes().length === 0}
                    >
                      Continue
                    </button>
                  </div>
                )}

                {actionMode === "disable" && confirmDisable && (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      <strong>Final confirmation:</strong> You will permanently lose the ability to recover your account. This cannot be reversed.
                    </div>
                    <div className="flex gap-3">
                      <button
                        className="orbit-btn px-4 py-2 text-sm"
                        onClick={() => {
                          setActionMode("idle");
                          setConfirmDisable(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="orbit-btn-danger px-4 py-2 text-sm"
                        disabled={actionLoading}
                        onClick={handleDisable}
                      >
                        {actionLoading ? "Disabling…" : "Permanently Disable"}
                      </button>
                    </div>
                  </div>
                )}

                {actionMode === "refresh" && (
                  <div className="mt-3 flex gap-3">
                    <button
                      className="orbit-btn px-4 py-2 text-sm"
                      onClick={() => setActionMode("idle")}
                    >
                      Cancel
                    </button>
                    <button
                      className="orbit-btn-primary px-4 py-2 text-sm"
                      disabled={actionLoading || parseCodes().length === 0}
                      onClick={handleRefresh}
                    >
                      {actionLoading ? "Generating…" : "Generate New Codes"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
