import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Field, IconButton, Input, Textarea, cn } from "../../ui";
import { CloseIcon } from "../../ui/icons";
import { useAuthStore } from "../../stores/authStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { ProfileCard } from "../profile/ProfileCard";
import { PRESENCE_OPTIONS, PROFILE_LIMITS, formToUpdate, profileSchema, profileToForm, type ProfileFormValues } from "../profile/profileSchema";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

/** Edit your profile with a live preview of how others will see it. */
export function ProfileSection() {
  const me = useAuthStore((s) => s.user)!;
  const profile = useProfilesStore((s) => s.byId[me.id]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(timeZones, []);

  const form = useForm<ProfileFormValues>({ resolver: zodResolver(profileSchema), defaultValues: profileToForm(profile) });
  const links = useFieldArray({ control: form.control, name: "links" });
  const { errors, isDirty, isSubmitting } = form.formState;
  const values = form.watch();

  // When the profile first arrives (or changes elsewhere) and nothing is being edited, show it.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(profileToForm(profile));
  }, [profile, form]);

  const submit = form.handleSubmit(async (formValues) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    setError(null);
    setSaved(false);
    const updated = await useProfilesStore.getState().updateMyProfile(formToUpdate(formValues), token, me.id);
    if (!updated) {
      setError(useProfilesStore.getState().errorById[me.id] ?? "Couldn't save your profile.");
      return;
    }
    form.reset(profileToForm(updated));
    setSaved(true);
  });

  const count = (field: keyof typeof PROFILE_LIMITS, value: string) => (
    <span className={cn("text-[10px]", value.length > PROFILE_LIMITS[field] ? "text-orbit-danger" : "text-orbit-muted")}>
      {value.length}/{PROFILE_LIMITS[field]}
    </span>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
      <form onSubmit={submit} noValidate className="space-y-5">
        <header>
          <h1 className="text-xl font-bold">Profile</h1>
          <p className="mt-1 text-sm text-orbit-muted">How you appear to people you chat with.</p>
        </header>

        <ImageUploads />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" error={errors.displayName?.message} hint={count("displayName", values.displayName)}>
            {(field) => <Input {...field} {...form.register("displayName")} placeholder={me.username} />}
          </Field>
          <Field label="Pronouns" error={errors.pronouns?.message}>
            {(field) => <Input {...field} {...form.register("pronouns")} placeholder="they/them" />}
          </Field>
        </div>

        <Field label="Bio" error={errors.bio?.message} hint={count("bio", values.bio)}>
          {(field) => <Textarea {...field} {...form.register("bio")} rows={3} placeholder="A line or two about you" />}
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Status</p>
          <div className="grid grid-cols-[4.5rem_1fr] gap-2">
            <Input {...form.register("statusEmoji")} aria-label="Status emoji" placeholder="🙂" className="text-center" aria-invalid={errors.statusEmoji ? true : undefined} />
            <Input {...form.register("statusText")} aria-label="Status text" placeholder="What are you up to?" aria-invalid={errors.statusText ? true : undefined} />
          </div>
          {(errors.statusEmoji || errors.statusText) && (
            <p role="alert" className="mt-1 text-[11px] text-orbit-danger">
              {errors.statusEmoji?.message ?? errors.statusText?.message}
            </p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Presence</p>
          <div role="radiogroup" aria-label="Presence" className="grid gap-2 sm:grid-cols-4">
            {PRESENCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={values.presence === option.value}
                onClick={() => form.setValue("presence", option.value, { shouldDirty: true })}
                className={cn(
                  "rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
                  values.presence === option.value ? "border-orbit-accent/60 bg-orbit-accent/10" : "border-white/10 hover:border-white/20"
                )}
              >
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="block text-[10px] text-orbit-muted">{option.description}</span>
              </button>
            ))}
          </div>
        </div>

        <Field label="Time zone" error={errors.timezone?.message} hint="Lets people see your local time.">
          {(field) => (
            <div className="flex gap-2">
              <Input {...field} {...form.register("timezone")} list="orbit-timezones" placeholder="e.g. America/Chicago" />
              <datalist id="orbit-timezones">
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <Button
                size="md"
                onClick={() => form.setValue("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone, { shouldDirty: true, shouldValidate: true })}
              >
                Use mine
              </Button>
            </div>
          )}
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Links</p>
          <ul className="space-y-2" aria-label="Profile links">
            {links.fields.map((row, i) => (
              <li key={row.id}>
                <div className="grid grid-cols-[9rem_1fr_auto] gap-2">
                  <Input {...form.register(`links.${i}.label`)} aria-label={`Link ${i + 1} label`} placeholder="Label" />
                  <Input
                    {...form.register(`links.${i}.url`)}
                    aria-label={`Link ${i + 1} URL`}
                    placeholder="https://"
                    aria-invalid={errors.links?.[i]?.url ? true : undefined}
                  />
                  <IconButton label={`Remove link ${i + 1}`} onClick={() => links.remove(i)}>
                    <CloseIcon />
                  </IconButton>
                </div>
                {(errors.links?.[i]?.url || errors.links?.[i]?.label) && (
                  <p role="alert" className="mt-1 text-[11px] text-orbit-danger">
                    {errors.links?.[i]?.url?.message ?? errors.links?.[i]?.label?.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {links.fields.length < PROFILE_LIMITS.links && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => links.append({ label: "", url: "" })}>
              + Add link
            </Button>
          )}
        </div>

        {error && <Alert tone="danger">{error}</Alert>}
        {saved && !isDirty && <Alert tone="info">Profile saved.</Alert>}

        <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 bg-orbit-canvas/95 px-1 py-3 backdrop-blur-none">
          <Button variant="ghost" disabled={!isDirty || isSubmitting} onClick={() => form.reset(profileToForm(profile))}>
            Reset
          </Button>
          <Button type="submit" variant="primary" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>

      <aside aria-label="Preview" className="lg:sticky lg:top-10 lg:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p>
        <ProfileCard profile={{ ...profile, ...formToUpdate(values), presence: values.presence }} username={me.username} />
      </aside>
    </div>
  );
}

/** Avatar and banner uploads take effect immediately (they aren't part of Save). */
function ImageUploads() {
  const me = useAuthStore((s) => s.user)!;
  const [busy, setBusy] = useState<"avatar" | "banner" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const upload = async (kind: "avatar" | "banner", file: File | undefined) => {
    const token = useAuthStore.getState().token;
    if (!file || !token) return;
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    if (file.size > MAX_IMAGE_BYTES) return setError("Images can be up to 8 MB.");
    setBusy(kind);
    setError(null);
    const store = useProfilesStore.getState();
    const updated = kind === "avatar" ? await store.uploadMyAvatar(file, token, me.id) : await store.uploadMyBanner(file, token, me.id);
    if (!updated) setError(useProfilesStore.getState().errorById[me.id] ?? "Upload failed.");
    setBusy(null);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy !== null} onClick={() => avatarInput.current?.click()}>
          {busy === "avatar" ? "Uploading…" : "Change avatar"}
        </Button>
        <Button size="sm" disabled={busy !== null} onClick={() => bannerInput.current?.click()}>
          {busy === "banner" ? "Uploading…" : "Change banner"}
        </Button>
        <input ref={avatarInput} type="file" accept="image/*" hidden aria-label="Avatar image" onChange={(e) => void upload("avatar", e.target.files?.[0]).finally(() => (e.target.value = ""))} />
        <input ref={bannerInput} type="file" accept="image/*" hidden aria-label="Banner image" onChange={(e) => void upload("banner", e.target.files?.[0]).finally(() => (e.target.value = ""))} />
      </div>
      <p className="mt-1 text-[11px] text-orbit-muted">Avatars and banners are public to people who can see your profile, and aren't end-to-end encrypted.</p>
      {error && (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      )}
    </div>
  );
}
