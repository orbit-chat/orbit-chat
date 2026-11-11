import * as api from "../../lib/api";
import {
  LinkChannel,
  LinkProtocolError,
  buildHello,
  buildWelcome,
  decodeLinkQr,
  encodeLinkQr,
  linkingReady,
  formatLinkCode,
  generateLinkCode,
  newLinkSecret,
  readHello,
  readWelcome,
  signingKeyFingerprint,
  startCodeExchange,
  wireType,
  type LinkHello,
} from "../../lib/deviceLinking";
import {
  adoptLinkedIdentity,
  ensureDeviceSigningKey,
  identityKeyStorageKey,
  ownListVersionFloor,
  publishDeviceListChange,
} from "../../lib/deviceIdentity";
import { shareHistoryWithDevice } from "./shareHistory";
import { resetMessageSigners } from "../chat/messageSigners";
import { getPlatform } from "../../platform";
import { useE2EEStore } from "../../stores/e2eeStore";
import { deviceIdFromToken } from "../../lib/jwt";

/**
 * The linking flows (mobile plan B7), run over the server's relay. Either device can create the
 * session and show the code; the other scans or types it. See `src/lib/deviceLinking.ts` for the
 * protocol and why the relay can't interfere.
 *
 * Each flow reports progress through `onUpdate` and is driven to the end or to a failure; any
 * protocol error ends the session on the server too, so a secret is never used twice.
 */

export type LinkUpdate =
  | { step: "starting" }
  | { step: "show-qr"; qr: string; expiresAt: string }
  | { step: "show-code"; code: string; expiresAt: string }
  | { step: "waiting"; expiresAt?: string }
  /** Trusted side: the user checks the new device's name and code, then calls `confirm()`. */
  | { step: "confirm"; deviceName: string; code: string }
  /** New side: the same code is shown; the user confirms on the other device. */
  | { step: "confirm-elsewhere"; code: string }
  | { step: "finishing" }
  | { step: "done"; deviceName?: string }
  | { step: "failed"; message: string };

export type LinkController = {
  /** Trusted side, at the "confirm" step: the name and code match the device in hand. */
  confirm: () => void;
  cancel: () => void;
  done: Promise<boolean>;
};

/** Relay polling interval; tests shorten it. */
export const linkTiming = { pollMs: 1000 };
/** Time the trusted side needs after publishing the list to deliver the welcome. */
const FINISH_TIME_MS = 15_000;

/** A few quick retries for the steps after the list is published, where giving up would strand the new device. */
async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const permanent = err instanceof api.ApiError && err.status >= 400 && err.status < 500;
      if (permanent || attempt >= attempts) throw err;
      await sleep(500 * attempt);
    }
  }
}
const TYPED_CODE_FAILED = "Linking failed. If you typed the code correctly, someone may have tried to intercept it.";
const QR_FAILED = "Linking failed. Start again from the device you're linking with.";

type Session = { userId: string; token: () => string | null };

class LinkCancelled extends Error {}

/** User-facing text for a session that ended on the server. */
function endedMessage(status: api.LinkSessionStatus, reason: string | null) {
  if (status === "expired") return "The code expired. Start again.";
  if (status === "cancelled") return "This linking attempt was replaced by a newer one.";
  if (status === "failed" && reason === "declined") return "Linking was cancelled on the other device.";
  return "Linking failed on the other device.";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `flow`, mapping every failure to one "failed" update and ending the server session. */
function runFlow(
  session: Session,
  onUpdate: (update: LinkUpdate) => void,
  flow: (ctx: FlowContext) => Promise<string | undefined>
): LinkController {
  let cancelled = false;
  let confirmResolve: (() => void) | null = null;
  let confirmed = false;
  let sessionId: string | null = null;
  let typed = false;

  const ctx: FlowContext = {
    token() {
      const t = session.token();
      if (!t) throw new LinkCancelled("signed out");
      return t;
    },
    checkCancelled() {
      if (cancelled) throw new LinkCancelled("cancelled");
    },
    setSession(id, isTyped) {
      sessionId = id;
      typed = isTyped;
    },
    waitForConfirmation() {
      if (confirmed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const check = setInterval(() => {
          if (cancelled) {
            clearInterval(check);
            reject(new LinkCancelled("cancelled"));
          }
        }, 200);
        confirmResolve = () => {
          clearInterval(check);
          resolve();
        };
      });
    },
    async assertTimeLeft(ms) {
      if (!sessionId) throw new Error("No session");
      const { session: current } = await api.getLinkMessages(sessionId, ctx.after, ctx.token());
      if (current.status !== "joined") throw new LinkEnded(endedMessage(current.status, current.failureReason));
      if (new Date(current.expiresAt).getTime() - Date.now() < ms) throw new LinkEnded("The code expired. Start again.");
    },
    async waitFor(predicate) {
      if (!sessionId) throw new Error("No session");
      for (;;) {
        ctx.checkCancelled();
        const { session: current, messages } = await api.getLinkMessages(sessionId, ctx.after, ctx.token());
        for (const message of messages) {
          ctx.after = Math.max(ctx.after, message.seq);
          ctx.inbox.push(message.payload);
        }
        const result = predicate(current);
        if (result !== undefined) return result;
        if (current.status !== "open" && current.status !== "joined") {
          throw new LinkEnded(endedMessage(current.status, current.failureReason));
        }
        await sleep(linkTiming.pollMs);
      }
    },
    after: 0,
    inbox: [],
    update: onUpdate,
  };

  const done = (async () => {
    try {
      onUpdate({ step: "starting" });
      await linkingReady;
      const deviceName = await flow(ctx);
      onUpdate({ step: "done", deviceName });
      return true;
    } catch (err) {
      const t = session.token();
      if (sessionId && t && !(err instanceof LinkEnded)) {
        const reason = err instanceof LinkCancelled ? "declined" : err instanceof LinkProtocolError ? "key_confirmation_failed" : "error";
        await api.failLinkSession(sessionId, reason, t).catch(() => undefined);
      }
      if (err instanceof LinkCancelled) onUpdate({ step: "failed", message: "Linking was cancelled." });
      else if (err instanceof LinkEnded) onUpdate({ step: "failed", message: err.message });
      else if (err instanceof LinkProtocolError) onUpdate({ step: "failed", message: typed ? TYPED_CODE_FAILED : QR_FAILED });
      else onUpdate({ step: "failed", message: err instanceof Error ? err.message : "Linking failed." });
      return false;
    }
  })();

  return {
    confirm() {
      confirmed = true;
      confirmResolve?.();
    },
    cancel() {
      cancelled = true;
    },
    done,
  };
}

class LinkEnded extends Error {}

type FlowContext = {
  token: () => string;
  checkCancelled: () => void;
  setSession: (sessionId: string, typed: boolean) => void;
  waitForConfirmation: () => Promise<void>;
  /** Throws unless the session is still joined with at least `ms` left. */
  assertTimeLeft: (ms: number) => Promise<void>;
  /** Poll until `predicate` returns a value; throws if the session ends first. New messages land in `inbox`. */
  waitFor: <T>(predicate: (session: api.LinkSession) => T | undefined) => Promise<T>;
  after: number;
  inbox: string[];
  update: (update: LinkUpdate) => void;
};

/** The next message of `type` from the other device; anything else at this point is a protocol error. */
async function nextMessage(ctx: FlowContext, type: string) {
  const wire = await ctx.waitFor(() => (ctx.inbox.length ? ctx.inbox.shift()! : undefined));
  if (wireType(wire) !== type) throw new LinkProtocolError(`Expected a ${type} message`);
  return wire;
}

async function thisDeviceHello(userId: string, token: string): Promise<{ hello: LinkHello; signingPrivateKey: string }> {
  const deviceId = deviceIdFromToken(token);
  if (!deviceId) throw new Error("This session has no device ID. Sign in again.");
  const encryption = await useE2EEStore.getState().ensureDeviceKeypair(userId, token);
  const signing = await ensureDeviceSigningKey(userId);
  return {
    hello: { deviceId, encryptionPublicKey: encryption.publicKey, signingPublicKey: signing.publicKey, name: getPlatform().deviceName },
    signingPrivateKey: signing.privateKey,
  };
}

// ─── The trusted side ────────────────────────────────────

/**
 * After the channel is up: read N's hello, let the user confirm, publish the list with N, send
 * the welcome, mark the session complete, then share history in the background.
 */
async function linkFromTrustedSide(ctx: FlowContext, params: { userId: string; channel: LinkChannel; sessionId: string; newDeviceId: string }) {
  const helloWire = await nextMessage(ctx, "hello");
  const hello = await readHello(params.channel, helloWire, params.newDeviceId);
  ctx.update({ step: "confirm", deviceName: hello.name, code: params.channel.confirmationCode(helloWire) });
  await ctx.waitForConfirmation();
  ctx.checkCancelled();
  ctx.update({ step: "finishing" });

  const token = ctx.token();
  const me = await useE2EEStore.getState().thisDevice(params.userId, token);
  const identityPrivateKey = await getPlatform().secureStore.get(identityKeyStorageKey(params.userId));
  if (!identityPrivateKey) throw new Error("This device no longer holds your security key.");
  // Publishing adds the device for good: only start if there's time to hand it the identity.
  await ctx.assertTimeLeft(FINISH_TIME_MS);
  const { signed } = await publishDeviceListChange(params.userId, token, (current) => [
    ...current.devices.filter((d) => d.deviceId !== hello.deviceId),
    { ...hello, addedAt: Date.now() },
  ]);
  const welcome = await buildWelcome(
    params.channel,
    { identityPrivateKey, deviceList: signed, linkerDeviceId: me.deviceId, newDeviceId: hello.deviceId },
    me.signingPrivateKey
  );
  await withRetries(() => api.postLinkMessage(params.sessionId, welcome, ctx.token()));
  await withRetries(() => api.completeLinkSession(params.sessionId, ctx.token()));
  // History goes through the key batch endpoint, not the link channel; it can take a while, so
  // it runs after the session closes (and resumes on the next sign-in if interrupted).
  void shareHistoryWithDevice(params.userId, ctx.token(), hello.deviceId);
  return hello.name;
}

/** This trusted device shows a QR code or a typed code for the new device. */
export function startLinkingFromTrusted(session: Session, mode: "qr" | "code", onUpdate: (update: LinkUpdate) => void) {
  return runFlow(session, onUpdate, async (ctx) => {
    const token = ctx.token();
    const me = await useE2EEStore.getState().thisDevice(session.userId, token);
    // A flow cancelled while it was getting ready must not create a session: that would cancel
    // the session of the flow that replaced it.
    ctx.checkCancelled();
    const created = await api.createLinkSession({ mode, role: "existing" }, token);
    ctx.setSession(created.sessionId, mode === "code");

    let channel: LinkChannel;
    if (mode === "qr") {
      const secret = newLinkSecret();
      const signing = await ensureDeviceSigningKey(session.userId);
      ctx.update({
        step: "show-qr",
        expiresAt: created.expiresAt,
        qr: encodeLinkQr({
          v: 1,
          sessionId: created.sessionId,
          userId: session.userId,
          secret,
          creatorRole: "existing",
          creatorDeviceId: me.deviceId,
          fingerprint: signingKeyFingerprint(signing.publicKey),
        }),
      });
      const joined = await ctx.waitFor((s) => (s.status === "joined" && s.joinerDeviceId ? s : undefined));
      channel = LinkChannel.fromSecret(secret, session.userId, created.sessionId);
      return linkFromTrustedSide(ctx, { userId: session.userId, channel, sessionId: created.sessionId, newDeviceId: joined.joinerDeviceId! });
    }

    const code = generateLinkCode();
    ctx.update({ step: "show-code", code: formatLinkCode(code), expiresAt: created.expiresAt });
    const joined = await ctx.waitFor((s) => (s.status === "joined" && s.joinerDeviceId ? s : undefined));
    const exchange = startCodeExchange({
      code,
      userId: session.userId,
      sessionId: created.sessionId,
      creatorDeviceId: me.deviceId,
      joinerDeviceId: joined.joinerDeviceId!,
      side: "creator",
    });
    await api.postLinkMessage(created.sessionId, exchange.wire, ctx.token());
    channel = exchange.finish(await nextMessage(ctx, "cpace"));
    return linkFromTrustedSide(ctx, { userId: session.userId, channel, sessionId: created.sessionId, newDeviceId: joined.joinerDeviceId! });
  });
}

/** This trusted device scans the new device's QR code, or takes the code typed from its screen. */
export function joinLinkingFromTrusted(session: Session, input: { qr: string } | { code: string }, onUpdate: (update: LinkUpdate) => void) {
  return runFlow(session, onUpdate, async (ctx) => {
    const token = ctx.token();
    const me = await useE2EEStore.getState().thisDevice(session.userId, token);

    if ("qr" in input) {
      const payload = decodeLinkQr(input.qr);
      if (payload.userId !== session.userId) throw new Error("That code is for a different account.");
      if (payload.creatorRole !== "new") throw new Error("Scan this code with the device you want to link.");
      const joined = await api.joinLinkSession(payload.sessionId, token);
      ctx.setSession(joined.sessionId, false);
      ctx.update({ step: "waiting" });
      const channel = LinkChannel.fromSecret(payload.secret, session.userId, joined.sessionId);
      return linkFromTrustedSide(ctx, { userId: session.userId, channel, sessionId: joined.sessionId, newDeviceId: joined.creatorDeviceId });
    }

    const active = await api.getActiveLinkSession(token);
    if (!active || active.creatorRole !== "new") throw new Error("No device is waiting to be linked. Start on the new device first.");
    const joined = await api.joinLinkSession(active.sessionId, token);
    ctx.setSession(joined.sessionId, true);
    ctx.update({ step: "waiting" });
    const exchange = startCodeExchange({
      code: input.code,
      userId: session.userId,
      sessionId: joined.sessionId,
      creatorDeviceId: joined.creatorDeviceId,
      joinerDeviceId: me.deviceId,
      side: "joiner",
    });
    await api.postLinkMessage(joined.sessionId, exchange.wire, ctx.token());
    const channel = exchange.finish(await nextMessage(ctx, "cpace"));
    return linkFromTrustedSide(ctx, { userId: session.userId, channel, sessionId: joined.sessionId, newDeviceId: joined.creatorDeviceId });
  });
}

// ─── The new side ────────────────────────────────────────

/** After the channel is up: send the hello, show the code, then verify and adopt the welcome. */
async function linkFromNewSide(ctx: FlowContext, params: { userId: string; channel: LinkChannel; sessionId: string; linkerFingerprint?: string }) {
  const token = ctx.token();
  const { hello, signingPrivateKey } = await thisDeviceHello(params.userId, token);
  const helloWire = await buildHello(params.channel, hello, signingPrivateKey);
  await api.postLinkMessage(params.sessionId, helloWire, token);
  ctx.update({ step: "confirm-elsewhere", code: params.channel.confirmationCode(helloWire) });

  const welcomeWire = await nextMessage(ctx, "welcome");
  ctx.update({ step: "finishing" });
  const account = await api.getMyIdentity(ctx.token());
  if (!account) throw new Error("Your account has no security key yet.");
  const welcome = await readWelcome(params.channel, welcomeWire, {
    me: hello,
    accountIdentityKey: account.identityKey,
    minListVersion: await ownListVersionFloor(params.userId),
    linkerFingerprint: params.linkerFingerprint,
  });
  await adoptLinkedIdentity(params.userId, welcome.identityPrivateKey, welcome.list.version);

  // Start over with keys and sender checks: this device can now read and verify what it couldn't.
  useE2EEStore.getState().reset();
  resetMessageSigners();
  const status = await useE2EEStore.getState().ensureDeviceIdentity(params.userId, ctx.token(), { force: true });
  if (status !== "trusted") throw new Error("Linking finished, but this device still isn't on your device list. Try again.");
  // Keys sealed to this device back when it was a legacy device move over too.
  void useE2EEStore.getState().migrateLegacyKeys(params.userId, ctx.token()).catch(() => undefined);
  return undefined;
}

/** This new device shows a QR code (for a trusted phone to scan) or a code to type there. */
export function startLinkingFromNew(session: Session, mode: "qr" | "code", onUpdate: (update: LinkUpdate) => void) {
  return runFlow(session, onUpdate, async (ctx) => {
    const token = ctx.token();
    const deviceId = deviceIdFromToken(token);
    if (!deviceId) throw new Error("This session has no device ID. Sign in again.");
    // A flow cancelled while it was getting ready must not create a session: that would cancel
    // the session of the flow that replaced it.
    ctx.checkCancelled();
    const created = await api.createLinkSession({ mode, role: "new" }, token);
    ctx.setSession(created.sessionId, mode === "code");

    if (mode === "qr") {
      const secret = newLinkSecret();
      ctx.update({
        step: "show-qr",
        expiresAt: created.expiresAt,
        qr: encodeLinkQr({ v: 1, sessionId: created.sessionId, userId: session.userId, secret, creatorRole: "new", creatorDeviceId: deviceId }),
      });
      await ctx.waitFor((s) => (s.status === "joined" ? s : undefined));
      const channel = LinkChannel.fromSecret(secret, session.userId, created.sessionId);
      return linkFromNewSide(ctx, { userId: session.userId, channel, sessionId: created.sessionId });
    }

    const code = generateLinkCode();
    ctx.update({ step: "show-code", code: formatLinkCode(code), expiresAt: created.expiresAt });
    const joined = await ctx.waitFor((s) => (s.status === "joined" && s.joinerDeviceId ? s : undefined));
    const exchange = startCodeExchange({
      code,
      userId: session.userId,
      sessionId: created.sessionId,
      creatorDeviceId: deviceId,
      joinerDeviceId: joined.joinerDeviceId!,
      side: "creator",
    });
    await api.postLinkMessage(created.sessionId, exchange.wire, ctx.token());
    const channel = exchange.finish(await nextMessage(ctx, "cpace"));
    return linkFromNewSide(ctx, { userId: session.userId, channel, sessionId: created.sessionId });
  });
}

/** This new device scans a trusted device's QR code, or takes the code typed from its screen. */
export function joinLinkingFromNew(session: Session, input: { qr: string } | { code: string }, onUpdate: (update: LinkUpdate) => void) {
  return runFlow(session, onUpdate, async (ctx) => {
    const token = ctx.token();
    const deviceId = deviceIdFromToken(token);
    if (!deviceId) throw new Error("This session has no device ID. Sign in again.");

    if ("qr" in input) {
      const payload = decodeLinkQr(input.qr);
      if (payload.userId !== session.userId) throw new Error("That code is for a different account.");
      if (payload.creatorRole !== "existing" || !payload.fingerprint) throw new Error("Scan the code shown on one of your linked devices.");
      const joined = await api.joinLinkSession(payload.sessionId, token);
      ctx.setSession(joined.sessionId, false);
      const channel = LinkChannel.fromSecret(payload.secret, session.userId, joined.sessionId);
      return linkFromNewSide(ctx, { userId: session.userId, channel, sessionId: joined.sessionId, linkerFingerprint: payload.fingerprint });
    }

    const active = await api.getActiveLinkSession(token);
    if (!active || active.creatorRole !== "existing") throw new Error("No linking code is showing on your other devices. Start there first.");
    const joined = await api.joinLinkSession(active.sessionId, token);
    ctx.setSession(joined.sessionId, true);
    const exchange = startCodeExchange({
      code: input.code,
      userId: session.userId,
      sessionId: joined.sessionId,
      creatorDeviceId: joined.creatorDeviceId,
      joinerDeviceId: deviceId,
      side: "joiner",
    });
    await api.postLinkMessage(joined.sessionId, exchange.wire, ctx.token());
    const channel = exchange.finish(await nextMessage(ctx, "cpace"));
    return linkFromNewSide(ctx, { userId: session.userId, channel, sessionId: joined.sessionId });
  });
}
