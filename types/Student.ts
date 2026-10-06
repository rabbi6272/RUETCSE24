export type Section = "a" | "b" | "c";

export type SectionFilter = "All" | Section;

export interface ProfilePicture {
  publicId: string;
  url: string;
}

/**
 * Public directory profile. Stored at `profiles/{uid}` where `uid` is the
 * Firebase Auth user id — there is no separate client-generated id, so a
 * profile can never be orphaned from its owner.
 *
 * NOTE: contains no credential material. Passwords live in Firebase Auth and
 * are never readable by the client. `mobileNumber` deliberately does NOT live
 * here — it is in `profiles/{uid}/private/contact`, which rules deny to clients.
 */
export interface Profile {
  id: string;
  fullName: string;
  nickname: string;
  email: string;
  roll: string;
  /**
   * Two-digit series id (`"24"`), always derived from `roll` at the service
   * layer (`types/series.ts`) and stored only so directory queries can filter
   * with a single equality where. Never accepted from client input.
   */
  series: string;
  sec: Section;
  bloodGroup: string;
  bio: string;
  hobby: string;
  fbProfile: string;
  profilePicture: ProfilePicture;
  published: boolean;
  createdAt: number;
  updatedAt: number;
  claimedAt: number;
}

/** Field owners may edit. `email` and `series` are intentionally not editable. */
export type ProfileDraft = Omit<
  Profile,
  "id" | "email" | "series" | "published" | "createdAt" | "updatedAt" | "claimedAt"
>;

/** `profiles/{uid}/private/contact` — server-read only. */
export interface PrivateContact {
  mobileNumber: string;
}

/**
 * A pre-Firebase-Auth profile waiting to be claimed. Stored at
 * `legacyProfiles/{sha256(normalizedEmail)}` and readable only by the Admin SDK.
 */
export interface LegacyProfile {
  legacyId: string;
  fullName: string;
  nickname: string;
  email: string;
  roll: string;
  sec: Section | "";
  bloodGroup: string;
  bio: string;
  hobby: string;
  fbProfile: string;
  mobileNumber: string;
  profilePicture: ProfilePicture;
  createdAt: number;
}

export interface SessionUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  /**
   * True while the account still holds its seeded bootstrap credential — the
   * pincode that used to sit in a publicly readable Firestore document.
   *
   * This is a distinct state from "signed in": the session is valid, but the
   * only action permitted is replacing the password. Treating it as
   * unauthenticated would be wrong (the student did prove who they are), and
   * ignoring it would leave a known-public password usable indefinitely.
   */
  mustRotate: boolean;
  /**
   * True when the profile's section was derived from the roll number rather
   * than stated by the student, so it is worth asking them to confirm it.
   */
  needsSection: boolean;
}

export const SECTION_LABELS: Record<SectionFilter, string> = {
  All: "All sections",
  a: "Section A",
  b: "Section B",
  c: "Section C",
};

export const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

export type BloodGroup = (typeof BLOOD_GROUPS)[number];
