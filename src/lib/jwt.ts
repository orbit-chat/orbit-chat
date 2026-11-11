/** Decode a JWT's payload without verifying it. Client-side hints only (expiry, device ID). */
export function decodeJwtPayload(jwt: string): { exp?: number; deviceId?: string; sub?: string } | null {
  try {
    const base64 = jwt.split(".")[1];
    if (!base64) return null;
    return JSON.parse(atob(base64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

/** The server's Device row ID for this session, from the access token. */
export function deviceIdFromToken(jwt: string) {
  const deviceId = decodeJwtPayload(jwt)?.deviceId;
  return typeof deviceId === "string" && deviceId ? deviceId : null;
}
