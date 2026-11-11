// Fallback until production has a TLS endpoint. Mobile builds can't use it: iOS App Transport
// Security and Android's cleartext policy both block plain HTTP (see docs/mobile-plan.md).
const DEFAULT_SERVER_URL = "http://147.135.31.128:3000";

export function normalizeBaseUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  const fixedPort = trimmed.replace(/\/:(\d+)/, ":$1");
  return fixedPort.replace(/\/$/, "");
}

export const API_BASE = normalizeBaseUrl(import.meta.env.VITE_API_URL ?? DEFAULT_SERVER_URL);
export const SOCKET_URL = normalizeBaseUrl(import.meta.env.VITE_SOCKET_URL ?? DEFAULT_SERVER_URL);

/**
 * Why this build can't talk to its server safely, or null. Mobile builds require TLS (B3): iOS and
 * Android block cleartext anyway, and tokens and message metadata must never travel unencrypted.
 * Desktop keeps working against the plain-HTTP fallback until production has a TLS endpoint.
 */
export function insecureServerProblem(mobile: boolean, urls: { api: string; socket: string } = { api: API_BASE, socket: SOCKET_URL }) {
  if (!mobile) return null;
  const secure = (url: string, schemes: string[]) => {
    try {
      return schemes.includes(new URL(url).protocol);
    } catch {
      return false;
    }
  };
  if (!secure(urls.api, ["https:"])) return `This build's server address (${urls.api}) doesn't use HTTPS, so it can't be used on a phone.`;
  if (!secure(urls.socket, ["https:", "wss:"])) return `This build's realtime address (${urls.socket}) doesn't use HTTPS, so it can't be used on a phone.`;
  return null;
}
