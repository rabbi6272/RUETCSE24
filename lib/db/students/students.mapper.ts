import type {
  LegacyProfile,
  PrivateContact,
  Profile,
  ProfilePicture,
  Section,
} from "../../../types/Student";
import { seriesFromRoll } from "../../../types/series";

type Raw = Record<string, unknown>;

/**
 * Total mappers: Firestore `DocumentData` is untyped, so every read is
 * narrowed here rather than cast at the call site. `id` is always the document
 * id, never a field the client controls.
 */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function section(value: unknown): Section {
  return value === "a" || value === "b" || value === "c" ? value : "a";
}

function optionalSection(value: unknown): Section | "" {
  return value === "a" || value === "b" || value === "c" ? value : "";
}

function picture(value: unknown): ProfilePicture {
  const raw = (value ?? {}) as Raw;
  return { publicId: str(raw.publicId), url: str(raw.url) };
}

function pictureFromFlat(data: Raw): ProfilePicture {
  return {
    publicId: str(data.profilePicPublicId),
    url: str(data.profilePicUrl),
  };
}

export function toProfile(data: Raw, docId: string): Profile {
  const createdAt = num(data.createdAt, Date.now());
  const roll = str(data.roll);
  const rawSeries = str(data.series);

  return {
    id: docId,
    fullName: str(data.fullName),
    nickname: str(data.nickname),
    email: str(data.email),
    roll,
    // Documents written before the multi-series migration carry no `series`
    // field; derive it from the roll until the backfill script stamps them.
    series: rawSeries || seriesFromRoll(roll)?.id || "",
    sec: section(data.sec),
    bloodGroup: str(data.bloodGroup),
    bio: str(data.bio),
    hobby: str(data.hobby),
    fbProfile: str(data.fbProfile),
    profilePicture:
      data.profilePicture && typeof data.profilePicture === "object"
        ? picture(data.profilePicture)
        : pictureFromFlat(data),
    published: bool(data.published, true),
    createdAt,
    updatedAt: num(data.updatedAt, createdAt),
    claimedAt: num(data.claimedAt, createdAt),
  };
}

export function toPrivateContact(data: Raw): PrivateContact {
  return { mobileNumber: str(data.mobileNumber) };
}

export function toLegacyProfile(data: Raw, docId: string): LegacyProfile {
  return {
    legacyId: docId,
    fullName: str(data.fullName),
    nickname: str(data.nickname),
    email: str(data.email),
    roll: str(data.roll),
    sec: optionalSection(data.sec),
    bloodGroup: str(data.bloodGroup),
    bio: str(data.bio),
    hobby: str(data.hobby),
    fbProfile: str(data.fbProfile),
    mobileNumber: str(data.mobileNumber),
    profilePicture:
      data.profilePicture && typeof data.profilePicture === "object"
        ? picture(data.profilePicture)
        : pictureFromFlat(data),
    createdAt: num(data.createdAt, Date.now()),
  };
}
