/**
 * Multi-series backfill: stamps `profiles/{uid}.series` from each document's
 * roll number, using the registry in `types/series.ts`.
 *
 * The directory query filters on `series`, so every existing profile needs the
 * field before the new code goes live. Documents whose roll matches no
 * registered series are reported and left untouched — fix those rolls by hand
 * rather than guessing a series.
 *
 * Runs as a dry run unless `--apply` is passed, because it touches production
 * data. Documents whose roll is not even 7 digits are test junk: they are
 * reported always and deleted (doc + private contact + roll index) on apply.
 * Deploy order: run this with `--apply`, then ship the app + rules together
 * (rules reject writes that lack `series`).
 *
 *   npx tsx scripts/backfill-series.ts
 *   npx tsx scripts/backfill-series.ts --apply
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";

import { seriesFromRoll } from "../types/series";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const BATCH_SIZE = 400;

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
    throw new Error(`Missing env: ${missing.join(", ")}`);
  }

  if (getApps().length > 0) return getFirestore();

  return getFirestore(
    initializeApp({
      credential: cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! }),
    }),
  );
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function main() {
  const db = initAdmin();

  console.log(APPLY ? "MODE: APPLY (writes enabled)" : "MODE: DRY RUN (no writes)");

  const snap = await db.collection("profiles").count().get();
  const total = snap.data().count;
  console.log(`Scanning ${total} profile documents…`);

  let stamped = 0;
  let alreadySet = 0;
  let noRoll = 0;
  const unmatched: string[] = [];
  /** Rolls that are not even 7 digits — cannot belong to any series. */
  const invalid: Array<{ id: string; roll: string; fullName: unknown }> = [];

  let batch = db.batch();
  let pending = 0;
  let flushes = 0;

  const all = await db.collection("profiles").get();

  for (const doc of all.docs) {
    const data = doc.data() as DocumentData;
    const roll = str(data.roll);
    const stored = str(data.series);
    const derived = seriesFromRoll(roll);

    if (!roll) {
      noRoll += 1;
      console.warn(`  ! ${doc.id}: no roll`);
      continue;
    }

    if (!/^\d{7}$/.test(roll)) {
      invalid.push({ id: doc.id, roll, fullName: data.fullName });
      continue;
    }

    if (!derived) {
      unmatched.push(`${doc.id} (roll ${roll})`);
      continue;
    }

    if (stored === derived.id) {
      alreadySet += 1;
      continue;
    }

    if (stored && stored !== derived.id) {
      // A stored series that disagrees with the roll is stale metadata: the
      // roll is authoritative, so overwrite — but say so loudly.
      console.warn(`  ! ${doc.id}: series "${stored}" disagrees with roll ${roll}; overwriting with "${derived.id}"`);
    }

    stamped += 1;

    if (APPLY) {
      batch.update(doc.ref, { series: derived.id });
      pending += 1;
      if (pending >= BATCH_SIZE) {
        await batch.commit();
        flushes += 1;
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (APPLY && pending > 0) {
    await batch.commit();
    flushes += 1;
  }

  // Invalid rolls (not 7 digits) cannot be filed into any series. The user
  // approved deleting them — they are test junk polluting the public directory.
  if (invalid.length > 0) {
    console.log("\nInvalid rolls (would be deleted" + (APPLY ? "" : " with --apply") + "):");
    for (const item of invalid) {
      console.log(`  x ${item.id} roll=${item.roll} name=${JSON.stringify(item.fullName)}`);
    }
    if (APPLY) {
      const del = db.batch();
      for (const item of invalid) {
        const ref = db.collection("profiles").doc(item.id);
        del.delete(ref);
        del.delete(ref.collection("private").doc("contact"));
        const rollRef = db.collection("rollIndex").doc(str(item.roll));
        const rollSnap = await rollRef.get();
        if (rollSnap.exists && rollSnap.get("uid") === item.id) del.delete(rollRef);
      }
      await del.commit();
      console.log(`  deleted ${invalid.length} document(s) + their private contact / roll index entries`);
    }
  }

  console.log("\n--- summary ---");
  console.log(`total:      ${total}`);
  console.log(`stamped:    ${stamped}${APPLY ? " (written)" : " (would write)"}`);
  console.log(`already ok: ${alreadySet}`);
  console.log(`no roll:    ${noRoll}`);
  console.log(`invalid:    ${invalid.length}`);
  console.log(`unmatched:  ${unmatched.length}`);
  for (const id of unmatched) console.log(`  ? ${id}`);
  if (APPLY) console.log(`batches:    ${flushes}`);

  if (!APPLY) {
    console.log("\nThis was a dry run. Re-run with --apply to perform the backfill.");
  } else if (unmatched.length > 0 || noRoll > 0) {
    console.log("\nSome documents could not be stamped — review them before deploying.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
