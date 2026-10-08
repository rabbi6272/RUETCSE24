import "server-only";

import { adminAuth } from "../firebase/admin";
import { changePasswordSchema, loginSchema } from "../db/students/students.schema";
import { removeProfile } from "../db/students/students.admin.repo";
import { sendOobCode, maskEmail } from "./oob.server";
import { clearSessionCookie, createSessionCookie, getSession } from "./session";
import { verifyPassword } from "./verify-password.server";
import { verificationContinueUrl } from "./verification.server";

/**
 * Password and account lifecycle.
 *
 * There is no application-level password verification anywhere in this file.
 * Every check goes to Firebase, which is also the only thing that stores the
 * credential, so there is one hashing implementation, one salt policy, and one
 * set of brute-force protections.
 */

type Result<T> = { ok: true } & T | { ok: false; error: string };
/** `code: "claim"` → the account is an unclaimed old-directory profile. */
export type SignInResult =
  | { ok: true; email: string; emailVerified: boolean }
  | { ok: false; error: string; code?: "claim" };
type PlainResult = { ok: true } | { ok: false; error: string };

const SIGN_IN_FAILED = "Incorrect email or password.";
const GENERIC_RESET_MESSAGE =
  "If an account exists for that email, we've sent a password reset link to it.";

export async function signIn(
  rawEmail: string,
  rawPassword: string,
): Promise<SignInResult> {
  const parsed = loginSchema.safeParse({ email: rawEmail, password: rawPassword });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const verified = await verifyPassword(email, parsed.data.password);

  if (!verified.ok) {
    console.log(`[auth] signin ${maskEmail(email)} -> bad-password`);
    return { ok: false, error: SIGN_IN_FAILED };
  }

  try {
    await createSessionCookie(verified.idToken);

    const session = await getSession();

    if (!session) {
      await clearSessionCookie();
      console.log(`[auth] signin ${maskEmail(email)} -> no-session`);
      return { ok: false, error: SIGN_IN_FAILED };
    }

    // A seeded account still on its old (publicly readable) pincode: knowing
    // the pincode proves nothing, so no session. Reclaiming goes through the
    // Claim email link only.
    if (session.mustRotate) {
      await clearSessionCookie();
      console.log(`[auth] signin ${maskEmail(email)} -> needs-claim`);
      return {
        ok: false,
        code: "claim",
        error: "This account is from the old directory. Reclaim it with an email link.",
      };
    }

    // Every sign-in by an unverified account re-sends the verification link.
    // The idToken minted for this very attempt is what sendOobCode needs, so
    // delivery has no separate endpoint or credential. Failures stay silent:
    // the caller only needs to know sign-in worked.
    if (!session.emailVerified) {
      await sendOobCode({
        requestType: "VERIFY_EMAIL",
        email: session.email,
        idToken: verified.idToken,
        continueUrl: verificationContinueUrl(),
      });
    }

    console.log(`[auth] signin ${maskEmail(email)} -> ok verified=${session.emailVerified}`);
    return { ok: true, email: session.email, emailVerified: session.emailVerified };
  } catch (error) {
    console.error("[auth] session creation failed", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function requestPasswordReset(rawEmail: string): Promise<PlainResult> {
  const email = rawEmail.trim().toLowerCase();

  if (!email) {
    return { ok: false, error: "Enter your email address." };
  }

  // Firebase sends the email itself; this only issues the link. An unknown
  // address returns the same generic success as a known one, so the endpoint
  // cannot be used to enumerate accounts.
  const sent = await sendOobCode({ requestType: "PASSWORD_RESET", email });

  if (sent.ok) return { ok: true };

  if (sent.code.includes("EMAIL_NOT_FOUND")) return { ok: true };

  console.error("password reset failed", email, sent.code);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<PlainResult> {
  const session = await getSession();

  if (!session) {
    return { ok: false, error: "Sign in again to continue." };
  }

  const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  // Re-authenticate before allowing a credential change, so a stolen cookie
  // alone is not enough to take the account over.
  const verified = await verifyPassword(session.email, parsed.data.currentPassword);

  if (!verified.ok) {
    console.log(`[auth] password-change ${maskEmail(session.email)} -> bad-current-password`);
    return { ok: false, error: "Your current password is incorrect." };
  }

  try {
    await adminAuth.updateUser(session.uid, { password: parsed.data.newPassword });
    // Revoking refresh tokens invalidates every existing session, including
    // this one, so other devices are signed out too.
    await adminAuth.revokeRefreshTokens(session.uid);
  } catch (error) {
    console.error("[auth] password change failed", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  console.log(`[auth] password-change ${maskEmail(session.email)} -> ok (all sessions revoked)`);
  await clearSessionCookie();
  return { ok: true };
}

export async function deleteAccount(currentPassword: string): Promise<PlainResult> {
  const session = await getSession();

  if (!session) {
    return { ok: false, error: "Sign in again to continue." };
  }

  if (!currentPassword) {
    return { ok: false, error: "Enter your password to confirm." };
  }

  const verified = await verifyPassword(session.email, currentPassword);

  if (!verified.ok) {
    console.log(`[auth] account-delete ${maskEmail(session.email)} -> bad-password`);
    return { ok: false, error: "Your password is incorrect." };
  }

  try {
    await removeProfile(session.uid);
    await adminAuth.deleteUser(session.uid);
  } catch (error) {
    console.error("[auth] account deletion failed", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  console.log(`[auth] account-delete ${maskEmail(session.email)} -> ok (profile+auth removed)`);
  await clearSessionCookie();
  return { ok: true };
}

export async function signOut(): Promise<PlainResult> {
  await clearSessionCookie();
  console.log("[auth] sign-out -> ok (cookie cleared)");
  return { ok: true };
}
