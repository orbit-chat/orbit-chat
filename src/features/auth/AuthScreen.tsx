import { useEffect, useState, type ReactNode } from "react";
import { useForm, type UseFormWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Field, Input, Tabs, TabsContent, TabsList, TabsTrigger, cn } from "../../ui";
import { ChatIcon, LockIcon, UsersIcon } from "../../ui/icons";
import { useAuthStore } from "../../stores/authStore";
import {
  loginSchema,
  passwordRules,
  recoverySchema,
  signupSchema,
  type AuthMode,
  type LoginValues,
  type RecoveryValues,
  type SignupValues
} from "./authSchema";
import { PasswordInput } from "./PasswordInput";

/** Sign in / create account / recovery-code sign in. */
export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>("login");
  // Shared across tabs so switching modes keeps what you typed; passwords reset on switch.
  const [username, setUsername] = useState("");
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-6 sm:items-center">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-orbit-panel/70 shadow-[0_24px_70px_rgba(0,0,0,0.45)] md:grid-cols-[1.1fr_1fr]">
        <Intro />
        <section className="bg-orbit-panel p-6 sm:p-8">
          <Tabs
            value={mode}
            onValueChange={(value) => {
              setMode(value as AuthMode);
              clearError();
            }}
          >
            <TabsList aria-label="Account">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
              <TabsTrigger value="recovery">Recovery</TabsTrigger>
            </TabsList>

            {error && (
              <Alert tone="danger" className="mt-5">
                {error}
              </Alert>
            )}

            <TabsContent value="login" className="mt-5 outline-none">
              <LoginForm username={username} onUsernameChange={setUsername} />
            </TabsContent>
            <TabsContent value="signup" className="mt-5 outline-none">
              <SignupForm username={username} onUsernameChange={setUsername} />
            </TabsContent>
            <TabsContent value="recovery" className="mt-5 outline-none">
              <RecoveryForm username={username} onUsernameChange={setUsername} />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}

function Intro() {
  const points: Array<{ icon: ReactNode; title: string; body: string }> = [
    { icon: <LockIcon />, title: "End-to-end encrypted", body: "Messages and files are encrypted and decrypted on your device." },
    { icon: <ChatIcon />, title: "Realtime", body: "Delivery, typing and read receipts over a live connection." },
    { icon: <UsersIcon />, title: "DMs and groups", body: "Chat one-on-one or in groups, with optional passcode locks." }
  ];
  return (
    <section className="relative hidden flex-col justify-between gap-8 overflow-hidden bg-gradient-to-br from-orbit-accent/[0.12] via-orbit-panelAlt to-orbit-panelAlt p-8 md:flex">
      <div className="flex items-center gap-2.5">
        <img src="logo.png" alt="" className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15" />
        <span className="text-sm font-bold tracking-wide">Orbit Chat</span>
      </div>
      <div>
        <h1 className="text-3xl font-bold leading-tight">Private messaging that stays on your devices.</h1>
        <ul className="mt-6 space-y-4">
          {points.map((point) => (
            <li key={point.title} className="flex gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orbit-accent/15 text-orbit-accent">
                {point.icon}
              </span>
              <span>
                <span className="block text-sm font-semibold">{point.title}</span>
                <span className="block text-xs text-orbit-muted">{point.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-orbit-muted">Your private key never leaves this device.</p>
    </section>
  );
}

type FormProps = { username: string; onUsernameChange: (value: string) => void };

/** Mirrors the form's username into the shared state so other tabs start with it. */
function useSyncUsername(watch: UseFormWatch<{ username: string }>, onUsernameChange: (value: string) => void) {
  useEffect(() => {
    const subscription = watch((values) => onUsernameChange(values.username ?? ""));
    return () => subscription.unsubscribe();
  }, [watch, onUsernameChange]);
}

function SubmitButton({ busy, children, busyLabel }: { busy: boolean; children: ReactNode; busyLabel: string }) {
  return (
    <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
      {busy ? busyLabel : children}
    </Button>
  );
}

function LoginForm({ username, onUsernameChange }: FormProps) {
  const login = useAuthStore((s) => s.login);
  const busy = useAuthStore((s) => s.loading);
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { username, password: "" } });
  useSyncUsername(form.watch as unknown as UseFormWatch<{ username: string }>, onUsernameChange);
  const { errors } = form.formState;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        await login(values.username.trim(), values.password);
        form.resetField("password");
      })}
    >
      <Field label="Username" error={errors.username?.message}>
        {(field) => <Input {...field} {...form.register("username")} autoComplete="username" autoFocus placeholder="your-name" />}
      </Field>
      <Field label="Password" error={errors.password?.message}>
        {(field) => <PasswordInput {...field} {...form.register("password")} autoComplete="current-password" />}
      </Field>
      <SubmitButton busy={busy} busyLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}

function SignupForm({ username, onUsernameChange }: FormProps) {
  const signup = useAuthStore((s) => s.signup);
  const busy = useAuthStore((s) => s.loading);
  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { username, password: "", confirmPassword: "" }
  });
  useSyncUsername(form.watch as unknown as UseFormWatch<{ username: string }>, onUsernameChange);
  const { errors } = form.formState;
  const password = form.watch("password");

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        await signup(values.username.trim(), values.password);
        form.resetField("password");
        form.resetField("confirmPassword");
      })}
    >
      <Field label="Username" error={errors.username?.message}>
        {(field) => <Input {...field} {...form.register("username")} autoComplete="username" autoFocus placeholder="your-name" />}
      </Field>
      <Field label="Password" error={errors.password?.message}>
        {(field) => <PasswordInput {...field} {...form.register("password")} autoComplete="new-password" />}
      </Field>
      <ul className="-mt-1 flex flex-wrap gap-x-4 gap-y-1" aria-label="Password requirements">
        {passwordRules.map((rule) => {
          const met = rule.test(password);
          return (
            <li
              key={rule.id}
              className={cn("flex items-center gap-1.5 text-[11px] transition-colors", met ? "text-orbit-accent" : "text-orbit-muted")}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded-full border transition-colors",
                  met ? "border-orbit-accent bg-orbit-accent text-slate-950" : "border-white/25"
                )}
              >
                {met && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m2.5 6 2.5 2.5 4.5-5" />
                  </svg>
                )}
              </span>
              <span className="sr-only">{met ? "Met: " : "Not met: "}</span>
              {rule.label}
            </li>
          );
        })}
      </ul>
      <Field label="Confirm password" error={errors.confirmPassword?.message}>
        {(field) => <PasswordInput {...field} {...form.register("confirmPassword")} autoComplete="new-password" />}
      </Field>
      <SubmitButton busy={busy} busyLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}

function RecoveryForm({ username, onUsernameChange }: FormProps) {
  const loginWithRecoveryCode = useAuthStore((s) => s.loginWithRecoveryCode);
  const busy = useAuthStore((s) => s.loading);
  const form = useForm<RecoveryValues>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { username, recoveryCode: "" }
  });
  useSyncUsername(form.watch as unknown as UseFormWatch<{ username: string }>, onUsernameChange);
  const { errors } = form.formState;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        await loginWithRecoveryCode(values.username.trim(), values.recoveryCode.trim());
        form.resetField("recoveryCode");
      })}
    >
      <Field label="Username" error={errors.username?.message}>
        {(field) => <Input {...field} {...form.register("username")} autoComplete="username" autoFocus placeholder="your-name" />}
      </Field>
      <Field
        label="Recovery code"
        error={errors.recoveryCode?.message}
        hint="Sign in without your password. Each code works once."
      >
        {(field) => (
          <Input {...field} {...form.register("recoveryCode")} autoComplete="off" spellCheck={false} placeholder="xxxx-xxxx" className="font-mono tracking-wider" />
        )}
      </Field>
      <SubmitButton busy={busy} busyLabel="Signing in…">
        Sign in with recovery code
      </SubmitButton>
    </form>
  );
}
