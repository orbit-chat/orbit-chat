import { beforeAll, describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { CPaceAbort, CPaceParty, calculateGenerator, generatorString, lvCat, prependLen, scalarMultVfy, transcriptIr } from "../cpace";

/**
 * Pinned to draft-irtf-cfrg-cpace-21, Appendix A (string functions) and Appendix B.3
 * (CPACE-RISTR255-SHA512 test vectors). If any of these fail, the implementation no longer is
 * CPace and must not ship.
 */

const hex = (h: string) => sodium.from_hex(h.replace(/\s+/g, ""));
const toHex = (b: Uint8Array) => sodium.to_hex(b);
const text = (s: string) => new TextEncoder().encode(s);

beforeAll(async () => {
  await sodium.ready;
});

describe("string functions (Appendix A)", () => {
  it("encodes lengths as LEB128", () => {
    expect(toHex(prependLen(new Uint8Array()))).toBe("00");
    expect(toHex(prependLen(text("1234")))).toBe("0431323334");
    expect(toHex(prependLen(new Uint8Array(127))).slice(0, 2)).toBe("7f");
    const long = prependLen(new Uint8Array(128));
    expect(toHex(long.slice(0, 2))).toBe("8001");
    expect(long.length).toBe(130);
  });

  it("concatenates length-value fields", () => {
    expect(toHex(lvCat(text("1234"), text("5"), text(""), text("678")))).toBe("043132333401350003363738");
  });

  it("builds the initiator-responder transcript", () => {
    expect(toHex(transcriptIr(text("123"), text("PartyA"), text("234"), text("PartyB")))).toBe(
      "03313233065061727479410332333406506172747942"
    );
    expect(toHex(transcriptIr(text("3456"), text("PartyA"), text("2345"), text("PartyB")))).toBe(
      "043334353606506172747941043233343506506172747942"
    );
  });
});

describe("ristretto255 vectors (Appendix B.3)", () => {
  const PRS = text("Password");
  const CI = hex("0b415f696e69746961746f720b425f726573706f6e646572");
  const SID = hex("7e4b4791d6a8ef019b936c79fb7f2c57");
  const ADa = text("ADa");
  const ADb = text("ADb");
  const ya = hex("da3d23700a9e5699258aef94dc060dfda5ebb61f02a5ea77fad53f4ff0976d08");
  const yb = hex("d2316b454718c35362d83d69df6320f38578ed5984651435e2949762d900b80d");

  it("derives the generator (B.3.1)", () => {
    expect(toHex(generatorString(PRS, CI, SID))).toBe(
      "11435061636552697374726574746f3235350850617373776f726464" +
        "00".repeat(100) +
        "180b415f696e69746961746f720b425f726573706f6e646572107e4b4791d6a8ef019b936c79fb7f2c57"
    );
    expect(toHex(sodium.crypto_hash_sha512(generatorString(PRS, CI, SID)))).toBe(
      "da6d3ddc8802fca9058755ffd3ebde08a9c2c74945901a258482a288b6663af06bf645c93cd1c51512307199c80e84908916d983b34af77205f90851a657ee27"
    );
    expect(toHex(calculateGenerator(PRS, CI, SID))).toBe("222b6b195fe84b1652badb6f6a3ae3d24341e7306967f0b8115b40d5698c7e56");
  });

  it("produces both messages, the shared point and the ISK (B.3.2 to B.3.5)", () => {
    const a = new CPaceParty("initiator", { prs: PRS, ci: CI, sid: SID, ad: ADa }, ya);
    const b = new CPaceParty("responder", { prs: PRS, ci: CI, sid: SID, ad: ADb }, yb);
    expect(toHex(a.message)).toBe("d6bac480f2c386c394efc7c47adb9925dcd2630b64f240c50f8d0eec482b9157");
    expect(toHex(b.message)).toBe("3ea7e0b19560d7c0b0f5734f63b955286dfa8232b5ebe63324e2d9e7433f7258");
    expect(toHex(scalarMultVfy(ya, b.message)!)).toBe("80b69a8a76457ab6a4d7f887a4bf6b55a2f80ac19c333f917a05fc9887c8b40f");
    expect(toHex(scalarMultVfy(yb, a.message)!)).toBe("80b69a8a76457ab6a4d7f887a4bf6b55a2f80ac19c333f917a05fc9887c8b40f");

    const iskA = a.finish(b.message, ADb);
    const iskB = b.finish(a.message, ADa);
    const expected =
      "b69effbf61b51d56401c0f65601abe428de8206feaaf0e32198896dcae7b35cd2b38950a39dfd5d4a79164614c2984f7daa460b588c1e80c3fa2068af7900447";
    expect(toHex(iskA)).toBe(expected);
    expect(toHex(iskB)).toBe(expected);
  });

  it("multiplies and rejects invalid points (B.3.10, B.3.11)", () => {
    const s = hex("7cd0e075fa7955ba52c02759a6c90dbbfc10e6d40aea8d283e407d88cf538a05");
    const X = hex("2c3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c");
    expect(toHex(scalarMultVfy(s, X)!)).toBe("7c13645fe790a468f62c39beb7388e541d8405d1ade69d1778c5fe3e7f6b600e");
    // Doesn't decode to a point, and the neutral element: both must abort.
    expect(scalarMultVfy(s, hex("2b3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c"))).toBeNull();
    expect(scalarMultVfy(s, new Uint8Array(32))).toBeNull();
    expect(scalarMultVfy(s, new Uint8Array(31))).toBeNull();
  });
});

describe("using it", () => {
  const params = (prs: string, ad: string) => ({ prs: text(prs), ci: text("orbit"), sid: hex("00112233445566778899aabbccddeeff"), ad: text(ad) });

  it("agrees on a key with the same code and disagrees with a wrong one", () => {
    const a = new CPaceParty("initiator", params("K7QM2XRP", "A"));
    const b = new CPaceParty("responder", params("K7QM2XRP", "B"));
    const wrong = new CPaceParty("responder", params("K7QM2XRQ", "B"));
    const a2 = new CPaceParty("initiator", params("K7QM2XRP", "A"));
    expect(toHex(a.finish(b.message, text("B")))).toBe(toHex(b.finish(a.message, text("A"))));
    expect(toHex(a2.finish(wrong.message, text("B")))).not.toBe(toHex(wrong.finish(a2.message, text("A"))));
  });

  it("binds the parties' AD: a swapped AD gives a different key", () => {
    const a = new CPaceParty("initiator", params("K7QM2XRP", "A"));
    const b = new CPaceParty("responder", params("K7QM2XRP", "B"));
    expect(toHex(a.finish(b.message, text("B")))).not.toBe(toHex(b.finish(a.message, text("Z"))));
  });

  it("aborts on the identity point and can't be finished twice", () => {
    const a = new CPaceParty("initiator", params("x", "A"));
    expect(() => a.finish(new Uint8Array(32), text("B"))).toThrow(CPaceAbort);
    expect(() => a.finish(new Uint8Array(32), text("B"))).toThrow(/already finished/);
  });
});
