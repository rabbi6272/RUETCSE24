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
  findLegacyByEmail,
  findProfileByRoll,
  releaseRoll,
  removeLegacy,
  reserveRoll,
  setPrivateContact,
  writeProfile,
} from "../db/students/students.admin.repo";
import { sendOobCode, signInWithOutboundLink } from "./oob.server";
import { createSessionCookie, getSession } from "./session";
import { hashKey } from "./tokens";
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
  const legacy = await findLegacyByEmail(email);

  // Eligibility is decided here and never disclosed to the caller. The roll
  // must belong to a registered series, or the claimed profile could not be
  // filed into any directory.
  let eligible =
    legacy !== null &&
    seriesFromRoll(legacy.roll) !== null &&
    !(await authEmailExists(email));

  // A legacy record whose roll is already held by a different identity is a
  // duplicate of a seeded student, not an unclaimed profile.
  if (eligible && legacy) {
    const holder = await findProfileByRoll(legacy.roll);
    if (holder !== null) eligible = false;
  }

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

    if (canSend) {
      const sent = await sendOobCode({
        requestType: "EMAIL_SIGNIN",
        email,
        continueUrl: claimContinueUrl(),
        canHandleCodeInApp: true,
      });
      // A mail failure must not be distinguishable from success either.
      if (!sent.ok) console.error("claim sign-in link failed", email, sent.code);
    }
  }

  return { ok: true, message: GENERIC_START_MESSAGE };
}

/**
 * Exchanges the clicked link's `oobCode` for a session. The client supplies
 * the address from its own state (or re-enters it on another device); the
 * Identity Toolkit endpoint binds code and address, so a wrong pairing fails.
 */
export async function openClaimLink(
  rawOobCode: string,
  rawEmail: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const oobCode = rawOobCode.trim();
  const parsed = claimStartSchema.safeParse({ email: rawEmail });

  if (!oobCode || !parsed.success) {
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  const exchanged = await signInWithOutboundLink(oobCode, parsed.data.email);

  if (!exchanged.ok) {
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  const signedInAs = (exchanged.data.email ?? "").trim().toLowerCase();
  if (signedInAs && signedInAs !== parsed.data.email) {
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  // The link proves mailbox control, but eligibility is still ours to decide:
  // the legacy entry must exist and its roll must still be unheld.
  const legacy = await findLegacyByEmail(parsed.data.email);
  if (!legacy) {
    return { ok: false, error: "This profile is no longer available to claim." };
  }
  if ((await findProfileByRoll(legacy.roll)) !== null) {
    return { ok: false, error: "This profile has already been claimed." };
  }

  await createSessionCookie(exchanged.data.idToken);
  return { ok: true };
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
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const session = await getSession();
  if (!session) {
    return { ok: false, error: "Your claim session expired. Start again." };
  }

  // Bound to the mailbox the link verified — never to client-supplied input.
  const legacy = await findLegacyByEmail(session.email);
  if (!legacy || seriesFromRoll(legacy.roll) === null) {
    return { ok: false, error: "This profile is no longer available to claim." };
  }
  if ((await findProfileByRoll(legacy.roll)) !== null) {
    return { ok: false, error: "This profile has already been claimed." };
  }

  if (!(await reserveRoll(legacy.roll, session.uid))) {
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

    return { ok: true, uid: session.uid };
  } catch (error) {
    // Compensate so a transient failure does not strand the roll number and
    // lock the student out of a retry. The account itself stays (it owns the
    // session), which is safe: no profile or roll points at it yet.
    await releaseRoll(legacy.roll, session.uid).catch(() => undefined);
    await deleteProfileDoc(session.uid).catch(() => undefined);
    throw error;
  }
}
