"use server";

import { revalidatePath, revalidateTag } from "next/cache";

import { getSession } from "../../auth/session";
import {
  changePassword,
  deleteAccount,
  requestPasswordReset,
  signIn,
  signOut,
} from "../../auth/auth.service";
import { completeClaim, openClaimLink, startClaim } from "../../auth/claim.server";
import { completeJoin, openJoinLink, startJoin } from "../../auth/join.server";
import { completePasswordRotation } from "../../auth/rotation.server";
import { freshEmailVerified, resendVerification } from "../../auth/verification.server";
import { countUnclaimed } from "./students.admin.repo";
import {
  createProfileFor,
  getContact,
  getProfile,
  getRollForClaimedEmail,
  updateContactFor,
  updateProfileFor,
} from "./students.service";
import { profileDraftSchema, updateProfileSchema, updateContactSchema } from "./students.schema";
import type { UpdateProfileInput } from "./students.schema";

import type { PrivateContact, Profile } from "../../../types/Student";

/**
 * Every mutation the client can perform.
 *
 * The client never sends a uid: it is read from the verified session cookie
 * inside each action, so a caller cannot act on someone else's profile by
 * changing a request body.
 */

type Result<T> = { ok: true } & T | { ok: false; error: string };
type PlainResult = { ok: true } | { ok: false; error: string };

const PROFILES_PATH = "/profiles";

function revalidateProfiles(): void {
  revalidateTag("profiles", "max");
  revalidatePath(PROFILES_PATH);
}

export async function signInAction(
  email: string,
  password: string,
): Promise<
  Result<{ email: string; emailVerified: boolean; mustRotate: boolean; needsSection: boolean }>
> {
  return signIn(email, password);
}

/**
 * Replaces a seeded bootstrap password. On success the session is intentionally
 * destroyed (the refresh tokens were revoked), so the caller must send the
 * student back through sign-in.
 */
export async function completePasswordRotationAction(input: {
  currentPassword: string;
  newPassword: string;
  sec?: string;
}): Promise<PlainResult> {
  const result = await completePasswordRotation(input);

  if (result.ok) revalidateProfiles();

  return result;
}

export async function signOutAction(): Promise<PlainResult> {
  const result = await signOut();

  if (result.ok) revalidateProfiles();

  return result;
}

export async function requestPasswordResetAction(email: string): Promise<PlainResult> {
  return requestPasswordReset(email);
}

export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<PlainResult> {
  const result = await changePassword(currentPassword, newPassword);

  if (result.ok) revalidatePath("/profiles/settings");

  return result;
}

export async function deleteAccountAction(
  password: string,
): Promise<PlainResult> {
  const result = await deleteAccount(password);

  if (result.ok) revalidatePath(PROFILES_PATH);

  return result;
}

export async function startClaimAction(
  email: string,
): Promise<Result<{ message: string }>> {
  return startClaim(email);
}

/** Completes the emailed sign-in link and establishes the claim session. */
export async function openClaimLinkAction(
  oobCode: string,
  email: string,
): Promise<PlainResult> {
  return openClaimLink(oobCode, email);
}

export async function completeClaimAction(password: string): Promise<Result<{ uid: string }>> {
  const result = await completeClaim({ password });

  if (result.ok) revalidateProfiles();

  return result;
}

/** Self sign-up: sends the magic link for a registered, open series. */
export async function startJoinAction(
  seriesId: string,
  email: string,
): Promise<Result<{ message: string }>> {
  return startJoin(seriesId, email);
}

/** Exchanges the join link: creates the account, marks it verified, signs in. */
export async function openJoinLinkAction(
  oobCode: string,
  email: string,
): Promise<Result<{ hasProfile: boolean }>> {
  return openJoinLink(oobCode, email);
}

/** Final join step: sets the password on the just-opened session's account. */
export async function completeJoinAction(password: string): Promise<Result<{ uid: string }>> {
  return completeJoin({ password });
}

/** Re-issues the VERIFY_EMAIL link for the current session. */
export async function resendVerificationAction(): Promise<PlainResult> {
  return resendVerification();
}

/** Drives the migration banner without exposing who is unclaimed. */
export async function getUnclaimedCountAction(): Promise<number> {
  return countUnclaimed();
}

/** Backs the "did I already claim?" checker. */
export async function getRollForEmailAction(email: string): Promise<string | null> {
  return getRollForClaimedEmail(email);
}

export async function getMyProfileAction(): Promise<Profile | null> {
  const session = await getSession();

  return session ? getProfile(session.uid) : null;
}

export async function getMyContactAction(): Promise<PrivateContact | null> {
  const session = await getSession();

  return session ? getContact(session.uid) : null;
}

export async function createProfileAction(
  draft: unknown,
  mobileNumber: string,
): Promise<Result<{ profile: Profile }>> {
  const session = await getSession();

  if (!session) {
    return { ok: false, error: "Sign in to create a profile." };
  }

  // The cookie's claim can be older than the verification itself (the
  // magic-link flows verify without re-signing), so this gate reads live.
  if (!(await freshEmailVerified(session.uid))) {
    console.log(`[auth] create-profile -> email-not-verified uid=${session.uid}`);
    return {
      ok: false,
      error:
        "Verify your email first. Open the verification link we sent you, then try again.",
    };
  }

  const parsed = profileDraftSchema.safeParse(draft);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const contact = updateContactSchema.safeParse({ mobileNumber });

  const result = await createProfileFor(
    session.uid,
    session.email,
    parsed.data,
    contact.success ? contact.data : undefined,
  );

  if (result.ok) revalidateProfiles();

  return result;
}

export async function updateProfileAction(
  patch: unknown,
): Promise<Result<{ profile: Profile }>> {
  const session = await getSession();

  if (!session) {
    return { ok: false, error: "Sign in again to continue." };
  }

  const parsed = updateProfileSchema.safeParse(patch);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const result = await updateProfileFor(session.uid, parsed.data as UpdateProfileInput);

  if (result.ok) revalidateProfiles();

  return result;
}

export async function updateContactAction(
  mobileNumber: string,
): Promise<Result<{ contact: PrivateContact }>> {
  const session = await getSession();

  if (!session) {
    return { ok: false, error: "Sign in again to continue." };
  }

  const result = await updateContactFor(session.uid, { mobileNumber });

  return result;
}
