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

  it("lets only the USB test build use plain HTTP, and only to this phone's loopback address", () => {
    const local = { api: "http://localhost:3000", socket: "http://127.0.0.1:3000" };
    expect(insecureServerProblem(true, local, false)).toMatch(/server address/);
    expect(insecureServerProblem(true, local, true)).toBeNull();
    expect(insecureServerProblem(true, { api: "http://[::1]:3000", socket: "ws://localhost:3000" }, true)).toBeNull();
    // Anything that leaves the phone still needs TLS, even in that build.
    expect(insecureServerProblem(true, { api: "http://192.168.1.20:3000", socket: "https://chat.example" }, true)).toMatch(/server address/);
    expect(insecureServerProblem(true, { api: "http://localhost.evil.example", socket: "https://chat.example" }, true)).toMatch(/server address/);
    expect(insecureServerProblem(true, { api: "https://chat.example", socket: "ws://10.0.2.2:3000" }, true)).toMatch(/realtime address/);
  });

  it("accepts HTTPS and WSS on mobile", () => {
    expect(insecureServerProblem(true, { api: "https://chat.example", socket: "wss://chat.example" })).toBeNull();
    expect(insecureServerProblem(true, { api: "https://chat.example", socket: "https://chat.example" })).toBeNull();
  });
});
