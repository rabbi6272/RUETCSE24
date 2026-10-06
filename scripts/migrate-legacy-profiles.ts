/**
 * One-way migration: legacy `users` documents -> `legacyProfiles/{sha256(email)}`.
 *
 * The single most important thing this script does is DROP `pincode`. Those
 * plaintext values were readable by anyone who loaded the directory page, so
 * they are never copied into the new collection. Students set a real password
 * when they claim their profile.
 *
 * Runs as a dry run unless `--apply` is passed, because it touches production
 * data.
 *
 *   npx tsx scripts/migrate-legacy-profiles.ts
 *   npx tsx scripts/migrate-legacy-profiles.ts --apply
 *   npx tsx scripts/migrate-legacy-profiles.ts --apply --delete-source
 */

import crypto from "crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";

const SOURCE_COLLECTION = "users";
const TARGET_COLLECTION = "legacyProfiles";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const DELETE_SOURCE = args.has("--delete-source");
const OVERWRITE = args.has("--overwrite");
const BATCH_SIZE = 400;

type Raw = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function section(value: unknown): "a" | "b" | "c" | "" {
  const s = str(value).toLowerCase();
  return s === "a" || s === "b" || s === "c" ? s : "";
}

function picture(data: Raw): { publicId: string; url: string } {
  const nested = data.profilePicture;

  if (nested && typeof nested === "object") {
    const raw = nested as Raw;
    return { publicId: str(raw.publicId), url: str(raw.url) };
  }

  return {
    publicId: str(data.profilePicPublicId),
    url: str(data.profilePicUrl),
  };
}

function legacyIdForEmail(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
}

function initAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  const missing = [
    !projectId && "FIREBASE_PROJECT_ID",
    !clientEmail && "FIREBASE_CLIENT_EMAIL",
    !privateKey && "FIREBASE_PRIVATE_KEY",
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    console.error("Load them first, e.g. `set -a; source .env; set +a`");
    process.exit(1);
  }

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! }),
    });

  return getFirestore(app);
}

async function main() {
  const db = initAdmin();
  const source = db.collection(SOURCE_COLLECTION);
  const target = db.collection(TARGET_COLLECTION);

  console.log(APPLY ? "MODE: APPLY (writes enabled)" : "MODE: DRY RUN (no writes)");
  if (DELETE_SOURCE) {
    console.log("  --delete-source set: source documents will be removed after copy");
  }
  console.log(`Reading ${SOURCE_COLLECTION}...`);

  const snapshot = await source.get();
  const docs = snapshot.docs;

  console.log(`Found ${docs.length} legacy document(s).\n`);

  const stats = {
    ready: 0,
    wrote: 0,
    skippedExisting: 0,
    skippedNoEmail: 0,
    skippedDuplicateEmail: 0,
    droppedPincode: 0,
    deletedSource: 0,
  };

  const seenEmails = new Set<string>();
  const prepared: { id: string; payload: Raw; sourceId: string }[] = [];

  for (const doc of docs) {
    const data = doc.data() as Raw;
    const email = str(data.email).toLowerCase();

    if (!email) {
      stats.skippedNoEmail += 1;
      continue;
    }

    if (seenEmails.has(email)) {
      // Two documents for one address would collide on the same target id.
      stats.skippedDuplicateEmail += 1;
      continue;
    }
    seenEmails.add(email);

    const id = legacyIdForEmail(email);

    const existing = await target.doc(id).get();
    if (existing.exists && !OVERWRITE) {
      stats.skippedExisting += 1;
      continue;
    }

    if (typeof data.pincode === "string" && data.pincode.length > 0) {
      stats.droppedPincode += 1;
    }

    // `pincode` is intentionally absent. Nothing else from the source document
    // is carried over, so an unexpected field cannot leak through.
    prepared.push({
      id,
      sourceId: doc.id,
      payload: {
        fullName: str(data.fullName),
        nickname: str(data.nickname),
        email,
        roll: str(data.roll),
        sec: section(data.sec),
        bloodGroup: str(data.bloodGroup),
        bio: str(data.bio),
        hobby: str(data.hobby),
        fbProfile: str(data.fbProfile),
        mobileNumber: str(data.mobileNumber),
        profilePicture: picture(data),
        createdAt: num(data.createdAt, Date.now()),
      },
    });

    stats.ready += 1;
  }

  if (APPLY) {
    for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
      const chunk = prepared.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const item of chunk) {
        batch.set(target.doc(item.id), item.payload, { merge: OVERWRITE });
      }

      await batch.commit();
      stats.wrote += chunk.length;
      console.log(`  wrote ${stats.wrote}/${prepared.length}`);
    }

    if (DELETE_SOURCE) {
      for (const item of prepared) {
        await source.doc(item.sourceId).delete();
        stats.deletedSource += 1;
      }
    }
  }

  console.log("\n--- summary ---");
  console.log(`ready to migrate      ${stats.ready}`);
  if (APPLY) console.log(`written               ${stats.wrote}`);
  console.log(`already migrated      ${stats.skippedExisting}`);
  console.log(`no email, skipped     ${stats.skippedNoEmail}`);
  console.log(`duplicate email       ${stats.skippedDuplicateEmail}`);
  console.log(`pincodes DISCARDED    ${stats.droppedPincode}`);
  if (APPLY && DELETE_SOURCE) console.log(`source docs deleted   ${stats.deletedSource}`);

  if (!APPLY) {
    console.log("\nThis was a dry run. Re-run with --apply to perform the migration.");
  } else {
    console.log("\nNext: deploy firestore.rules, then tell students to run /profiles/claim.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
