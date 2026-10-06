import "server-only";

import { adminAuth } from "../firebase/admin";
import { sendOobCode, maskEmail } from "./oob.server";
import { getSession } from "./session";

/**
 * Email verification, server-side.
 *
 * The session cookie's `emailVerified` claim is frozen at sign-in time, so
 * anything security-relevant asks `freshEmailVerified` instead: a live Admin
 * SDK read that reflects a verification completed after the cookie was minted
 * (the magic-link flows mark accounts verified without re-signing anyone in).
 *
 * Resending is the one operation that needs a *current* idToken for the
 * session's user, and the server never holds a password or refresh token for
 * them. It mints one the supported way: a custom token, exchanged over
 * Identity Toolkit — no credential of the user's is ever involved.
 */

const BASE = "https://identitytoolkit.googleapis.com/v1";

function getApiKey(): string {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not configured");
  return key;
}

function verificationContinueUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://ruetcsearchive.app"
      : "http://localhost:3000");
  return `${base.replace(/\/+$/, "")}/profiles/create`;
}

/** Live verification state — never the cookie claim. */
export async function freshEmailVerified(uid: string): Promise<boolean> {
  try {
    const user = await adminAuth.getUser(uid);
    return user.emailVerified;
  } catch (error) {
    console.error("[auth] fresh email verification check failed", error);
    return false;
  }
}

/**
 * Exchanges a freshly minted custom token for an idToken, then issues the
 * VERIFY_EMAIL link. Session-bound: the caller must already be signed in.
 */
export async function resendVerification(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "Sign in to resend the verification email." };
  }
  if (session.emailVerified || (await freshEmailVerified(session.uid))) {
    console.log(`[auth] verify-resend ${maskEmail(session.email)} -> already-verified`);
    return { ok: true };
  }

  try {
    const customToken = await adminAuth.createCustomToken(session.uid);

    const exchange = await fetch(
      `${BASE}/accounts:signInWithCustomToken?key=${getApiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        cache: "no-store",
      },
    );
    const data = (await exchange.json().catch(() => ({}))) as {
      idToken?: string;
      error?: { message?: string };
    };

    if (!exchange.ok || !data.idToken) {
      console.error(
        "[auth] verification token exchange failed",
        data.error?.message ?? exchange.status,
      );
      return { ok: false, error: "Something went wrong. Please try again." };
    }

    const sent = await sendOobCode({
      requestType: "VERIFY_EMAIL",
      email: session.email,
      idToken: data.idToken,
      continueUrl: verificationContinueUrl(),
    });

    if (!sent.ok) {
      return { ok: false, error: "Something went wrong. Please try again." };
    }

    console.log(`[auth] verify-resend ${maskEmail(session.email)} -> ok`);
    return { ok: true };
  } catch (error) {
    console.error("[auth] resend verification failed", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
