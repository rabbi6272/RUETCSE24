import "server-only";

import { adminAuth } from "../firebase/admin";
import { changePasswordSchema, loginSchema } from "../db/students/students.schema";
import { removeProfile } from "../db/students/students.admin.repo";
import { sendOobCode } from "./oob.server";
import { clearSessionCookie, createSessionCookie, getSession } from "./session";
import { verifyPassword } from "./verify-password.server";

/**
 * Password and account lifecycle.
 *
 * There is no application-level password verification anywhere in this file.
 * Every check goes to Firebase, which is also the only thing that stores the
 * credential, so there is one hashing implementation, one salt policy, and one
 * set of brute-force protections.
 */

type Result<T> = { ok: true } & T | { ok: false; error: string };
type PlainResult = { ok: true } | { ok: false; error: string };

const SIGN_IN_FAILED = "Incorrect email or password.";
const GENERIC_RESET_MESSAGE =
  "If an account exists for that email, we've sent a password reset link to it.";

export async function signIn(
  rawEmail: string,
  rawPassword: string,
): Promise<
  Result<{ email: string; emailVerified: boolean; mustRotate: boolean; needsSection: boolean }>
> {
  const parsed = loginSchema.safeParse({ email: rawEmail, password: rawPassword });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const verified = await verifyPassword(email, parsed.data.password);

  if (!verified.ok) {
    return { ok: false, error: SIGN_IN_FAILED };
  }

  try {
    await createSessionCookie(verified.idToken);

    const session = await getSession();

    if (!session) {
      await clearSessionCookie();
      return { ok: false, error: SIGN_IN_FAILED };
    }

    // Every sign-in by an unverified account re-sends the verification link.
    // The idToken minted for this very attempt is what sendOobCode needs, so
    // delivery has no separate endpoint or credential. Failures stay silent:
    // the caller only needs to know sign-in worked.
    if (!session.emailVerified) {
      const sent = await sendOobCode({
        requestType: "VERIFY_EMAIL",
        email: session.email,
        idToken: verified.idToken,
        continueUrl: `${(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "")}/profiles/create`,
      });
      if (!sent.ok) console.error("verification email on sign-in failed", sent.code);
    }

    // The claims ride along on the freshly minted session cookie, so the client
    // can send a student straight to the rotation form instead of letting them
    // edit a profile while still on a publicly known password.
    return {
      ok: true,
      email: session.email,
      emailVerified: session.emailVerified,
      mustRotate: session.mustRotate,
      needsSection: session.needsSection,
    };
  } catch (error) {
    console.error("session creation failed", error);
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
    return { ok: false, error: "Your current password is incorrect." };
  }

  try {
    await adminAuth.updateUser(session.uid, { password: parsed.data.newPassword });
    // Revoking refresh tokens invalidates every existing session, including
    // this one, so other devices are signed out too.
    await adminAuth.revokeRefreshTokens(session.uid);
  } catch (error) {
    console.error("password change failed", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

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
    return { ok: false, error: "Your password is incorrect." };
  }

  try {
    await removeProfile(session.uid);
    await adminAuth.deleteUser(session.uid);
  } catch (error) {
    console.error("account deletion failed", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  await clearSessionCookie();
  return { ok: true };
}

export async function signOut(): Promise<PlainResult> {
  await clearSessionCookie();
  return { ok: true };
}
