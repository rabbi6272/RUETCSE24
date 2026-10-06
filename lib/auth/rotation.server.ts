import "server-only";

import { adminAuth } from "../firebase/admin";
import { patchProfile } from "../db/students/students.admin.repo";
import { passwordSchema, sectionSchema } from "../db/students/students.schema";
import { clearSessionCookie, getSession } from "./session";
import { verifyPassword } from "./verify-password.server";

type PlainResult = { ok: true } | { ok: false; error: string };

/**
 * One-time replacement of a seeded bootstrap password.
 *
 * Every migrated account signs in with the pincode that used to be world
 * readable, so the pincode is treated as compromised from the moment it becomes
 * a credential. This is where that credential is destroyed.
 *
 * The operations are ordered so that the retryable failures happen first:
 * the profile write is idempotent and cannot invalidate the old password, so a
 * failure there leaves the student able to try again. The password is written
 * next, and only once that succeeds are the `mustRotate` claims cleared. If
 * clearing the claims were to fail the student would be left unable to prove
 * which password is current, so that window is closed by the password-reset
 * flow, which is linked from the rotation form.
 */
export async function completePasswordRotation(input: {
  currentPassword: string;
  newPassword: string;
  sec?: string;
}): Promise<PlainResult> {
  const session = await getSession();

  if (!session) {
    return { ok: false, error: "Sign in again to continue." };
  }

  // Re-authenticate before touching the credential, so a stolen session cookie
  // on its own is not enough to take the account over. This also confirms the
  // student actually knows the pincode we seeded them with.
  const verified = await verifyPassword(session.email, input.currentPassword);

  if (!verified.ok) {
    return { ok: false, error: "Your current password is incorrect." };
  }

  const parsed = passwordSchema.safeParse(input.newPassword);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your password." };
  }

  if (parsed.data === input.currentPassword) {
    return { ok: false, error: "Choose a password different from your old one." };
  }

  // Only the accounts whose section was inferred from the roll get asked; the
  // rest keep the one they stated.
  let sec: "a" | "b" | "c" | undefined;

  if (input.sec !== undefined) {
    const secParsed = sectionSchema.safeParse(input.sec);

    if (!secParsed.success) {
      return { ok: false, error: secParsed.error.issues[0]?.message ?? "Pick a section." };
    }

    sec = secParsed.data;
  }

  try {
    if (sec) {
      await patchProfile(session.uid, { sec });
    }

    await adminAuth.updateUser(session.uid, { password: parsed.data });

    // `null` removes every custom claim. This is what lifts the gate, so it is
    // cleared only after the new password is actually in place.
    await adminAuth.setCustomUserClaims(session.uid, null);

    // Signs the student out everywhere, including here, so the old cookie
    // cannot be replayed after the credential changed.
    await adminAuth.revokeRefreshTokens(session.uid);
  } catch (error) {
    console.error("password rotation failed", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  await clearSessionCookie();

  return { ok: true };
}
