import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { adminAuth } from "../firebase/admin";
import type { SessionUser } from "../../types/Student";

const SESSION_COOKIE = "__session";
const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

/**
 * Firebase session cookies are the documented Next.js pattern: the browser
 * never holds a refresh token, and server components can read the session
 * without a round trip to the client SDK.
 */
export async function createSessionCookie(idToken: string): Promise<void> {
  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * `cache` dedupes this per request, so a page that reads the session in both
 * the layout and a component still performs one verification.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;

  if (!sessionCookie) return null;

  try {
    // `checkRevoked: true` means a password change or sign-out everywhere
    // invalidates the cookie instead of it lingering until expiry.
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);

    return {
      uid: decoded.uid,
      email: decoded.email ?? "",
      emailVerified: decoded.email_verified ?? false,
      // Compared against `true` rather than coerced, so a claim that is absent,
      // null, or a string can never be read as "rotation already done". A
      // student stays gated until the claim is explicitly cleared.
      mustRotate: (decoded as { mustRotate?: unknown }).mustRotate === true,
      needsSection: (decoded as { needsSection?: unknown }).needsSection === true,
    };
  } catch {
    // Expired, tampered with, or revoked. Treat as signed out.
    return null;
  }
});

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();

  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }

  return session;
}
