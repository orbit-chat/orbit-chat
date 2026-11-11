import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { generateKeypair } from "../crypto";
import { generateSigningKeypair, signDeviceList, type DeviceListEntry } from "../deviceTrust";
import {
  LinkChannel,
  LinkProtocolError,
  buildHello,
  buildWelcome,
  decodeLinkQr,
  encodeLinkQr,
  formatLinkCode,
  generateLinkCode,
  newLinkSecret,
  normalizeLinkCode,
  readHello,
  readWelcome,
  signingKeyFingerprint,
  startCodeExchange,
  wireType,
  type LinkHello,
} from "../deviceLinking";

/**
 * Device linking (mobile plan B7). The relay in between is the attacker: it can drop, replay,
 * reorder, reflect or forge messages, and run its own key exchange with each side. None of that
 * may get a device onto the list, or a different identity onto the new device.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const OTHER_SESSION = "33333333-3333-4333-8333-333333333333";
const E_DEVICE = "44444444-4444-4444-8444-444444444444";
const N_DEVICE = "55555555-5555-4555-8555-555555555555";

type Device = { entry: DeviceListEntry; signPrivate: string };
async function device(deviceId: string, name: string): Promise<Device> {
  const enc = await generateKeypair();
  const sign = await generateSigningKeypair();
  return { entry: { deviceId, encryptionPublicKey: enc.publicKey, signingPublicKey: sign.publicKey, name, addedAt: 1 }, signPrivate: sign.privateKey };
}
const helloOf = (d: Device): LinkHello => ({
  deviceId: d.entry.deviceId,
  encryptionPublicKey: d.entry.encryptionPublicKey,
  signingPublicKey: d.entry.signingPublicKey,
  name: d.entry.name,
});

let e: Device;
let n: Device;
let identity: { publicKey: string; privateKey: string };
let secret: string;

beforeAll(async () => {
  await sodium.ready;
});

beforeEach(async () => {
  e = await device(E_DEVICE, "Orbit Desktop");
  n = await device(N_DEVICE, "Orbit iOS");
  identity = await generateSigningKeypair();
  secret = newLinkSecret();
});

describe("typed codes", () => {
  it("generates 8 Crockford characters and forgives how people type them", () => {
    for (let i = 0; i < 50; i += 1) expect(generateLinkCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(normalizeLinkCode("k7qm-2xrp")).toBe("K7QM2XRP");
    expect(normalizeLinkCode(" K7QM 2XRP ")).toBe("K7QM2XRP");
    expect(normalizeLinkCode("OIL00000")).toBe("01100000");
    expect(normalizeLinkCode("K7QM2XRU")).toBeNull();
    expect(normalizeLinkCode("K7QM2XR")).toBeNull();
    expect(formatLinkCode("K7QM2XRP")).toBe("K7QM-2XRP");
  });
});

describe("QR codes", () => {
  it("round-trips and rejects anything else", () => {
    const payload = { v: 1 as const, sessionId: SESSION, userId: USER, secret, creatorRole: "existing" as const, creatorDeviceId: E_DEVICE, fingerprint: "abc" };
    expect(decodeLinkQr(encodeLinkQr(payload))).toEqual(payload);
    expect(() => decodeLinkQr("https://example.com")).toThrow(LinkProtocolError);
    expect(() => decodeLinkQr(encodeLinkQr({ ...payload, secret: "c2hvcnQ" }))).toThrow(/damaged/);
    expect(() => decodeLinkQr(encodeLinkQr({ ...payload, sessionId: "not-a-uuid" }))).toThrow(/damaged/);
    expect(() => decodeLinkQr("orbit-link:!!!")).toThrow(LinkProtocolError);
  });
});

describe("the channel", () => {
  it("opens only with the same secret, session, direction and step", () => {
    const sender = LinkChannel.fromSecret(secret, USER, SESSION);
    const wire = sender.seal("n2e", "hello", new TextEncoder().encode("hi"));
    expect(wireType(wire)).toBe("hello");
    expect(new TextDecoder().decode(LinkChannel.fromSecret(secret, USER, SESSION).open("n2e", "hello", wire))).toBe("hi");

    expect(() => LinkChannel.fromSecret(newLinkSecret(), USER, SESSION).open("n2e", "hello", wire)).toThrow(/authentication/);
    expect(() => LinkChannel.fromSecret(secret, USER, OTHER_SESSION).open("n2e", "hello", wire)).toThrow(/authentication/);
    // Reflected back at its sender, or passed off as another step.
    expect(() => sender.open("e2n", "hello", wire)).toThrow(/authentication/);
    expect(() => sender.open("n2e", "welcome", wire)).toThrow(/Expected a welcome/);

    const bytes = sodium.from_base64(wire, sodium.base64_variants.URLSAFE_NO_PADDING);
    bytes[bytes.length - 1]! ^= 1;
    expect(() => sender.open("n2e", "hello", sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING))).toThrow(/authentication/);
  });

  it("shows the same confirmation code on both sides, tied to the exact hello", async () => {
    const a = LinkChannel.fromSecret(secret, USER, SESSION);
    const b = LinkChannel.fromSecret(secret, USER, SESSION);
    const hello = await buildHello(a, helloOf(n), n.signPrivate);
    expect(a.confirmationCode(hello)).toMatch(/^\d{6}$/);
    expect(b.confirmationCode(hello)).toBe(a.confirmationCode(hello));
    expect(a.confirmationCode(await buildHello(a, helloOf(n), n.signPrivate))).not.toBe(a.confirmationCode(hello));
  });
});

describe("typed mode (CPace)", () => {
  const exchange = (code: string, side: "creator" | "joiner") =>
    startCodeExchange({ code, userId: USER, sessionId: SESSION, creatorDeviceId: E_DEVICE, joinerDeviceId: N_DEVICE, side });

  it("gives both sides the same channel when the code matches", () => {
    const creator = exchange("K7QM-2XRP", "creator");
    const joiner = exchange("k7qm2xrp", "joiner");
    const creatorChannel = creator.finish(joiner.wire);
    const joinerChannel = joiner.finish(creator.wire);
    const wire = joinerChannel.seal("n2e", "hello", new Uint8Array([1, 2, 3]));
    expect([...creatorChannel.open("n2e", "hello", wire)]).toEqual([1, 2, 3]);
  });

  it("fails the first message when the code was mistyped", () => {
    const creator = exchange("K7QM2XRP", "creator");
    const joiner = exchange("K7QM2XRQ", "joiner");
    const wire = joiner.finish(creator.wire).seal("n2e", "hello", new Uint8Array([1]));
    expect(() => creator.finish(joiner.wire).open("n2e", "hello", wire)).toThrow(LinkProtocolError);
  });

  it("gives a relay that runs its own exchange with each side nothing without the code", () => {
    const creator = exchange("K7QM2XRP", "creator");
    const joiner = exchange("K7QM2XRP", "joiner");
    // The relay guesses a code and plays the joiner to the creator and the creator to the joiner.
    const fakeJoiner = exchange("AAAAAAAA", "joiner");
    const fakeCreator = exchange("AAAAAAAA", "creator");
    const creatorChannel = creator.finish(fakeJoiner.wire);
    const joinerChannel = joiner.finish(fakeCreator.wire);
    const relayToCreator = fakeJoiner.finish(creator.wire);
    const forged = relayToCreator.seal("n2e", "hello", new Uint8Array([9]));
    expect(() => creatorChannel.open("n2e", "hello", forged)).toThrow(LinkProtocolError);
    // Nor can it read the real device's message, or pass it on to the creator.
    const real = joinerChannel.seal("n2e", "hello", new Uint8Array([1]));
    expect(() => fakeCreator.finish(joiner.wire).open("n2e", "hello", real)).toThrow(LinkProtocolError);
    expect(() => creatorChannel.open("n2e", "hello", real)).toThrow(LinkProtocolError);
  });

  it("rejects an invalid exchange message", () => {
    const creator = exchange("K7QM2XRP", "creator");
    const identityPoint = sodium.to_base64(new Uint8Array([5, 99, 112, 97, 99, 101, 32, ...new Uint8Array(32)]), sodium.base64_variants.URLSAFE_NO_PADDING);
    expect(() => creator.finish(identityPoint)).toThrow(LinkProtocolError);
  });
});

describe("hello", () => {
  it("is accepted from the device the session names, holding its signing key", async () => {
    const channel = LinkChannel.fromSecret(secret, USER, SESSION);
    const wire = await buildHello(channel, helloOf(n), n.signPrivate);
    expect(await readHello(channel, wire, N_DEVICE)).toEqual(helloOf(n));
  });

  it("is refused from another device, with a forged proof, or from another session", async () => {
    const channel = LinkChannel.fromSecret(secret, USER, SESSION);
    const wire = await buildHello(channel, helloOf(n), n.signPrivate);
    await expect(readHello(channel, wire, E_DEVICE)).rejects.toThrow(/different device/);

    const forged = await buildHello(channel, helloOf(n), e.signPrivate);
    await expect(readHello(channel, forged, N_DEVICE)).rejects.toThrow(/prove/);

    const elsewhere = await buildHello(LinkChannel.fromSecret(secret, USER, OTHER_SESSION), helloOf(n), n.signPrivate);
    await expect(readHello(channel, elsewhere, N_DEVICE)).rejects.toThrow(/authentication/);
  });
});

describe("welcome", () => {
  async function listWith(devices: DeviceListEntry[], version = 2, signer = identity) {
    return signDeviceList({ userId: USER, version, devices }, signer.privateKey);
  }
  const expectedFor = (overrides: Partial<Parameters<typeof readWelcome>[2]> = {}) => ({
    me: helloOf(n),
    accountIdentityKey: identity.publicKey,
    minListVersion: 0,
    linkerFingerprint: signingKeyFingerprint(e.entry.signingPublicKey),
    ...overrides,
  });

  it("hands over the identity and a list naming this device", async () => {
    const channel = LinkChannel.fromSecret(secret, USER, SESSION);
    const deviceList = await listWith([e.entry, n.entry]);
    const wire = await buildWelcome(channel, { identityPrivateKey: identity.privateKey, deviceList, linkerDeviceId: E_DEVICE, newDeviceId: N_DEVICE }, e.signPrivate);
    const result = await readWelcome(channel, wire, expectedFor());
    expect(result.identityPrivateKey).toBe(identity.privateKey);
    expect(result.list.devices.map((d) => d.deviceId).sort()).toEqual([E_DEVICE, N_DEVICE].sort());
  });

  it("refuses an identity that isn't the account's", async () => {
    const channel = LinkChannel.fromSecret(secret, USER, SESSION);
    const impostor = await generateSigningKeypair();
    const deviceList = await listWith([e.entry, n.entry], 2, impostor);
    const wire = await buildWelcome(channel, { identityPrivateKey: impostor.privateKey, deviceList, linkerDeviceId: E_DEVICE, newDeviceId: N_DEVICE }, e.signPrivate);
    await expect(readWelcome(channel, wire, expectedFor())).rejects.toThrow(/isn't your account's/);
  });

  it("refuses a list that is old, leaves this device out, or lists it with other keys", async () => {
    const channel = LinkChannel.fromSecret(secret, USER, SESSION);
    const send = async (devices: DeviceListEntry[], version = 2) =>
      buildWelcome(channel, { identityPrivateKey: identity.privateKey, deviceList: await listWith(devices, version), linkerDeviceId: E_DEVICE, newDeviceId: N_DEVICE }, e.signPrivate);

    await expect(readWelcome(channel, await send([e.entry, n.entry], 2), expectedFor({ minListVersion: 3 }))).rejects.toThrow(/doesn't verify/);
    await expect(readWelcome(channel, await send([e.entry]), expectedFor())).rejects.toThrow(/doesn't include this device/);
    const swapped = { ...n.entry, encryptionPublicKey: (await generateKeypair()).publicKey };
    await expect(readWelcome(channel, await send([e.entry, swapped]), expectedFor())).rejects.toThrow(/doesn't include this device/);
  });

  it("refuses a welcome not signed by a listed linking device, or not the one in the QR", async () => {
    const channel = LinkChannel.fromSecret(secret, USER, SESSION);
    const other = await device("66666666-6666-4666-8666-666666666666", "Old laptop");
    const deviceList = await listWith([e.entry, n.entry, other.entry]);
    const build = (signer: string, linker = E_DEVICE) =>
      buildWelcome(channel, { identityPrivateKey: identity.privateKey, deviceList, linkerDeviceId: linker, newDeviceId: N_DEVICE }, signer);

    await expect(readWelcome(channel, await build(other.signPrivate), expectedFor())).rejects.toThrow(/signature is invalid/);
    await expect(readWelcome(channel, await build(other.signPrivate, other.entry.deviceId), expectedFor())).rejects.toThrow(/isn't the one whose code you scanned/);
    // Without a fingerprint (the new device showed the code), any listed device's valid signature is accepted.
    await expect(readWelcome(channel, await build(other.signPrivate, other.entry.deviceId), expectedFor({ linkerFingerprint: undefined }))).resolves.toBeTruthy();
    await expect(readWelcome(channel, await build(n.signPrivate, N_DEVICE), expectedFor({ linkerFingerprint: undefined }))).rejects.toThrow(/isn't on your device list/);
  });

  it("refuses a welcome from another session or in the wrong direction", async () => {
    const deviceList = await listWith([e.entry, n.entry]);
    const params = { identityPrivateKey: identity.privateKey, deviceList, linkerDeviceId: E_DEVICE, newDeviceId: N_DEVICE };
    const elsewhere = await buildWelcome(LinkChannel.fromSecret(secret, USER, OTHER_SESSION), params, e.signPrivate);
    const channel = LinkChannel.fromSecret(secret, USER, SESSION);
    await expect(readWelcome(channel, elsewhere, expectedFor())).rejects.toThrow(/authentication/);
  });
});
