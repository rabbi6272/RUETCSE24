import "server-only";

import {
  deleteProfileDoc,
  findProfileByEmail,
  findProfileById,
  getPrivateContact,
  listProfiles,
  patchProfile,
  releaseRoll,
  reserveRoll,
  setPrivateContact,
  writeProfile,
} from "./students.admin.repo";
import {
  updateContactSchema,
  updateProfileSchema,
  type ProfileDraftInput,
  type UpdateProfileInput,
} from "./students.schema";
import { toProfile } from "./students.mapper";
import { seriesFromRoll } from "../../../types/series";

import type { PrivateContact, Profile } from "../../../types/Student";

/**
 * Business rules live here, not in the repos, so that no caller can reach a
 * write without passing the ownership and uniqueness checks. Repos stay dumb on
 * purpose.
 *
 * Every function here takes the caller's uid as its first argument and never
 * accepts it from the client.
 */

type Result<T> = { ok: true } & T | { ok: false; error: string };

export async function getProfile(uid: string): Promise<Profile | null> {
  return findProfileById(uid);
}

export async function getContact(uid: string): Promise<PrivateContact | null> {
  return getPrivateContact(uid);
}

export async function listAllProfiles(): Promise<Profile[]> {
  return listProfiles();
}

export async function findProfileByEmailAddress(email: string): Promise<Profile | null> {
  return findProfileByEmail(email.trim().toLowerCase());
}

export async function createProfileFor(
  uid: string,
  email: string,
  draft: ProfileDraftInput,
  contact?: { mobileNumber?: string },
): Promise<Result<{ profile: Profile }>> {
  const existing = await findProfileById(uid);

  if (existing) {
    return { ok: false, error: "You already have a profile." };
  }

  const emailOwner = await findProfileByEmail(email);

  if (emailOwner && emailOwner.id !== uid) {
    return { ok: false, error: "That email address is already linked to a profile." };
  }

  // The series is derived from the roll, never taken from input — the stored
  // field exists only so directory queries can filter with one equality where.
  const series = seriesFromRoll(draft.roll);

  if (!series) {
    return { ok: false, error: "Roll must be a valid CSE roll number." };
  }

  if (!(await reserveRoll(draft.roll, uid))) {
    return { ok: false, error: "That roll number has already been claimed." };
  }

  const now = Date.now();
  const profile: Profile = {
    ...draft,
    id: uid,
    email: email.trim().toLowerCase(),
    series: series.id,
    published: true,
    createdAt: now,
    updatedAt: now,
    claimedAt: now,
  };

  try {
    await writeProfile(uid, profile);

    if (contact?.mobileNumber) {
      const parsedContact = updateContactSchema.safeParse(contact);

      if (parsedContact.success) {
        await setPrivateContact(uid, parsedContact.data);
      }
    }

    return { ok: true, profile };
  } catch (error) {
    // Undo the roll reservation and drop the partial document, so a transient
    // failure leaves nothing behind and the student can simply retry.
    await releaseRoll(draft.roll, uid).catch(() => undefined);
    await deleteProfileDoc(uid).catch(() => undefined);
    throw error;
  }
}

export async function updateProfileFor(
  uid: string,
  patch: UpdateProfileInput,
): Promise<Result<{ profile: Profile }>> {
  const current = await findProfileById(uid);

  if (!current) {
    return { ok: false, error: "You do not have a profile yet." };
  }

  const parsed = updateProfileSchema.safeParse(patch);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const next = parsed.data;

  // A roll change has to release the old number before reserving the new one,
  // otherwise changing "2403001" to "2403002" would collide with itself.
  if (next.roll && next.roll !== current.roll) {
    const nextSeries = seriesFromRoll(next.roll);

    // A roll edit can never migrate a profile into another series' directory.
    if (!nextSeries || nextSeries.id !== current.series) {
      return { ok: false, error: "You can only change your roll within your own series." };
    }

    if (!(await reserveRoll(next.roll, uid))) {
      return { ok: false, error: "That roll number has already been claimed." };
    }

    await releaseRoll(current.roll, uid).catch(() => undefined);
  }

  await patchProfile(uid, next as Record<string, unknown>);

  return { ok: true, profile: { ...current, ...next, id: uid } };
}

export async function updateContactFor(
  uid: string,
  contact: { mobileNumber: string },
): Promise<Result<{ contact: PrivateContact }>> {
  const current = await findProfileById(uid);

  if (!current) {
    return { ok: false, error: "You do not have a profile yet." };
  }

  const parsed = updateContactSchema.safeParse(contact);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  await setPrivateContact(uid, parsed.data);

  return { ok: true, contact: parsed.data };
}

/**
 * Powers the "did I claim already?" checker without exposing the directory:
 * returns the roll for an email only when it belongs to the caller.
 */
export async function getRollForClaimedEmail(email: string): Promise<string | null> {
  const profile = await findProfileByEmail(email);

  return profile ? profile.roll : null;
}
