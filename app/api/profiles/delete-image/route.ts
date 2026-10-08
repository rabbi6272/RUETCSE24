import { NextResponse } from "next/server";

import { getSession } from "../../../../lib/auth/session";
import {
  countProfilesWithPicture,
  findProfileById,
  patchProfile,
} from "../../../../lib/db/students/students.admin.repo";
import {
  NO_PICTURE,
  avatarPublicId,
  destroyImage,
  ownsImage,
} from "../../../../lib/media/avatar.server";
import { revalidateAll } from "../../../../lib/revalidate";

/**
 * Removes the caller's photo. Takes no identifier: the target is always the
 * caller's own avatar id, or the id on their own profile when it predates the
 * avatar scheme (checked by `ownsImage`). The profile is cleared immediately.
 */
export async function DELETE() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Sign in to change your photo." }, { status: 401 });
  }

  try {
    const profile = await findProfileById(session.uid);
    const current = profile?.profilePicture?.publicId ?? "";

    // No profile yet (create form) or no stored id: remove the avatar file if
    // one was uploaded. Destroying a missing asset is a no-op.
    const target = current || avatarPublicId(session.uid);

    if (!(await ownsImage(session.uid, target, countProfilesWithPicture, 1))) {
      console.error(`[photo] delete refused uid=${session.uid} (not owner)`);
      return NextResponse.json({ error: "You can only remove your own photo." }, { status: 403 });
    }

    if (!(await destroyImage(target))) {
      return NextResponse.json({ error: "Failed to delete image." }, { status: 500 });
    }

    // Clear the reference even when Cloudinary had already lost the asset, so
    // the profile never points at a dead URL.
    if (profile) await patchProfile(session.uid, { profilePicture: NO_PICTURE });

    console.log(`[photo] delete uid=${session.uid} hadProfile=${profile !== null}`);
    revalidateAll();
    return NextResponse.json({ message: "Image deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("[photo] delete failed:", error);
    return NextResponse.json({ error: "An error occurred while deleting the image" }, { status: 500 });
  }
}
