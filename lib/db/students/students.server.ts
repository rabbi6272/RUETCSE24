"use server";


import { getSession } from "../../auth/session";
import { revalidateAll } from "../../revalidate";
import {
  changePassword,
  deleteAccount,
  requestPasswordReset,
  signIn,
  signOut,
  type SignInResult,
} from "../../auth/auth.service";
import {
  completeClaim,
  openClaimLink,
  startClaim,
  type ClaimLinkResult,
} from "../../auth/claim.server";
import { signUpWithPassword, type SignUpResult } from "../../auth/join.server";
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

function revalidateProfiles(): void {
  revalidateAll();
}

export async function signInAction(
  email: string,
  password: string,
): Promise<SignInResult> {
  return signIn(email, password);
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
  return changePassword(currentPassword, newPassword);
}

export async function deleteAccountAction(
  password: string,
): Promise<PlainResult> {
  const result = await deleteAccount(password);

  if (result.ok) revalidateProfiles();

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
): Promise<ClaimLinkResult> {
  return openClaimLink(oobCode, email);
}

export async function completeClaimAction(
  password: string,
  sec?: string,
): Promise<Result<{ uid: string }>> {
  const result = await completeClaim({
    password,
    ...(sec ? { sec: sec as "a" | "b" | "c" } : {}),
  });

  if (result.ok) revalidateProfiles();

  return result;
}

/** Email + password sign-up for an open series; signs the new account in. */
export async function signUpAction(
  seriesId: string,
  email: string,
  password: string,
): Promise<SignUpResult> {
  const result = await signUpWithPassword(seriesId, email, password);

  if (result.ok) revalidateProfiles();

  return result;
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

/**
 * Who is signed in, independent of whether they have a profile yet — a fresh
 * Join account is signed in long before its profile exists.
 */
export async function getViewerSessionAction(): Promise<{
  email: string;
  emailVerified: boolean;
} | null> {
  const session = await getSession();
  if (!session) return null;

  // Live read: the verification link flips this without re-signing anyone in.
  const emailVerified = session.emailVerified || (await freshEmailVerified(session.uid));
  return { email: session.email, emailVerified };
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
