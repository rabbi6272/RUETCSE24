import "server-only";

import { v2 as cloudinary } from "cloudinary";

import type { ProfilePicture } from "../../types/Student";

/**
 * Every profile photo lives at exactly one Cloudinary id: `Users/{uid}/avatar`.
 *
 *  - Re-uploading overwrites it, so replaced and abandoned uploads never pile
 *    up as orphans.
 *  - Ownership is the id itself — no lookup needed to know whose file it is.
 *  - The public URL is always produced here from Cloudinary's own response,
 *    never accepted from a client.
 *
 * Photos uploaded by the old site (`Users/<20-char id>`) are moved onto this
 * scheme by `scripts/migrate-profile-photos.ts`, and by Claim for entries
 * claimed later.
 */

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const NO_PICTURE: ProfilePicture = { publicId: "", url: "" };

/** Old-site upload ids carried over by the migration. */
export const LEGACY_PUBLIC_ID = /^Users\/[A-Za-z0-9]{20}$/;

export function avatarPublicId(uid: string): string {
  return `Users/${uid}/avatar`;
}

/** Strips a trailing file extension some legacy ids were stored with. */
export function cleanPublicId(publicId: string): string {
  return publicId.replace(/\.[^/.]+$/, "");
}

type UploadResult = { public_id: string; secure_url: string };

export function uploadAvatar(uid: string, buffer: Buffer): Promise<ProfilePicture> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: avatarPublicId(uid),
        resource_type: "image",
        overwrite: true,
        // Purge the CDN copy; the returned URL also carries a new version.
        invalidate: true,
      },
      (error, result) => {
        if (error || !result) reject(error ?? new Error("Empty Cloudinary response"));
        else resolve({ publicId: result.public_id, url: (result as UploadResult).secure_url });
      },
    );
    stream.end(buffer);
  });
}

/** The caller's current avatar as stored in Cloudinary, or null if none. */
export async function findAvatar(uid: string): Promise<ProfilePicture | null> {
  try {
    const resource = (await cloudinary.api.resource(avatarPublicId(uid))) as UploadResult;
    return { publicId: resource.public_id, url: resource.secure_url };
  } catch {
    return null;
  }
}

/** Moves an existing image to the owner's avatar id (overwriting any previous avatar). */
export async function moveToAvatar(publicId: string, uid: string): Promise<ProfilePicture> {
  const result = (await cloudinary.uploader.rename(cleanPublicId(publicId), avatarPublicId(uid), {
    overwrite: true,
    invalidate: true,
    resource_type: "image",
  })) as UploadResult;
  return { publicId: result.public_id, url: result.secure_url };
}

/** Deletes an image; a missing asset counts as success. */
export async function destroyImage(publicId: string): Promise<boolean> {
  const result = (await cloudinary.uploader.destroy(cleanPublicId(publicId), {
    resource_type: "image",
    invalidate: true,
  })) as { result?: string };
  return result.result === "ok" || result.result === "not found";
}

/**
 * Whether `uid` may destroy `publicId`, an id read from its own profile. Own
 * uploads always; an old-site id only when no *other* profile references it
 * (profile writes can no longer point at someone else's image, but this keeps
 * the delete path safe on its own).
 */
export async function ownsImage(
  uid: string,
  publicId: string,
  countProfilesWithPicture: (publicId: string) => Promise<number>,
  ownReferences: 0 | 1,
): Promise<boolean> {
  const clean = cleanPublicId(publicId);
  if (clean.startsWith(`Users/${uid}/`)) return true;
  if (!LEGACY_PUBLIC_ID.test(clean)) return false;
  return (await countProfilesWithPicture(publicId)) === ownReferences;
}
