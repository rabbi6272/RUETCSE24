import "server-only";

import { adminAuth, adminDb } from "../firebase/admin";
import { COLLECTIONS } from "../firebase/collections";
import {
  claimCompleteSchema,
  claimStartSchema,
  type ClaimCompleteInput,
} from "../db/students/students.schema";
import {
  deleteProfileDoc,
  patchProfile,
  findLegacyByEmail,
  findProfileByRoll,
  releaseRoll,
  removeLegacy,
  reserveRoll,
  setPrivateContact,
  writeProfile,
} from "../db/students/students.admin.repo";
import { sendOobCode, signInWithOutboundLink, maskEmail } from "./oob.server";
import { createSessionCookie, getSession } from "./session";
import { hashKey } from "./tokens";
import { idTokenForUid } from "./verification.server";
import { seriesFromRoll } from "../../types/series";

import type { LegacyProfile, Profile } from "../../types/Student";

/**
 * Claiming a profile that predates Firebase Auth.
 *
 * Mailbox control is proved by a Firebase email sign-in link (EMAIL_SIGNIN),
 * issued by `startClaim` and completed by `openClaimLink`. There is no
 * app-generated code anywhere: Firebase single-use/expiry semantics replace
 * the old OTP counter, and the exchange endpoint creates the account on first
 * sign-in, so account creation is folded into the same step.
 *
 * Invariants:
 *  - one uniform response for unknown, already-claimed, and eligible emails,
 *    so the endpoint does not confirm which addresses are registered;
 *  - eligibility (legacy entry exists, no account yet, roll unheld) is decided
 *    server-side at both send and completion, never trusted from the client;
 *  - a resend cooldown, so the endpoint cannot be used to mail-bomb an address.
 *
 * Seeded accounts (created by `scripts/seed-auth-users.ts` with the old
 * pincode as password and `mustRotate` still set) are "activated" through the
 * same three steps: the link proves the mailbox, then the student sets a real
 * password and the bootstrap claims are cleared. Their profile already exists,
 * so nothing is carried over.
 */

const GENERIC_START_MESSAGE =
  "If that email matches an unclaimed profile, we've sent a sign-in link to it.";
const GENERIC_LINK_MESSAGE =
  "That link is invalid or has expired. Request a new one.";
const RESEND_COOLDOWN_MS = 60 * 1000;

type Result<T> = { ok: true } & T | { ok: false; error: string };

function claimContinueUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://ruetcsearchive.app"
      : "http://localhost:3000");
  return `${base.replace(/\/+$/, "")}/profiles/claim`;
}

function claimSendRef(email: string) {
  return adminDb
    .collection(COLLECTIONS.rateLimits)
    .doc(hashKey(`claim:${email}`));
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * A seeded account that has never replaced its bootstrap pincode. `null` for
 * unknown addresses and for accounts that are already activated.
 */
async function pendingActivation(
  email: string,
): Promise<{ uid: string; needsSection: boolean } | null> {
  try {
    const user = await adminAuth.getUserByEmail(email);
    const claims = user.customClaims ?? {};
    if (claims.mustRotate !== true) return null;
    return { uid: user.uid, needsSection: claims.needsSection === true };
  } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") return null;
    throw error;
  }
}

async function authEmailExists(email: string): Promise<boolean> {
  try {
    await adminAuth.getUserByEmail(email);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") return false;
    throw error;
  }
}

export async function startClaim(rawEmail: string): Promise<Result<{ message: string }>> {
  const parsed = claimStartSchema.safeParse({ email: rawEmail });

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const email = parsed.data.email;
  const activation = await pendingActivation(email);
  const legacy = activation ? null : await findLegacyByEmail(email);

  // Eligibility is decided here and never disclosed to the caller. The roll
  // must belong to a registered series, or the claimed profile could not be
  // filed into any directory. The logged `deny` reason is the operator's
  // window into why an address was silently skipped.
  let deny: string | null = null;
  if (activation) {
    deny = null;
  } else if (!legacy) {
    deny = "no-legacy";
  } else if (seriesFromRoll(legacy.roll) === null) {
    deny = "bad-series";
  } else if (await authEmailExists(email)) {
    deny = "auth-exists";
  }

  // A legacy record whose roll is already held by a different identity is a
  // duplicate of a seeded student, not an unclaimed profile.
  if (deny === null && legacy && (await findProfileByRoll(legacy.roll)) !== null) {
    deny = "roll-held";
  }

  const eligible = deny === null;
  console.log(
    `[auth] claim start ${maskEmail(email)} -> ${deny ?? (activation ? "eligible (activate)" : "eligible")}`,
  );

  if (eligible) {
    const now = Date.now();
    const ref = claimSendRef(email);

    // Cooldown so the endpoint cannot be used to mail-bomb an address. A
    // resend inside the window is silently dropped; the previous link stays
    // valid, exactly like the old OTP behaviour.
    const canSend = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const lastSentAt = num((snap.data() as { lastSentAt?: unknown } | undefined)?.lastSentAt);
      if (now - lastSentAt < RESEND_COOLDOWN_MS) return false;
      tx.set(ref, { lastSentAt: now }, { merge: true });
      return true;
    });

    if (!canSend) {
      console.log(`[auth] claim cooldown ${maskEmail(email)} (resend dropped)`);
    } else {
      await sendOobCode({
        requestType: "EMAIL_SIGNIN",
        email,
        continueUrl: claimContinueUrl(),
        canHandleCodeInApp: true,
      });
    }
  }

  return { ok: true, message: GENERIC_START_MESSAGE };
}

/**
 * Exchanges the clicked link's `oobCode` for a session. The client supplies
 * the address from its own state (or re-enters it on another device); the
 * Identity Toolkit endpoint binds code and address, so a wrong pairing fails.
 */
export type ClaimLinkResult =
  | { ok: true; mode: "claim" | "activate"; needsSection: boolean }
  | { ok: false; error: string };

export async function openClaimLink(
  rawOobCode: string,
  rawEmail: string,
): Promise<ClaimLinkResult> {
  const oobCode = rawOobCode.trim();
  const parsed = claimStartSchema.safeParse({ email: rawEmail });

  if (!oobCode || !parsed.success) {
    console.log("[auth] claim link -> invalid-input");
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  const exchanged = await signInWithOutboundLink(oobCode, parsed.data.email);

  if (!exchanged.ok) {
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  const signedInAs = (exchanged.data.email ?? "").trim().toLowerCase();
  if (signedInAs && signedInAs !== parsed.data.email) {
    console.log(`[auth] claim link -> email-mismatch ${maskEmail(parsed.data.email)}`);
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  // A seeded account needs no legacy entry: its profile and roll are already
  // its own, and the link is the proof the pincode never was.
  const activation = await pendingActivation(parsed.data.email);
  if (activation) {
    await createSessionCookie(exchanged.data.idToken);
    console.log(`[auth] claim link -> ok (activate) ${maskEmail(parsed.data.email)}`);
    return { ok: true, mode: "activate", needsSection: activation.needsSection };
  }

  // The link proves mailbox control, but eligibility is still ours to decide:
  // the legacy entry must exist and its roll must still be unheld.
  const legacy = await findLegacyByEmail(parsed.data.email);
  if (!legacy) {
    console.log(`[auth] claim link -> no-legacy ${maskEmail(parsed.data.email)}`);
    return { ok: false, error: "This profile is no longer available to claim." };
  }
  if ((await findProfileByRoll(legacy.roll)) !== null) {
    console.log(`[auth] claim link -> roll-held ${legacy.roll}`);
    return { ok: false, error: "This profile has already been claimed." };
  }

  await createSessionCookie(exchanged.data.idToken);
  console.log(`[auth] claim link -> ok ${maskEmail(parsed.data.email)} (session opened)`);
  return { ok: true, mode: "claim", needsSection: false };
}

function legacyToProfile(legacy: LegacyProfile, uid: string, now: number): Profile {
  const sec = legacy.sec === "" ? "a" : legacy.sec;

  return {
    id: uid,
    fullName: legacy.fullName,
    nickname: legacy.nickname,
    email: legacy.email,
    roll: legacy.roll,
    series: seriesFromRoll(legacy.roll)?.id ?? "",
    sec,
    bloodGroup: legacy.bloodGroup,
    bio: legacy.bio,
    hobby: legacy.hobby,
    fbProfile: legacy.fbProfile,
    profilePicture: legacy.profilePicture,
    published: true,
    createdAt: legacy.createdAt,
    updatedAt: now,
    claimedAt: now,
  };
}

/** Final step: set the password and carry the legacy record onto the account. */
export async function completeClaim(
  input: ClaimCompleteInput,
): Promise<Result<{ uid: string }>> {
  const parsed = claimCompleteSchema.safeParse(input);

  if (!parsed.success) {
    console.log("[auth] claim complete -> invalid-input");
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const session = await getSession();
  if (!session) {
    console.log("[auth] claim complete -> no-session");
    return { ok: false, error: "Your claim session expired. Start again." };
  }

  if (session.mustRotate) {
    return completeActivation(session, parsed.data);
  }

  // Bound to the mailbox the link verified — never to client-supplied input.
  const legacy = await findLegacyByEmail(session.email);
  if (!legacy || seriesFromRoll(legacy.roll) === null) {
    console.log(`[auth] claim complete -> no-legacy ${maskEmail(session.email)}`);
    return { ok: false, error: "This profile is no longer available to claim." };
  }
  if ((await findProfileByRoll(legacy.roll)) !== null) {
    console.log(`[auth] claim complete -> roll-held ${legacy.roll}`);
    return { ok: false, error: "This profile has already been claimed." };
  }

  if (!(await reserveRoll(legacy.roll, session.uid))) {
    console.log(`[auth] claim complete -> reserve-failed ${legacy.roll}`);
    return { ok: false, error: "That roll number has already been claimed." };
  }

  try {
    // The sign-in link proved control of the mailbox, so the account is
    // marked verified as part of claiming; the password gives the student a
    // way back in without the link.
    await adminAuth.updateUser(session.uid, {
      password: parsed.data.password,
      emailVerified: true,
    });

    const now = Date.now();
    await writeProfile(session.uid, legacyToProfile(legacy, session.uid, now));

    if (legacy.mobileNumber) {
      await setPrivateContact(session.uid, { mobileNumber: legacy.mobileNumber });
    }

    await removeLegacy(legacy.legacyId);

    console.log(`[auth] claim complete -> ok roll=${legacy.roll} uid=${session.uid}`);
    return { ok: true, uid: session.uid };
  } catch (error) {
    // Compensate so a transient failure does not strand the roll number and
    // lock the student out of a retry. The account itself stays (it owns the
    // session), which is safe: no profile or roll points at it yet.
    console.error("[auth] claim complete failed, compensating", error);
    await releaseRoll(legacy.roll, session.uid).catch(() => undefined);
    await deleteProfileDoc(session.uid).catch(() => undefined);
    throw error;
  }
}

/**
 * Final step for a seeded account: replace the bootstrap pincode, clear the
 * `mustRotate`/`needsSection` claims, and re-open the session so the student
 * lands signed in. Ordered like `completePasswordRotation`: the idempotent
 * profile write first, the claims cleared only once the password is in place.
 */
async function completeActivation(
  session: { uid: string; email: string; needsSection: boolean },
  input: ClaimCompleteInput,
): Promise<Result<{ uid: string }>> {
  if (session.needsSection && !input.sec) {
    console.log(`[auth] claim complete -> missing-section uid=${session.uid}`);
    return { ok: false, error: "Pick your section." };
  }

  try {
    if (session.needsSection && input.sec) {
      await patchProfile(session.uid, { sec: input.sec });
    }

    await adminAuth.updateUser(session.uid, {
      password: input.password,
      emailVerified: true,
    });
    await adminAuth.setCustomUserClaims(session.uid, null);

    // Kills any session still signed in with the public pincode, this one
    // included; a fresh cookie is minted below.
    await adminAuth.revokeRefreshTokens(session.uid);
  } catch (error) {
    console.error("[auth] claim complete (activate) failed", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  // The seeded copy of the legacy entry is now redundant; leaving it would keep
  // the student counted as unclaimed. Best effort — the account is done.
  const legacy = await findLegacyByEmail(session.email).catch(() => null);
  if (legacy) {
    await removeLegacy(legacy.legacyId).catch((error) =>
      console.error("[auth] claim complete (activate) legacy cleanup failed", error),
    );
  }

  const idToken = await idTokenForUid(session.uid).catch(() => null);
  if (idToken) {
    await createSessionCookie(idToken);
  } else {
    console.error(`[auth] claim complete (activate) re-sign-in failed uid=${session.uid}`);
  }

  console.log(`[auth] claim complete -> ok (activate) uid=${session.uid}`);
  return { ok: true, uid: session.uid };
}
