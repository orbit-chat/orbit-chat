// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { generateKeypair } from "../../../lib/crypto";
import { generateSigningKeypair, signDeviceList, verifyDeviceList, type DeviceListEntry } from "../../../lib/deviceTrust";
import { setPlatform, type SecureStore } from "../../../platform";
import type { LinkUpdate } from "../linkDevice";

/**
 * The linking flows against an in-memory relay (mobile plan B7). One side runs the real app code;
 * the other is played by hand with the protocol library, so each test can also play it wrong:
 * a mistyped code, a different device, a declined confirmation.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const E_ID = "44444444-4444-4444-8444-444444444444";
const N_ID = "55555555-5555-4555-8555-555555555555";
const tokenFor = (deviceId: string) => `h.${btoa(JSON.stringify({ deviceId }))}.s`;

// ─── The fake server ─────────────────────────────────────

type Session = {
  sessionId: string;
  mode: "qr" | "code";
  creatorRole: "existing" | "new";
  creatorDeviceId: string;
  joinerDeviceId: string | null;
  status: "open" | "joined" | "completed" | "failed" | "cancelled" | "expired";
  failureReason: string | null;
  expiresAt: string;
  messages: Array<{ seq: number; payload: string; from: string }>;
};
const server = {
  identityKey: "",
  lists: [] as Array<{ version: number; body: string; signature: string }>,
  sessions: new Map<string, Session>(),
  batches: [] as unknown[],
};
const deviceOf = (token: string) => JSON.parse(atob(token.split(".")[1]!)).deviceId as string;
const view = (s: Session) => {
  const { messages: _messages, ...rest } = s;
  return { ...rest };
};
const latestList = () => server.lists.at(-1)!;

const fakeApi = {
  getMyIdentity: async () => ({ identityKey: server.identityKey, deviceList: latestList() }),
  getUserIdentity: async () => null,
  publishDeviceList: async (list: { body: string; signature: string }) => {
    const parsed = await verifyDeviceList(list, server.identityKey, { expectedUserId: USER });
    if (parsed.version <= latestList().version) throw new Error("Device list version must increase");
    server.lists.push({ version: parsed.version, ...list });
    return { identityKey: server.identityKey, deviceList: latestList() };
  },
  addMyPublicKey: async () => [],
  getConversations: async () => [],
  storeDeviceKeyBatch: async (keys: unknown[]) => {
    server.batches.push(keys);
    return { stored: keys.length, skipped: 0 };
  },
  createLinkSession: async (data: { mode: "qr" | "code"; role: "existing" | "new" }, token: string) => {
    const session: Session = {
      sessionId: crypto.randomUUID(),
      mode: data.mode,
      creatorRole: data.role,
      creatorDeviceId: deviceOf(token),
      joinerDeviceId: null,
      status: "open",
      failureReason: null,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      messages: [],
    };
    server.sessions.set(session.sessionId, session);
    return view(session);
  },
  getActiveLinkSession: async () => {
    const open = [...server.sessions.values()].filter((s) => s.status === "open").at(-1);
    return open ? view(open) : null;
  },
  joinLinkSession: async (sessionId: string, token: string) => {
    const s = server.sessions.get(sessionId)!;
    if (s.status !== "open") throw new Error("This linking session was already used");
    s.status = "joined";
    s.joinerDeviceId = deviceOf(token);
    return view(s);
  },
  postLinkMessage: async (sessionId: string, payload: string, token: string) => {
    const s = server.sessions.get(sessionId)!;
    if (s.status !== "joined") throw new Error("This linking session is not active");
    s.messages.push({ seq: s.messages.length + 1, payload, from: deviceOf(token) });
    return { seq: s.messages.length };
  },
  getLinkMessages: async (sessionId: string, after: number, token: string) => {
    const s = server.sessions.get(sessionId)!;
    const me = deviceOf(token);
    return { session: view(s), messages: s.messages.filter((m) => m.seq > after && m.from !== me).map(({ seq, payload }) => ({ seq, payload })) };
  },
  failLinkSession: async (sessionId: string, reason: string) => {
    const s = server.sessions.get(sessionId)!;
    if (s.status === "open" || s.status === "joined") Object.assign(s, { status: "failed", failureReason: reason });
    return view(s);
  },
  completeLinkSession: async (sessionId: string) => {
    const s = server.sessions.get(sessionId)!;
    s.status = "completed";
    return view(s);
  },
};
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  ...Object.fromEntries(Object.entries(fakeApi).map(([name, fn]) => [name, (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args)])),
}));

const lib = await import("../../../lib/deviceLinking");
const { startLinkingFromTrusted, startLinkingFromNew, joinLinkingFromNew, linkTiming } = await import("../linkDevice");
const { useE2EEStore, devicePrivateKeyStorageKey } = await import("../../../stores/e2eeStore");
const { deviceSigningKeyStorageKey, identityKeyStorageKey } = await import("../../../lib/deviceIdentity");

// ─── Devices ─────────────────────────────────────────────

type Keys = { enc: { publicKey: string; privateKey: string }; sign: { publicKey: string; privateKey: string }; entry: DeviceListEntry };
async function keysFor(deviceId: string, name: string): Promise<Keys> {
  const enc = await generateKeypair();
  const sign = await generateSigningKeypair();
  return { enc, sign, entry: { deviceId, encryptionPublicKey: enc.publicKey, signingPublicKey: sign.publicKey, name, addedAt: 1 } };
}

function memoryStore(): SecureStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}

let store: ReturnType<typeof memoryStore>;
let identity: { publicKey: string; privateKey: string };
let e: Keys;
let n: Keys;

/** The app runs as `deviceId`; the account's identity exists with E on list v1. */
async function runAs(deviceId: string, appKeys: Keys, holdsIdentity: boolean) {
  store = memoryStore();
  setPlatform({ kind: "desktop", deviceName: appKeys.entry.name, secureStore: store });
  await store.set(devicePrivateKeyStorageKey(USER), appKeys.enc.privateKey);
  await store.set(deviceSigningKeyStorageKey(USER), appKeys.sign.privateKey);
  if (holdsIdentity) await store.set(identityKeyStorageKey(USER), identity.privateKey);
  useE2EEStore.getState().reset();
  useE2EEStore.setState({ perDeviceKeysByUserId: { [USER]: true } });
  return { userId: USER, token: () => tokenFor(deviceId) };
}

function collect() {
  const updates: LinkUpdate[] = [];
  const waitFor = (step: LinkUpdate["step"]) => vi.waitFor(() => {
    const found = updates.find((u) => u.step === step);
    if (!found) throw new Error(`no ${step} yet`);
    return found;
  }, { timeout: 5000, interval: 5 });
  return { updates, onUpdate: (u: LinkUpdate) => updates.push(u), waitFor };
}

/** Plays the relay's other end: poll for the next message from the given device. */
async function nextFrom(sessionId: string, deviceId: string, after: number) {
  return vi.waitFor(() => {
    const message = server.sessions.get(sessionId)!.messages.find((m) => m.seq > after && m.from === deviceId);
    if (!message) throw new Error("waiting");
    return message;
  }, { timeout: 5000, interval: 5 });
}

beforeEach(async () => {
  await sodium.ready;
  linkTiming.pollMs = 5;
  server.sessions.clear();
  server.batches = [];
  identity = await generateSigningKeypair();
  e = await keysFor(E_ID, "Orbit Desktop");
  n = await keysFor(N_ID, "Orbit iOS");
  server.identityKey = identity.publicKey;
  server.lists = [{ version: 1, ...(await signDeviceList({ userId: USER, version: 1, devices: [e.entry] }, identity.privateKey)) }];
});

const helloOf = (k: Keys) => ({ deviceId: k.entry.deviceId, encryptionPublicKey: k.enc.publicKey, signingPublicKey: k.sign.publicKey, name: k.entry.name });

describe("linking from the trusted device", () => {
  it("shows a QR code, confirms the new device, and hands it the identity and a list naming it", async () => {
    const session = await runAs(E_ID, e, true);
    const { onUpdate, waitFor } = collect();
    const controller = startLinkingFromTrusted(session, "qr", onUpdate);

    // The new device scans the code (played by hand).
    const shown = (await waitFor("show-qr")) as Extract<LinkUpdate, { step: "show-qr" }>;
    const qr = lib.decodeLinkQr(shown.qr);
    expect(qr).toMatchObject({ creatorRole: "existing", creatorDeviceId: E_ID, userId: USER });
    await fakeApi.joinLinkSession(qr.sessionId, tokenFor(N_ID));
    const channel = lib.LinkChannel.fromSecret(qr.secret, USER, qr.sessionId);
    const hello = await lib.buildHello(channel, helloOf(n), n.sign.privateKey);
    await fakeApi.postLinkMessage(qr.sessionId, hello, tokenFor(N_ID));

    const confirm = (await waitFor("confirm")) as Extract<LinkUpdate, { step: "confirm" }>;
    expect(confirm).toEqual({ step: "confirm", deviceName: "Orbit iOS", code: channel.confirmationCode(hello) });
    expect(server.lists).toHaveLength(1); // nothing published before the user confirms
    controller.confirm();
    expect(await controller.done).toBe(true);

    const welcome = await nextFrom(qr.sessionId, E_ID, 0);
    const result = await lib.readWelcome(channel, welcome.payload, {
      me: helloOf(n),
      accountIdentityKey: identity.publicKey,
      minListVersion: 0,
      linkerFingerprint: qr.fingerprint,
    });
    expect(result.identityPrivateKey).toBe(identity.privateKey);
    expect(result.list.version).toBe(2);
    expect(latestList().version).toBe(2);
    expect(server.sessions.get(qr.sessionId)!.status).toBe("completed");
  });

  it("publishes nothing and ends the session if the user declines", async () => {
    const session = await runAs(E_ID, e, true);
    const { onUpdate, waitFor, updates } = collect();
    const controller = startLinkingFromTrusted(session, "qr", onUpdate);
    const qr = lib.decodeLinkQr(((await waitFor("show-qr")) as Extract<LinkUpdate, { step: "show-qr" }>).qr);
    await fakeApi.joinLinkSession(qr.sessionId, tokenFor(N_ID));
    const channel = lib.LinkChannel.fromSecret(qr.secret, USER, qr.sessionId);
    await fakeApi.postLinkMessage(qr.sessionId, await lib.buildHello(channel, helloOf(n), n.sign.privateKey), tokenFor(N_ID));
    await waitFor("confirm");
    controller.cancel();
    expect(await controller.done).toBe(false);
    expect(server.lists).toHaveLength(1);
    expect(server.sessions.get(qr.sessionId)).toMatchObject({ status: "failed", failureReason: "declined" });
    expect(updates.at(-1)).toEqual({ step: "failed", message: "Linking was cancelled." });
  });

  it("refuses a hello from someone without the QR secret (e.g. the relay itself)", async () => {
    const session = await runAs(E_ID, e, true);
    const { onUpdate, waitFor, updates } = collect();
    const controller = startLinkingFromTrusted(session, "qr", onUpdate);
    const qr = lib.decodeLinkQr(((await waitFor("show-qr")) as Extract<LinkUpdate, { step: "show-qr" }>).qr);
    await fakeApi.joinLinkSession(qr.sessionId, tokenFor(N_ID));
    const guessed = lib.LinkChannel.fromSecret(lib.newLinkSecret(), USER, qr.sessionId);
    await fakeApi.postLinkMessage(qr.sessionId, await lib.buildHello(guessed, helloOf(n), n.sign.privateKey), tokenFor(N_ID));
    expect(await controller.done).toBe(false);
    expect(server.lists).toHaveLength(1);
    expect(server.sessions.get(qr.sessionId)).toMatchObject({ status: "failed", failureReason: "key_confirmation_failed" });
    expect(updates.at(-1)?.step).toBe("failed");
  });

  it("ends the session for both sides when the typed code was wrong", async () => {
    const session = await runAs(E_ID, e, true);
    const { onUpdate, waitFor, updates } = collect();
    const controller = startLinkingFromTrusted(session, "code", onUpdate);
    const shown = (await waitFor("show-code")) as Extract<LinkUpdate, { step: "show-code" }>;
    expect(shown.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const active = (await fakeApi.getActiveLinkSession())!;
    await fakeApi.joinLinkSession(active.sessionId, tokenFor(N_ID));
    const wrong = lib.startCodeExchange({ code: "AAAA-AAAA", userId: USER, sessionId: active.sessionId, creatorDeviceId: E_ID, joinerDeviceId: N_ID, side: "joiner" });
    await fakeApi.postLinkMessage(active.sessionId, wrong.wire, tokenFor(N_ID));
    const creatorY = await nextFrom(active.sessionId, E_ID, 0);
    const channel = wrong.finish(creatorY.payload);
    await fakeApi.postLinkMessage(active.sessionId, await lib.buildHello(channel, helloOf(n), n.sign.privateKey), tokenFor(N_ID));

    expect(await controller.done).toBe(false);
    expect(updates.at(-1)).toEqual({ step: "failed", message: "Linking failed. If you typed the code correctly, someone may have tried to intercept it." });
    expect(server.sessions.get(active.sessionId)!.status).toBe("failed");
    expect(server.lists).toHaveLength(1);
  });
});

describe("linking as the new device", () => {
  it("shows a typed code, then adopts the identity from a correct welcome and becomes trusted", async () => {
    const session = await runAs(N_ID, n, false);
    const { onUpdate, waitFor } = collect();
    const controller = startLinkingFromNew(session, "code", onUpdate);
    const code = ((await waitFor("show-code")) as Extract<LinkUpdate, { step: "show-code" }>).code;

    // The trusted device types the code (played by hand).
    const active = (await fakeApi.getActiveLinkSession())!;
    await fakeApi.joinLinkSession(active.sessionId, tokenFor(E_ID));
    const exchange = lib.startCodeExchange({ code, userId: USER, sessionId: active.sessionId, creatorDeviceId: N_ID, joinerDeviceId: E_ID, side: "joiner" });
    await fakeApi.postLinkMessage(active.sessionId, exchange.wire, tokenFor(E_ID));
    const theirY = await nextFrom(active.sessionId, N_ID, 0);
    const channel = exchange.finish(theirY.payload);
    const helloMessage = await nextFrom(active.sessionId, N_ID, theirY.seq);
    const hello = await lib.readHello(channel, helloMessage.payload, N_ID);
    const elsewhere = (await waitFor("confirm-elsewhere")) as Extract<LinkUpdate, { step: "confirm-elsewhere" }>;
    expect(elsewhere.code).toBe(channel.confirmationCode(helloMessage.payload));

    const list = { userId: USER, version: 2, devices: [e.entry, { ...hello, addedAt: 2 }] };
    const signed = await signDeviceList(list, identity.privateKey);
    await fakeApi.publishDeviceList(signed);
    await fakeApi.postLinkMessage(active.sessionId, await lib.buildWelcome(channel, { identityPrivateKey: identity.privateKey, deviceList: signed, linkerDeviceId: E_ID, newDeviceId: N_ID }, e.sign.privateKey), tokenFor(E_ID));

    expect(await controller.done).toBe(true);
    expect(store.data.get(identityKeyStorageKey(USER))).toBe(identity.privateKey);
    expect(useE2EEStore.getState().deviceIdentityStatusByUserId[USER]).toBe("trusted");
  });

  it("refuses a welcome carrying a different identity, and keeps nothing", async () => {
    const session = await runAs(N_ID, n, false);
    const { onUpdate, waitFor, updates } = collect();
    const controller = startLinkingFromNew(session, "qr", onUpdate);
    const qr = lib.decodeLinkQr(((await waitFor("show-qr")) as Extract<LinkUpdate, { step: "show-qr" }>).qr);
    await fakeApi.joinLinkSession(qr.sessionId, tokenFor(E_ID));
    const channel = lib.LinkChannel.fromSecret(qr.secret, USER, qr.sessionId);
    await nextFrom(qr.sessionId, N_ID, 0);

    const impostor = await generateSigningKeypair();
    const fake = await signDeviceList({ userId: USER, version: 2, devices: [e.entry, { ...helloOf(n), addedAt: 2 }] }, impostor.privateKey);
    await fakeApi.postLinkMessage(qr.sessionId, await lib.buildWelcome(channel, { identityPrivateKey: impostor.privateKey, deviceList: fake, linkerDeviceId: E_ID, newDeviceId: N_ID }, e.sign.privateKey), tokenFor(E_ID));

    expect(await controller.done).toBe(false);
    expect(store.data.has(identityKeyStorageKey(USER))).toBe(false);
    expect(updates.at(-1)?.step).toBe("failed");
    expect(server.sessions.get(qr.sessionId)).toMatchObject({ status: "failed", failureReason: "key_confirmation_failed" });
  });

  it("checks the scanned code's fingerprint against the device that sends the welcome", async () => {
    const session = await runAs(N_ID, n, false);
    const { onUpdate, updates } = collect();
    const created = await fakeApi.createLinkSession({ mode: "qr", role: "existing" }, tokenFor(E_ID));
    const secret = lib.newLinkSecret();
    const qr = lib.encodeLinkQr({ v: 1, sessionId: created.sessionId, userId: USER, secret, creatorRole: "existing", creatorDeviceId: E_ID, fingerprint: lib.signingKeyFingerprint(e.sign.publicKey) });
    const controller = joinLinkingFromNew(session, { qr }, onUpdate);
    const channel = lib.LinkChannel.fromSecret(secret, USER, created.sessionId);
    await nextFrom(created.sessionId, N_ID, 0);

    // A different listed device (not the one whose code was scanned) answers.
    const other = await keysFor("66666666-6666-4666-8666-666666666666", "Old laptop");
    const signed = await signDeviceList({ userId: USER, version: 2, devices: [e.entry, other.entry, { ...helloOf(n), addedAt: 2 }] }, identity.privateKey);
    await fakeApi.postLinkMessage(created.sessionId, await lib.buildWelcome(channel, { identityPrivateKey: identity.privateKey, deviceList: signed, linkerDeviceId: other.entry.deviceId, newDeviceId: N_ID }, other.sign.privateKey), tokenFor(E_ID));

    expect(await controller.done).toBe(false);
    expect(store.data.has(identityKeyStorageKey(USER))).toBe(false);
    expect(updates.at(-1)?.step).toBe("failed");
  });
});
