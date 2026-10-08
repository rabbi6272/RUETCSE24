import { v2 as cloudinary } from "cloudinary";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Moves every profile photo onto the single-avatar scheme: `Users/{uid}/avatar`
 * (see `lib/media/avatar.server.ts`).
 *
 * Photos uploaded by the old site live at `Users/<20-char id>`, and early
 * uploads from this app at `Users/{uid}/<random>`. Each is renamed in
 * Cloudinary (the image itself is untouched) and the profile's
 * `profilePicture` is rewritten with the new id and URL.
 *
 * Skipped and reported, never guessed at:
 *  - an id referenced by more than one profile (ownership unclear);
 *  - an id outside both known shapes;
 *  - a rename Cloudinary refuses for any other reason.
 *
 * A profile whose photo no longer exists in Cloudinary has its dead reference
 * cleared (it was already showing a broken image).
 *
 * Dry run by default:
 *   node --env-file=.env --import tsx scripts/migrate-profile-photos.ts
 *   node --env-file=.env --import tsx scripts/migrate-profile-photos.ts --apply
 */

const APPLY = process.argv.includes("--apply");
const LEGACY = /^Users\/[A-Za-z0-9]{20}$/;

function init() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY missing");
  }
  if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error("CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET missing");
  }

  cloudinary.config({
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  return getFirestore(
    getApps()[0] ?? initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }),
  );
}

async function main() {
  const db = init();
  const snap = await db.collection("profiles").get();

  const refs = new Map<string, number>();
  for (const doc of snap.docs) {
    const id = String(doc.get("profilePicture.publicId") ?? "");
    if (id) refs.set(id, (refs.get(id) ?? 0) + 1);
  }

  const stats = {
    profiles: snap.size,
    noPhoto: 0,
    alreadyAvatar: 0,
    moved: 0,
    wouldMove: 0,
    missingCleared: 0,
    missingWouldClear: 0,
  };
  const skipped: string[] = [];

  for (const doc of snap.docs) {
    const uid = doc.id;
    const publicId = String(doc.get("profilePicture.publicId") ?? "");
    const target = `Users/${uid}/avatar`;
    const clean = publicId.replace(/\.[^/.]+$/, "");

    if (!publicId) {
      stats.noPhoto += 1;
      continue;
    }
    if (clean === target) {
      stats.alreadyAvatar += 1;
      continue;
    }
    if (!LEGACY.test(clean) && !clean.startsWith(`Users/${uid}/`)) {
      skipped.push(`uid=${uid} unknown id shape`);
      continue;
    }
    if ((refs.get(publicId) ?? 0) > 1) {
      skipped.push(`uid=${uid} id shared by ${refs.get(publicId)} profiles`);
      continue;
    }

    const exists = await cloudinary.api
      .resource(clean)
      .then(() => true)
      .catch((error: { error?: { http_code?: number } }) =>
        error?.error?.http_code === 404 ? false : Promise.reject(error),
      );

    if (!exists) {
      // An interrupted earlier run may have renamed the file but not updated
      // the profile: if the avatar is there, point the profile at it.
      const avatar = await cloudinary.api
        .resource(target)
        .then((r: { public_id: string; secure_url: string }) => r)
        .catch(() => null);

      if (avatar) {
        if (APPLY) {
          await doc.ref.update({
            profilePicture: { publicId: avatar.public_id, url: avatar.secure_url },
            updatedAt: Date.now(),
          });
          stats.moved += 1;
        } else {
          stats.wouldMove += 1;
        }
        continue;
      }

      if (APPLY) {
        await doc.ref.update({ profilePicture: { publicId: "", url: "" }, updatedAt: Date.now() });
        stats.missingCleared += 1;
      } else {
        stats.missingWouldClear += 1;
      }
      continue;
    }

    if (!APPLY) {
      stats.wouldMove += 1;
      continue;
    }

    try {
      const result = (await cloudinary.uploader.rename(clean, target, {
        overwrite: true,
        invalidate: true,
        resource_type: "image",
      })) as { public_id: string; secure_url: string };

      await doc.ref.update({
        profilePicture: { publicId: result.public_id, url: result.secure_url },
        updatedAt: Date.now(),
      });
      stats.moved += 1;
    } catch (error) {
      const message =
        (error as { error?: { message?: string }; message?: string }).error?.message ??
        (error as Error).message ??
        "unknown error";
      skipped.push(`uid=${uid} rename failed: ${message}`);
    }
  }

  console.log(`--- ${APPLY ? "applied" : "dry run"} ---`);
  console.log(stats);
  if (skipped.length > 0) {
    console.log(`\nskipped (${skipped.length}):`);
    for (const line of skipped) console.log(`  ${line}`);
  }
  if (!APPLY) console.log("\nRe-run with --apply to perform the moves.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
