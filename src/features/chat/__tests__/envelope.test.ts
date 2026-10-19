import { describe, expect, it } from "vitest";
import { encryptMessage, generateSecretKey } from "../../../lib/crypto";
import { decryptEnvelope, parseEnvelope, safeHttpsUrl, searchableText } from "../envelope";

const file = { kind: "file", mediaId: "m1", name: "notes.pdf", mimeType: "application/pdf", size: 10, fileKeyCiphertext: "c", fileKeyNonce: "n", chunkSize: 1, chunkCount: 1 };

describe("parseEnvelope", () => {
  it("reads JSON envelopes", () => {
    expect(parseEnvelope(JSON.stringify({ text: "hi", attachments: [file] }))).toEqual({ text: "hi", attachments: [file] });
  });

  it("treats bare text from older clients as text", () => {
    expect(parseEnvelope("just words")).toEqual({ text: "just words", attachments: [] });
    expect(parseEnvelope("42")).toEqual({ text: "42", attachments: [] });
    expect(parseEnvelope("[1,2]")).toEqual({ text: "[1,2]", attachments: [] });
  });

  it("drops attachments that don't have the expected shape", () => {
    const parsed = parseEnvelope(
      JSON.stringify({ text: 5, attachments: [file, { kind: "file" }, { kind: "gif_link" }, { kind: "gif_link", url: "https://x" }, "junk", null] })
    );
    expect(parsed.text).toBe("");
    expect(parsed.attachments).toEqual([file, { kind: "gif_link", url: "https://x" }]);
  });
});

describe("decryptEnvelope", () => {
  it("round-trips with the conversation key and rejects the wrong one", async () => {
    const key = await generateSecretKey();
    const { cipherText, nonce } = await encryptMessage(JSON.stringify({ text: "secret" }), key);
    expect(await decryptEnvelope(cipherText, nonce, key)).toEqual({ text: "secret", attachments: [] });
    await expect(decryptEnvelope(cipherText, nonce, await generateSecretKey())).rejects.toThrow();
  });
});

it("searchableText joins text with attachment names and GIF titles", () => {
  expect(searchableText({ text: " hello ", attachments: [file as never, { kind: "gif_link", url: "https://g", title: "party" }] })).toBe(
    "hello notes.pdf party"
  );
});

it("safeHttpsUrl only allows https", () => {
  expect(safeHttpsUrl("https://example.com/a")).toBe("https://example.com/a");
  expect(safeHttpsUrl("http://example.com")).toBeNull();
  expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
  expect(safeHttpsUrl("not a url")).toBeNull();
  expect(safeHttpsUrl(undefined)).toBeNull();
});
