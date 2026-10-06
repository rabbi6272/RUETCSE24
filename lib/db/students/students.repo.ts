import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { db } from "../../firebase/client";
import { COLLECTIONS } from "../../firebase/collections";
import { toProfile } from "./students.mapper";

import type { Profile } from "../../../types/Student";

/**
 * Client-side reads for the public directory.
 *
 * Only published documents are fetched, and the Firestore rules independently
 * refuse to serve an unpublished one — so a hand-crafted query cannot widen
 * the result set. Everything else (mobile number, legacy profiles, rate limits)
 * is unreachable from here by design.
 */
type Raw = Record<string, unknown>;

function toProfileDoc(snap: QueryDocumentSnapshot<DocumentData>): Profile {
  return toProfile(snap.data() as Raw, snap.id);
}

export async function listPublishedProfiles(series: string): Promise<Profile[]> {
  // Two equality filters: Firestore merges them without a composite index.
  const snap = await getDocs(
    query(
      collection(db, COLLECTIONS.profiles),
      where("series", "==", series),
      where("published", "==", true),
    ),
  );

  return snap.docs.map(toProfileDoc);
}

export async function getProfileDoc(uid: string): Promise<Profile | null> {
  const snap = await getDoc(
    doc(collection(db, COLLECTIONS.profiles), uid),
  );

  return snap.exists() ? toProfile(snap.data() as Raw, snap.id) : null;
}
