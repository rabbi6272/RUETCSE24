import { v2 as cloudinary } from "cloudinary";
import { NextResponse } from "next/server";

import { getSession } from "../../../../lib/auth/session";
import { findProfileById, patchProfile } from "../../../../lib/db/students/students.admin.repo";

/**
 * Profile image deletion.
 *
 * The old version took a `publicId` from the request body and destroyed it, so
 * any unauthenticated caller could delete any image in the account. It now takes
 * no identifier at all: the target is always the caller's own current photo,
 * read from their profile, and the path is checked to belong to them before
 * anything is destroyed.
 */

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function DELETE() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Sign in to change your photo." }, { status: 401 });
  }

  try {
    const profile = await findProfileById(session.uid);
    const publicId = profile?.profilePicture?.publicId ?? "";

    if (!publicId) {
      return NextResponse.json({ error: "You have no photo to remove." }, { status: 404 });
    }

    const cleanPublicId = publicId.replace(/\.[^/.]+$/, "");

    // The upload route writes to `Users/{uid}`, so anything outside that prefix
    // is not this caller's file, whatever the profile document claims.
    if (!cleanPublicId.startsWith(`Users/${session.uid}/`)) {
      return NextResponse.json(
        { error: "You can only remove your own photo." },
        { status: 403 },
      );
    }

    const result = await cloudinary.uploader.destroy(cleanPublicId, {
      resource_type: "image",
    });

    if (result.result !== "ok" && result.result !== "not found") {
      return NextResponse.json(
        { error: "Failed to delete image from Cloudinary", result },
        { status: 500 },
      );
    }

    // Clear the reference even when Cloudinary had already lost the asset, so
    // the profile never points at a dead URL.
    await patchProfile(session.uid, { profilePicture: { publicId: "", url: "" } });

    return NextResponse.json({ message: "Image deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
    return NextResponse.json(
      { error: "An error occurred while deleting the image" },
      { status: 500 },
    );
  }
}
