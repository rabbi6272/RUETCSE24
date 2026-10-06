import "server-only";

import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getAdminApp() {
  if (getApps().length > 0) return getApp();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials are not configured. Set FIREBASE_PROJECT_ID, " +
        "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.",
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      // Env files store the PEM with literal "\n" sequences.
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });
}

const adminApp = getAdminApp();

/**
 * NOTE: the Admin SDK bypasses App Check by design — it is trusted server-side
 * code, and Firebase exposes no `enforceAppCheck` option for it. App Check
 * protects the *client* SDK path (the public directory reads); the safety of
 * this instance rests entirely on the service-account key never leaving the
 * server, which is what the `server-only` import above enforces.
 */
export const adminDb = getFirestore(adminApp);

export const adminAuth = getAuth(adminApp);
