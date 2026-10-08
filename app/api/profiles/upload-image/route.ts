import { NextResponse } from "next/server";
import sharp from "sharp";

import { getSession } from "../../../../lib/auth/session";
import {
  countProfilesWithPicture,
  findProfileById,
  patchProfile,
} from "../../../../lib/db/students/students.admin.repo";
import {
  avatarPublicId,
  destroyImage,
  ownsImage,
  uploadAvatar,
} from "../../../../lib/media/avatar.server";
import { revalidateAll } from "../../../../lib/revalidate";

/**
 * Profile photo upload. Requires a session, verifies the bytes with sharp,
 * re-encodes to WebP, and writes to the caller's single avatar id
 * (`Users/{uid}/avatar`, overwritten on every upload).
 *
 * When the caller already has a profile the new photo is saved onto it right
 * away (no "Save changes" needed) and the previous image, if it lived at a
 * different id (an old-site upload), is deleted. Without a profile yet — the
 * create form — the photo is only stored; `createProfileFor` picks it up.
 */

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Sign in to change your photo." }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("profile");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Only JPEG, PNG, and WebP are allowed" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File size exceeds 5MB limit" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // The declared content type is attacker-controlled, so confirm the bytes
    // really are an image before spending an upload on them.
    const metadata = await sharp(buffer).metadata();

    if (!metadata.width || !metadata.height) {
      return NextResponse.json({ error: "That file is not a valid image." }, { status: 400 });
    }

    const optimizedBuffer = await sharp(buffer)
      .resize({ width: 1920, height: 1920, fit: "inside" })
      .toFormat("webp", { quality: 70 })
      .toBuffer();

    const picture = await uploadAvatar(session.uid, optimizedBuffer);

    const profile = await findProfileById(session.uid);
    let saved = false;

    if (profile) {
      const previous = profile.profilePicture?.publicId ?? "";
      await patchProfile(session.uid, { profilePicture: picture });
      saved = true;

      // The old image is no longer referenced by this profile (hence 0).
      if (
        previous &&
        previous !== avatarPublicId(session.uid) &&
        (await ownsImage(session.uid, previous, countProfilesWithPicture, 0))
      ) {
        await destroyImage(previous).catch((error) =>
          console.error(`[photo] cleanup of previous image failed uid=${session.uid}`, error),
        );
      }
    }

    console.log(`[photo] upload uid=${session.uid} saved=${saved}`);
    if (saved) revalidateAll();

    return NextResponse.json({ success: true, ...picture, saved }, { status: 200 });
  } catch (error) {
    console.error("[photo] upload failed:", error);
    return NextResponse.json({ error: "Upload failed. Try again." }, { status: 500 });
  }
}
