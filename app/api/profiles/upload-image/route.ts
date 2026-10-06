import { v2 as cloudinary } from "cloudinary";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { getSession } from "../../../../lib/auth/session";

/**
 * Profile image upload.
 *
 * Previously this endpoint was unauthenticated, so anyone could use the site's
 * Cloudinary credentials as a free image host. It now requires a session and
 * writes into a folder derived from the caller's uid, so an image can be traced
 * to the account that uploaded it and cannot be overwritten by another user.
 */

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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
      return NextResponse.json(
        { error: "File size exceeds 5MB limit" },
        { status: 400 },
      );
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
      .toFormat("webp", { quality: 80 })
      .toBuffer();

    const result = await uploadToCloudinary(optimizedBuffer, session.uid);

    return NextResponse.json(
      { success: true, url: result.secure_url, publicId: result.public_id },
      { status: 200 },
    );
  } catch (error) {
    console.error("Upload failed:", error);

    const errorMessage = error instanceof Error ? error.message : "Upload failed";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

function uploadToCloudinary(buffer: Buffer, uid: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        // Scoping the folder to the uid is what makes ownership checkable in
        // the delete route.
        folder: `Users/${uid}`,
        resource_type: "image",
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      },
    );

    stream.end(buffer);
  });
}
