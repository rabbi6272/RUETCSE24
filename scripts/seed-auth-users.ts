import { createHash } from "crypto";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";

import { getSectionFromRoll } from "../types/series";
import type { Section } from "../types/Student";

/**
 * Seeds Firebase Auth from the legacy `users` collection so the switchover is
 * invisible to students, and writes their public profile in the same pass.
 *
 * Why this exists
 * ---------------
 * The previous auth flow was a NextAuth credentials provider that compared an
 * email against a plaintext `pincode` held in a *publicly readable* Firestore
 * document. Those pincodes have therefore been public for the life of the site
 * and must be assumed compromised. Deleting them alone would lock every student
 * out, and leaving students to re-register would be a visible, disruptive
 * cutover.
 *
 * So each student is created with their existing pincode as the initial
 * Firebase password, which makes `signIn` work with exactly the credentials
 * they already use. Every account is flagged `mustRotate`, and the app refuses
 * to do anything except set a new password until that flag is cleared. The
 * pincode is a bootstrap credential with a built-in expiry, not a permanent one.
 *
 * `passwordSchema` requires at least 8 characters and a pincode is 6, so the
 * weak value can never satisfy the rotation form.
 *
 * What this script does NOT do
 * ----------------------------
 *  - It never writes a pincode to Firestore. It is read from `users`, handed
 *    straight to the Auth API, and never persisted by this project.
 *  - It does not delete `users`. That stays as the rollback copy.
 *  - It does not print emails, pincodes, or any credential material.
 *
 * The section column is repaired from the roll number, which the codebase
 * already treats as authoritative (`getSectionFromRoll`). Where a stored
 * section and a derived section disagree the stored value wins and the
 * disagreement is reported rather than silently overwritten.
 *
 * Dry run by default:
 *   node --env-file=.env --import tsx scripts/seed-auth-users.ts
 *   node --env-file=.env --import tsx scripts/seed-auth-users.ts --apply
 *
 * Flags:
 *   --apply             perform writes (accounts, profiles, roll reservations)
 *   --publish-derived   also publish profiles whose section had to be derived.
 *                       Left off by default: a derived section is inferred, not
 *                       stated by the student, so the profile stays out of the
 *                       public directory until they confirm it.
 */

const SOURCE_COLLECTION = "users";
const TARGET_COLLECTION = "legacyProfiles";
const PROFILE_COLLECTION = "profiles";
const ROLL_COLLECTION = "rollIndex";
const PRIVATE_CONTACT_DOC = "contact";

const AUTH_IMPORT_BATCH = 1000;
const WRITE_BATCH = 400;

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const PUBLISH_DERIVED = args.has("--publish-derived");

type Raw = Record<string, unknown>;

type Candidate = {
  legacyId: string;
  email: string;
  pincode: string;
  fullName: string;
  nickname: string;
  roll: string;
  sec: Section;
  secWasDerived: boolean;
  bloodGroup: string;
  bio: string;
  hobby: string;
  fbProfile: string;
  mobileNumber: string;
  profilePicture: { publicId: string; url: string };
  createdAt: number;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function picture(data: Raw): { publicId: string; url: string } {
  const nested = data.profilePicture;

  if (nested && typeof nested === "object") {
    const raw = nested as Raw;
    return { publicId: str(raw.publicId), url: str(raw.url) };
  }

  return { publicId: str(data.profilePicPublicId), url: str(data.profilePicUrl) };
}

function normalizeEmail(value: unknown): string {
  return str(value).toLowerCase();
}

/**
 * Same derivation the migration used for the `legacyProfiles` document id, so
 * seeding is idempotent (a re-run maps to the same uid) and a seeded profile
 * can be traced straight back to the migrated record it came from.
 */
function legacyIdForEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex");
}

/** Keeps an address recognisable in a report without printing it. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function initAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  const missing = [
    !projectId && "FIREBASE_PROJECT_ID",
    !clientEmail && "FIREBASE_CLIENT_EMAIL",
    !privateKey && "FIREBASE_PRIVATE_KEY",
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    console.error("Load them with `node --env-file=.env`, not `source .env`.");
    process.exit(1);
  }

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! }),
    });

  return { db: getFirestore(app), auth: getAuth(app) };
}

/**
 * Firebase Auth refuses passwords shorter than 6 characters, so a shorter or
 * absent pincode cannot be seeded at all. Those students are reported and left
 * for the normal email-OTP claim flow rather than being given a weak fallback.
 */
const MIN_PASSWORD_LENGTH = 6;

async function main() {
  const { db, auth } = initAdmin();

  console.log(APPLY ? "MODE: APPLY (writes enabled)" : "MODE: DRY RUN (no writes)");
  if (PUBLISH_DERIVED) {
    console.log("  --publish-derived set: profiles with a derived section will be published");
  }
  console.log(`Reading ${SOURCE_COLLECTION} and ${TARGET_COLLECTION}...\n`);

  const stats = {
    candidates: 0,
    skippedShortPin: 0,
    skippedShortPinEmails: [] as string[],
    rollConflicts: 0,
    rollConflictDetail: [] as string[],
    sectionDerived: 0,
    sectionDisagreements: [] as string[],
    alreadySeeded: 0,
    imported: 0,
    importErrors: 0,
    importErrorDetail: [] as string[],
    profilesWritten: 0,
    profileErrors: 0,
    rollsReserved: 0,
    contactsWritten: 0,
    unpublished: 0,
  };

  // The pincode lives only in `users`; the migration deliberately dropped it
  // from `legacyProfiles`, so the two collections are joined on email here.
  const pincodeByEmail = new Map<string, string>();
  const userSnap = await db.collection(SOURCE_COLLECTION).get();

  for (const doc of userSnap.docs) {
    const data = doc.data() as Raw;
    const email = normalizeEmail(data.email);
    if (!email || pincodeByEmail.has(email)) continue;
    pincodeByEmail.set(email, str(data.pincode));
  }

  const legacySnap = await db.collection(TARGET_COLLECTION).get();
  const candidates: Candidate[] = [];

  for (const doc of legacySnap.docs) {
    const data = doc.data() as Raw;
    const email = normalizeEmail(data.email);

    if (!email) continue;

    const pincode = pincodeByEmail.get(email) ?? "";
    if (pincode.length < MIN_PASSWORD_LENGTH) {
      stats.skippedShortPin += 1;
      stats.skippedShortPinEmails.push(email);
      continue;
    }

    const roll = str(data.roll);
    const storedSec = str(data.sec).toLowerCase();
    const derivedSec = getSectionFromRoll(roll);

    let sec: Section;
    let secWasDerived = false;

    if (storedSec === "a" || storedSec === "b" || storedSec === "c") {
      sec = storedSec;
      // Reported, never silently corrected: the roll is a strong signal but the
      // student stated their own section, and the student wins.
      if (derivedSec && derivedSec !== storedSec) {
        stats.sectionDisagreements.push(`${roll} stored=${storedSec} derived=${derivedSec}`);
      }
    } else if (derivedSec) {
      sec = derivedSec;
      secWasDerived = true;
      stats.sectionDerived += 1;
    } else {
      // Unreachable for in-range rolls; keeps the type honest otherwise.
      sec = "a";
      secWasDerived = true;
    }

    candidates.push({
      legacyId: doc.id,
      email,
      pincode,
      fullName: str(data.fullName),
      nickname: str(data.nickname),
      roll,
      sec,
      secWasDerived,
      bloodGroup: str(data.bloodGroup),
      bio: str(data.bio),
      hobby: str(data.hobby),
      fbProfile: str(data.fbProfile),
      mobileNumber: str(data.mobileNumber),
      profilePicture: picture(data),
      createdAt: num(data.createdAt, Date.now()),
    });
  }

  stats.candidates = candidates.length;

  // One roll may only ever belong to one identity. Where a student registered
  // twice under different addresses the email join cannot catch it, so the most
  // recently created record wins and the other is left behind in `users`.
  const byRoll = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const list = byRoll.get(candidate.roll);
    if (list) list.push(candidate);
    else byRoll.set(candidate.roll, [candidate]);
  }

  const winners: Candidate[] = [];

  for (const [roll, list] of byRoll) {
    if (list.length === 1) {
      winners.push(list[0]);
      continue;
    }

    const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
    winners.push(sorted[0]);

    for (const loser of sorted.slice(1)) {
      stats.rollConflicts += 1;
      stats.rollConflictDetail.push(`roll=${roll} kept=${maskEmail(sorted[0].email)} skipped=${maskEmail(loser.email)}`);
    }
  }

  // Never seed an address that already has an account: a student who already
  // claimed must keep the password they chose, not have it reset to a pincode.
  const toSeed: Candidate[] = [];

  for (const candidate of winners) {
    try {
      await auth.getUserByEmail(candidate.email);
      stats.alreadySeeded += 1;
    } catch (error) {
      if ((error as { code?: string }).code === "auth/user-not-found") {
        toSeed.push(candidate);
      } else {
        throw error;
      }
    }
  }

  const publishCount = toSeed.filter(
    (c) => !c.secWasDerived || PUBLISH_DERIVED,
  ).length;
  stats.unpublished = toSeed.length - publishCount;

  console.log("--- plan ---");
  console.log(`candidates             ${stats.candidates}`);
  console.log(`pincode too short      ${stats.skippedShortPin}`);
  console.log(`roll conflicts         ${stats.rollConflicts}`);
  console.log(`already has account    ${stats.alreadySeeded}`);
  console.log(`accounts to create     ${toSeed.length}`);
  console.log(`  published            ${publishCount}`);
  console.log(`  held back            ${stats.unpublished}`);
  console.log(`section derived        ${stats.sectionDerived}`);

  if (stats.sectionDisagreements.length > 0) {
    console.log("\nsection disagrees with roll (stored value kept):");
    for (const line of stats.sectionDisagreements) console.log(`  ${line}`);
  }

  if (stats.rollConflictDetail.length > 0) {
    console.log("\nroll conflicts (newest kept):");
    for (const line of stats.rollConflictDetail) console.log(`  ${line}`);
  }

  if (stats.skippedShortPinEmails.length > 0) {
    console.log("\nno usable pincode, left for the claim flow:");
    for (const email of stats.skippedShortPinEmails) console.log(`  ${maskEmail(email)}`);
  }

  if (!APPLY) {
    console.log("\n--- summary (dry run) ---");
    console.log(`would create           ${toSeed.length}`);
    console.log(`would write profiles   ${toSeed.length}`);
    console.log(`would reserve rolls    ${toSeed.length}`);
    console.log(
      `would park contacts    ${toSeed.filter((c) => c.mobileNumber).length}`,
    );
    console.log("\nNo writes were made. Re-run with --apply to seed.");
    return;
  }

  // Auth first: the uid is the profile document id, so the profile cannot be
  // written before the account exists.
  const seeded: Array<{ candidate: Candidate; uid: string }> = [];

  for (let i = 0; i < toSeed.length; i += AUTH_IMPORT_BATCH) {
    const chunk = toSeed.slice(i, i + AUTH_IMPORT_BATCH);

    const result = await auth.importUsers(
      chunk.map((candidate) => ({
        // The uid is derived from the email rather than generated by the API,
        // so a re-run maps to the same account instead of creating a duplicate.
        uid: legacyIdForEmail(candidate.email),
        email: candidate.email,
        password: candidate.pincode,
        emailVerified: true,
        // Forces the one-time password upgrade. `needsSection` tells the
        // rotation screen to ask for a section when the stored one was
        // inferred rather than stated.
        customClaims: { mustRotate: true, needsSection: candidate.secWasDerived },
      })),
    );

    const failures = new Map(
      result.errors.map((error) => [error.index, error.error.message]),
    );

    for (let j = 0; j < chunk.length; j += 1) {
      const candidate = chunk[j];
      const failure = failures.get(j);

      if (failure) {
        stats.importErrors += 1;
        stats.importErrorDetail.push(`${maskEmail(candidate.email)}: ${failure}`);
        continue;
      }

      seeded.push({ candidate, uid: legacyIdForEmail(candidate.email) });
      stats.imported += 1;
    }

    console.log(`  imported ${stats.imported}/${toSeed.length}`);
  }

  const now = Date.now();

  for (let i = 0; i < seeded.length; i += WRITE_BATCH) {
    const chunk = seeded.slice(i, i + WRITE_BATCH);
    const batch = db.batch();
    const staged: Array<{ uid: string; roll: string; contact: string }> = [];

    for (const { candidate, uid } of chunk) {
      // The roll reservation is the claim that makes a roll single-owner, so it
      // is written in the same batch as the profile it belongs to.
      batch.set(
        db.collection(ROLL_COLLECTION).doc(candidate.roll),
        { uid, claimedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );

      batch.set(
        db.collection(PROFILE_COLLECTION).doc(uid),
        {
          fullName: candidate.fullName,
          nickname: candidate.nickname,
          email: candidate.email,
          roll: candidate.roll,
          sec: candidate.sec,
          bloodGroup: candidate.bloodGroup,
          bio: candidate.bio,
          hobby: candidate.hobby,
          fbProfile: candidate.fbProfile,
          profilePicture: candidate.profilePicture,
          published: !candidate.secWasDerived || PUBLISH_DERIVED,
          createdAt: candidate.createdAt,
          updatedAt: now,
          claimedAt: now,
        },
        { merge: false },
      );

      staged.push({
        uid,
        roll: candidate.roll,
        contact: candidate.mobileNumber,
      });
    }

    try {
      await batch.commit();
      stats.profilesWritten += chunk.length;
      stats.rollsReserved += chunk.length;
    } catch (error) {
      // A batch failure must not leave accounts without profiles, so every
      // account in the failed chunk is removed and the student is routed to the
      // ordinary claim flow instead.
      stats.profileErrors += chunk.length;
      console.error(`  batch of ${chunk.length} failed, rolling back its accounts`);

      for (const { uid } of chunk) {
        await auth.deleteUser(uid).catch(() => undefined);
      }

      for (const { uid, contact } of staged) {
        if (!contact) continue;
        await auth
          .setCustomUserClaims(uid, { mustRotate: true, needsSection: true })
          .catch(() => undefined);
      }

      continue;
    }

    // Mobile numbers are written after the batch so a contact failure can never
    // roll back a profile that is already correct.
    for (const { uid, contact } of staged) {
      if (!contact) continue;
      try {
        await db
          .collection(PROFILE_COLLECTION)
          .doc(uid)
          .collection("private")
          .doc(PRIVATE_CONTACT_DOC)
          .set({ mobileNumber: contact }, { merge: true });
        stats.contactsWritten += 1;
      } catch (error) {
        // Never log the number itself; the uid is enough to find the document.
        console.error(`  contact write failed for uid ${uid}`);
      }
    }

    console.log(`  profiles ${stats.profilesWritten}/${seeded.length}`);
  }

  console.log("\n--- summary ---");
  console.log(`accounts created       ${stats.imported}`);
  console.log(`import errors          ${stats.importErrors}`);
  console.log(`profiles written       ${stats.profilesWritten}`);
  console.log(`profile batch errors   ${stats.profileErrors}`);
  console.log(`rolls reserved         ${stats.rollsReserved}`);
  console.log(`private contacts       ${stats.contactsWritten}`);
  console.log(`held back unpublished  ${stats.unpublished}`);

  if (stats.importErrorDetail.length > 0) {
    console.log("\nimport errors:");
    for (const line of stats.importErrorDetail) console.log(`  ${line}`);
  }

  console.log(
    "\nNext: verify one student can sign in with their existing email and pincode,",
  );
  console.log("then deploy the app, then deploy firestore.rules last.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
