import "server-only";

import crypto from "crypto";

/**
 * Small HMAC token helper for the one flow that still needs a server-signed
 * token: claiming a legacy profile. Routine password resets use
 * `sendPasswordResetEmail` and never come through here.
 *
 * Codes are never stored in a token. The token only proves "this challenge was
 * issued by this server for this email", so a leaked token is useless without
 * the code, which lives in a Firestore counter doc.
 */

export function getTokenSecret(): string {
  const secret = process.env.OTP_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("OTP_SECRET is not configured or is too short (min 32 chars)");
  }

  return secret;
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function signToken(payload: Record<string, unknown>, ttlMs: number): string {
  const body = JSON.stringify({ ...payload, exp: Date.now() + ttlMs });
  const encoded = Buffer.from(body, "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", getTokenSecret())
    .update(encoded)
    .digest("hex");

  return `${encoded}.${signature}`;
}

export function verifyToken<T>(token: string): T | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;
  const expected = crypto
    .createHmac("sha256", getTokenSecret())
    .update(encoded)
    .digest("hex");

  if (!timingSafeEqualHex(signature, expected)) return null;

  let payload: T & { exp?: number };
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;

  return payload;
}

/** Derives a stable, non-reversible document id from a value. */
export function hashKey(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export const OTP_TTL_MS = 5 * 60 * 1000;
export const CLAIM_TICKET_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
