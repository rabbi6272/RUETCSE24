import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "../../firebase/admin";
import { COLLECTIONS, PRIVATE_CONTACT_DOC } from "../../firebase/collections";
import { toLegacyProfile, toPrivateContact, toProfile } from "./students.mapper";
import { hashKey } from "../../auth/tokens";

import type { LegacyProfile, PrivateContact, Profile } from "../../../types/Student";

type Raw = Record<string, unknown>;

/**
 * All reads and writes that require the Admin SDK. Client code never imports
 * this file — `server-only` makes that a build error rather than a convention.
 *
 * Keeping these functions dumb is deliberate: authorization lives in
 * `students.service.ts` so it cannot be skipped by a caller.
 */

const profiles = () => adminDb.collection(COLLECTIONS.profiles);
const legacy = () => adminDb.collection(COLLECTIONS.legacyProfiles);
const rolls = () => adminDb.collection(COLLECTIONS.rollIndex);

export function legacyIdForEmail(email: string): string {
  return hashKey(email.trim().toLowerCase());
}

export async function findProfileById(uid: string): Promise<Profile | null> {
  const snap = await profiles().doc(uid).get();
  return snap.exists ? toProfile(snap.data() as Raw, snap.id) : null;
}

export async function findProfileByEmail(email: string): Promise<Profile | null> {
  const snap = await profiles()
    .where("email", "==", email.trim().toLowerCase())
    .limit(1)
    .get();

  if (snap.empty) return null;

  const doc = snap.docs[0];
  return toProfile(doc.data() as Raw, doc.id);
}

/** Removes a profile document without touching the auth account. */
export async function deleteProfileDoc(uid: string): Promise<void> {
  await profiles().doc(uid).delete();
}

export async function findProfileByRoll(roll: string): Promise<string | null> {
  const snap = await rolls().doc(roll).get();
  const uid = snap.get("uid");
  return typeof uid === "string" ? uid : null;
}

export async function listProfiles(): Promise<Profile[]> {
  const snap = await profiles().get();
  return snap.docs.map((doc) => toProfile(doc.data() as Raw, doc.id));
}

export async function writeProfile(uid: string, profile: Profile): Promise<void> {
  // `id` is the document id, never a stored field. Firestore rules reject
  // unknown fields, so persisting it would make a client-side write fail.
  const { id: _ignored, ...fields } = profile;

  await profiles()
    .doc(uid)
    .set({ ...fields, updatedAt: Date.now() }, { merge: false });
}

export async function patchProfile(uid: string, patch: Record<string, unknown>): Promise<void> {
  const { id: _ignored, ...fields } = patch as { id?: string } & Record<string, unknown>;

  await profiles().doc(uid).set({ ...fields, updatedAt: Date.now() }, { merge: true });
}

export async function removeProfile(uid: string): Promise<void> {
  const batch = adminDb.batch();
  batch.delete(profiles().doc(uid));
  batch.delete(profiles().doc(uid).collection("private").doc(PRIVATE_CONTACT_DOC));

  const rollSnap = await profiles().doc(uid).get();
  const roll = rollSnap.exists ? str(rollSnap.get("roll")) : "";
  if (roll) batch.delete(rolls().doc(roll));

  await batch.commit();
}

export async function getPrivateContact(uid: string): Promise<PrivateContact | null> {
  const snap = await profiles()
    .doc(uid)
    .collection("private")
    .doc(PRIVATE_CONTACT_DOC)
    .get();

  return snap.exists ? toPrivateContact(snap.data() as Raw) : null;
}

export async function setPrivateContact(
  uid: string,
  contact: PrivateContact,
): Promise<void> {
  await profiles()
    .doc(uid)
    .collection("private")
    .doc(PRIVATE_CONTACT_DOC)
    .set(contact, { merge: true });
}

export async function findLegacyByEmail(email: string): Promise<LegacyProfile | null> {
  const snap = await legacy().doc(legacyIdForEmail(email)).get();
  return snap.exists ? toLegacyProfile(snap.data() as Raw, snap.id) : null;
}

export async function removeLegacy(legacyId: string): Promise<void> {
  await legacy().doc(legacyId).delete();
}

export async function listLegacy(): Promise<LegacyProfile[]> {
  const snap = await legacy().get();
  return snap.docs.map((doc) => toLegacyProfile(doc.data() as Raw, doc.id));
}

export async function countLegacy(): Promise<number> {
  const snap = await legacy().count().get();
  return snap.data().count;
}

/**
 * Legacy records that can still be claimed.
 *
 * This replaces a raw `legacyProfiles` count, which started lying the moment
 * accounts were seeded: it would keep advertising "179 profiles waiting to be
 * claimed" while every one of those addresses had already been given an
 * account, sending students into a claim flow that could only reject them.
 *
 * The seed derives the Auth uid from `sha256(normalizedEmail)` — the same value
 * the migration used for the `legacyProfiles` document id — so a seeded student
 * has a profile document under the identical id. That turns "unclaimed" into a
 * set difference over two id lists, rather than an existence check against the
 * Auth API per record.
 *
 * A second exclusion matters as much: a legacy record whose roll is already
 * held by a different identity is a duplicate of a seeded student, not an
 * unclaimed profile. Counting it would invite someone to claim an entry that is
 * guaranteed to be rejected at the roll reservation.
 */
export async function countUnclaimed(): Promise<number> {
  const [legacySnap, profileSnap, rollSnap] = await Promise.all([
    legacy().get(),
    profiles().get(),
    rolls().get(),
  ]);

  const claimed = new Set(profileSnap.docs.map((doc) => doc.id));
  const reservedRolls = new Set(rollSnap.docs.map((doc) => doc.id));
  let unclaimed = 0;

  for (const doc of legacySnap.docs) {
    if (claimed.has(doc.id)) continue;
    if (reservedRolls.has(str(doc.get("roll")))) continue;
    unclaimed += 1;
  }

  return unclaimed;
}

/** Published profiles in one series — the live count on the landing picker. */
export async function countPublishedBySeries(series: string): Promise<number> {
  const snap = await profiles()
    .where("series", "==", series)
    .where("published", "==", true)
    .count()
    .get();
  return snap.data().count;
}

/**
 * Reserves a roll number. Returns false when another uid already holds it,
 * which is what stops one student from claiming a second identity.
 */
export async function reserveRoll(roll: string, uid: string): Promise<boolean> {
  const ref = rolls().doc(roll);
  const existing = await ref.get();

  if (existing.exists && existing.get("uid") !== uid) return false;

  await ref.set({ uid, claimedAt: FieldValue.serverTimestamp() }, { merge: true });
  return true;
}

export async function releaseRoll(roll: string, uid: string): Promise<void> {
  const ref = rolls().doc(roll);
  const existing = await ref.get();

  if (existing.exists && existing.get("uid") === uid) {
    await ref.delete();
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** How many profiles point at this Cloudinary image (used before deleting a shared-looking id). */
export async function countProfilesWithPicture(publicId: string): Promise<number> {
  const snap = await profiles().where("profilePicture.publicId", "==", publicId).count().get();
  return snap.data().count;
}
