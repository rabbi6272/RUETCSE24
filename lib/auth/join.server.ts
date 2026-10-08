import "server-only";

import { signUpSchema } from "../db/students/students.schema";
import { findLegacyByEmail } from "../db/students/students.admin.repo";
import { adminAuth } from "../firebase/admin";
import { sendOobCode, maskEmail } from "./oob.server";
import { createSessionCookie } from "./session";
import { verificationContinueUrl } from "./verification.server";
import { getSeries } from "../../types/series";

/**
 * Self sign-up for a series with email + password. (Google sign-up lives in
 * `google.server.ts`; the magic link is reserved for reclaiming old profiles.)
 *
 * The account is created through Identity Toolkit `accounts:signUp`, so the
 * password goes to Google and never touches this codebase. The student is
 * signed in straight away but starts unverified: a VERIFY_EMAIL link is sent,
 * and `createProfileAction` refuses to publish a profile until it is opened.
 *
 * Unlike claim, sign-up cannot hide whether an address is registered — that
 * is inherent to any "create account" form. An address that belongs to an
 * old-directory profile is pointed at Claim instead of being told to sign in,
 * because reclaiming is only possible through the emailed link.
 */

const BASE = "https://identitytoolkit.googleapis.com/v1";

export type SignUpResult =
  | { ok: true }
  | { ok: false; error: string; code?: "claim" | "exists" };

function getApiKey(): string {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not configured");
  return key;
}

const CLAIM_MESSAGE =
  "This email has a profile from the old directory. Reclaim it with an email link instead.";

/**
 * An address with an unclaimed old-directory profile (seeded account still on
 * its pincode, or a legacy entry with no account yet). Creating a fresh account
 * for it would orphan the old profile, so these go through Claim.
 */
export async function isOldDirectoryEmail(email: string): Promise<boolean> {
  try {
    const user = await adminAuth.getUserByEmail(email);
    // An activated account is a normal account, even if its legacy row lingers.
    return user.customClaims?.mustRotate === true;
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    return (await findLegacyByEmail(email)) !== null;
  }
}

export async function signUpWithPassword(
  seriesId: string,
  rawEmail: string,
  password: string,
): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse({ series: seriesId, email: rawEmail, password });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const { email } = parsed.data;
  const entry = getSeries(parsed.data.series);
  if (!entry || entry.status !== "open") {
    console.log(`[auth] signup ${maskEmail(email)} -> series-${parsed.data.series}-closed`);
    return { ok: false, error: "This series is not accepting new accounts." };
  }

  if (await isOldDirectoryEmail(email)) {
    console.log(`[auth] signup ${maskEmail(email)} -> old-directory (sent to claim)`);
    return { ok: false, code: "claim", error: CLAIM_MESSAGE };
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}/accounts:signUp?key=${getApiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: parsed.data.password, returnSecureToken: true }),
      cache: "no-store",
    });
  } catch (error) {
    console.error("[auth] signup request failed", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const data = (await response.json().catch(() => ({}))) as {
    idToken?: string;
    error?: { message?: string };
  };

  if (!response.ok || !data.idToken) {
    const code = data.error?.message ?? "UNKNOWN";

    if (code.startsWith("EMAIL_EXISTS")) {
      console.log(`[auth] signup ${maskEmail(email)} -> exists`);
      return {
        ok: false,
        code: "exists",
        error: "An account with this email already exists. Sign in or reset your password.",
      };
    }

    if (code.startsWith("WEAK_PASSWORD")) {
      return { ok: false, error: "Choose a stronger password." };
    }

    console.error(`[auth] signup ${maskEmail(email)} -> ${code}`);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  await createSessionCookie(data.idToken);

  // Best effort: the profile form offers a resend if this one goes missing.
  await sendOobCode({
    requestType: "VERIFY_EMAIL",
    email,
    idToken: data.idToken,
    continueUrl: verificationContinueUrl(),
  }).catch(() => undefined);

  console.log(`[auth] signup ${maskEmail(email)} series=${entry.id} -> ok`);
  return { ok: true };
}
