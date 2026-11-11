import { describe, expect, it } from "vitest";
import { insecureServerProblem } from "../serverConfig";

describe("insecureServerProblem", () => {
  it("lets desktop use the plain-HTTP fallback", () => {
    expect(insecureServerProblem(false, { api: "http://147.135.31.128:3000", socket: "http://147.135.31.128:3000" })).toBeNull();
  });

  it("refuses non-TLS server addresses on mobile", () => {
    expect(insecureServerProblem(true, { api: "http://147.135.31.128:3000", socket: "https://chat.example" })).toMatch(/server address/);
    expect(insecureServerProblem(true, { api: "https://chat.example", socket: "ws://chat.example" })).toMatch(/realtime address/);
    expect(insecureServerProblem(true, { api: "not a url", socket: "https://chat.example" })).toMatch(/server address/);
  });

  it("accepts HTTPS and WSS on mobile", () => {
    expect(insecureServerProblem(true, { api: "https://chat.example", socket: "wss://chat.example" })).toBeNull();
    expect(insecureServerProblem(true, { api: "https://chat.example", socket: "https://chat.example" })).toBeNull();
  });
});
