/**
 * Read-only Firestore export to a single JSON file.
 *
 * This is the rollback point for the `users` -> `legacyProfiles` migration, so it
 * has to be a *faithful* backup rather than a convenient one:
 *
 *  - document ids are object keys. The legacy documents are `addDoc`-generated,
 *    so an id-less export could not be restored in place
 *  - Firestore `Timestamp` is encoded explicitly, because it does not survive
 *    `JSON.stringify` as anything meaningful
 *  - `GeoPoint` and `DocumentReference` are type-tagged rather than flattened
 *  - every collection is enumerated, and subcollections are walked
 *
 * It only ever reads. Nothing in this file writes to or deletes from Firestore.
 *
 * Run with Node's own dotenv loader, which parses .env the same way Next.js
 * does. This matters: `set -a; source .env` splits unquoted values on `;`, so it
 * silently truncates the existing OTP_SECRET.
 *
 *   node --env-file=.env --import tsx scripts/export-firestore.ts
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, chmodSync } from "node:fs";
import crypto from "node:crypto";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import {
  GeoPoint,
  Timestamp,
  getFirestore,
  type CollectionReference,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

const OUTPUT_PATH = "backup.json";
const PAGE_SIZE = 500;

/** Reserved key used to re-create non-JSON Firestore values on restore. */
const TYPE_KEY = "__type";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type ReadResult = {
  documents: { [docId: string]: Json };
  docCount: number;
  subcollectionCount: number;
};

function initFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  const missing = [
    !projectId && "FIREBASE_PROJECT_ID",
    !clientEmail && "FIREBASE_CLIENT_EMAIL",
    !privateKey && "FIREBASE_PRIVATE_KEY",
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    console.error(
      "Load them without mangling other values:\n" +
        "  node --env-file=.env --import tsx scripts/export-firestore.ts\n" +
        "Do NOT use `set -a; source .env` — it splits unquoted values on `;`.",
    );
    process.exit(1);
  }

  const key = privateKey!;
  const malformed =
    !key.includes("-----BEGIN PRIVATE KEY-----") ||
    !key.includes("-----END PRIVATE KEY-----") ||
    !key.includes("\n");

  if (malformed) {
    console.error("FIREBASE_PRIVATE_KEY is not a valid PEM service-account key.");
    console.error(
      "Expected one line holding \\n escapes (or real newlines) that contains both PEM markers.\n" +
        'In .env: FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"\n' +
        "Then load with: node --env-file=.env --import tsx scripts/export-firestore.ts",
    );
    process.exit(1);
  }

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: key }),
    });

  return getFirestore(app);
}

/**
 * Refuses to run when the output is not gitignored. The export contains every
 * profile in the project, so making this a hard precondition removes any chance
 * of committing it by accident.
 */
function assertOutputIsIgnored(): void {
  try {
    execFileSync("git", ["check-ignore", "-q", OUTPUT_PATH], { stdio: "ignore" });
  } catch {
    console.error(`Refusing to write ${OUTPUT_PATH}: it is not gitignored.`);
    console.error(`Add this to .gitignore and re-run:\n\n  ${OUTPUT_PATH}\n`);
    process.exit(1);
  }
}

function encode(value: unknown): Json {
  if (value === null || value === undefined) return null;

  if (value instanceof Timestamp) {
    return { [TYPE_KEY]: "Timestamp", value: value.toDate().toISOString() } as Json;
  }

  if (value instanceof GeoPoint) {
    return {
      [TYPE_KEY]: "GeoPoint",
      latitude: value.latitude,
      longitude: value.longitude,
    } as Json;
  }

  // DocumentReference lives in a different module than the Firestore types, so
  // it is detected structurally to avoid a second import.
  if (typeof value === "object" && "path" in value && "_serializer" in value) {
    return { [TYPE_KEY]: "DocumentReference", path: (value as { path: string }).path } as Json;
  }

  if (Array.isArray(value)) return value.map(encode);

  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, entry] of Object.entries(value as DocumentData)) {
      out[key] = encode(entry);
    }
    return out;
  }

  if (typeof value === "number" && !Number.isFinite(value)) return null;

  return value as Json;
}

/** Sorts object keys so two exports diff cleanly. */
function stableStringify(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  const padInner = " ".repeat(indent + 2);

  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => padInner + stableStringify(v, indent + 2)).join(",\n")}\n${pad}]`;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();

  if (keys.length === 0) return "{}";

  const body = keys
    .map((key) => {
      const encoded = stableStringify((value as Record<string, unknown>)[key], indent + 2);
      return `${padInner}${JSON.stringify(key)}: ${encoded}`;
    })
    .join(",\n");

  return `{\n${body}\n${pad}}`;
}

async function readCollection(
  collection: CollectionReference,
  prefix: string,
): Promise<ReadResult> {
  const documents: { [docId: string]: Json } = {};
  let docCount = 0;
  let subcollectionCount = 0;

  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  for (;;) {
    const query = collection.orderBy("__name__").limit(PAGE_SIZE);
    if (cursor) query.startAfter(cursor);

    const page = await query.get();
    if (page.empty) break;

    for (const doc of page.docs) {
      documents[doc.id] = encode(doc.data());
      docCount += 1;
      cursor = doc;
    }

    // Subcollections are not returned by a document `get`, so they are walked
    // explicitly. None exist today; this is so the export cannot quietly miss
    // them if that changes.
    for (const doc of page.docs) {
      const subcollections = await doc.ref.listCollections();

      for (const sub of subcollections) {
        const nested = await readCollection(sub, `${prefix}/${doc.id}/${sub.id}`);
        subcollectionCount += nested.docCount;

        if (Object.keys(nested.documents).length > 0) {
          documents[`${doc.id}__${sub.id}`] = nested.documents as unknown as Json;
        }
      }
    }

    if (page.size < PAGE_SIZE) break;
  }

  return { documents, docCount, subcollectionCount };
}

/**
 * Verifies the encoding rules without touching Firestore. Worth running once
 * after any change here, because a silent encoding regression would produce a
 * backup that looks fine and cannot be restored.
 */
function selfTest(): void {
  const cases: { name: string; input: unknown; expected: Json }[] = [
    {
      name: "Timestamp becomes an ISO string, not an empty object",
      input: { createdAt: new Timestamp(1_700_000_000, 0) },
      expected: { createdAt: { __type: "Timestamp", value: "2023-11-14T22:13:20.000Z" } },
    },
    {
      name: "scalars pass through unchanged",
      input: { roll: "2403001", published: true, bio: "", count: 0 },
      expected: { roll: "2403001", published: true, bio: "", count: 0 },
    },
    {
      name: "null and undefined normalise to null",
      input: { a: null, b: undefined },
      expected: { a: null, b: null },
    },
    {
      name: "timestamps nested in maps and arrays survive",
      input: { history: [{ at: new Timestamp(0, 0) }] },
      expected: { history: [{ at: { __type: "Timestamp", value: "1970-01-01T00:00:00.000Z" } }] },
    },
    {
      name: "GeoPoint is type-tagged",
      input: { where: new GeoPoint(90, -180) },
      expected: { where: { __type: "GeoPoint", latitude: 90, longitude: -180 } },
    },
    {
      name: "DocumentReference keeps its path",
      input: { ref: { _serializer: {}, path: "users/abc123" } },
      expected: { ref: { __type: "DocumentReference", path: "users/abc123" } },
    },
    {
      name: "non-finite numbers become null rather than invalid JSON",
      input: { bad: Number.NaN },
      expected: { bad: null },
    },
  ];

  let failed = 0;

  for (const test of cases) {
    const actual = encode(test.input);
    const pass = stableStringify(actual) === stableStringify(test.expected);

    if (pass) {
      console.log(`  pass  ${test.name}`);
    } else {
      failed += 1;
      console.error(`  FAIL  ${test.name}`);
      console.error(`        expected ${stableStringify(test.expected)}`);
      console.error(`        actual   ${stableStringify(actual)}`);
    }
  }

  // Key ordering must be deterministic so two exports diff cleanly.
  const a = stableStringify({ b: 1, a: 2 });
  const b = stableStringify({ a: 2, b: 1 });

  if (a === b) {
    console.log("  pass  key order is stable across exports");
  } else {
    failed += 1;
    console.error("  FAIL  key order is not stable");
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed. Do not rely on this export.`);
    process.exit(1);
  }

  console.log("\nAll encoding checks passed.");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  assertOutputIsIgnored();

  const db = initFirestore();
  console.log("Reading every collection (read-only)...\n");

  const collections = await db.listCollections();
  const output: { [path: string]: { [docId: string]: Json } } = {};
  const counts: { [path: string]: number } = {};

  let total = 0;

  for (const collection of collections) {
    const path = collection.id;
    process.stdout.write(`  ${path} ... `);

    const result = await readCollection(collection, path);

    output[path] = result.documents;
    counts[path] = result.docCount;
    total += result.docCount + result.subcollectionCount;

    console.log(`${result.docCount} document(s)`);
  }

  const backup = {
    meta: {
      format: "ruetcse24-firestore-backup@1",
      projectId: process.env.FIREBASE_PROJECT_ID,
      exportedAt: new Date().toISOString(),
      documentCount: total,
      collectionCount: Object.keys(output).length,
      collections: counts,
    },
    collections: output,
  };

  writeFileSync(OUTPUT_PATH, `${stableStringify(backup)}\n`, { encoding: "utf8" });
  chmodSync(OUTPUT_PATH, 0o600);

  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(`  collections   ${Object.keys(output).length}`);
  console.log(`  documents     ${total}`);
  console.log("  permissions   600 (owner read/write only)");

  if (Object.keys(output).length === 0) {
    console.log("\nNo collections found. Check the project id and that the key belongs to it.");
  } else {
    console.log(
      "\nThis file contains the legacy plaintext pincode values, real email\n" +
        "addresses, and mobile numbers. Treat it as a secret: do not commit it,\n" +
        "and keep an encrypted copy somewhere other than this git working tree.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
