import "server-only";

import { adminAuth, adminDb } from "../firebase/admin";
import { COLLECTIONS } from "../firebase/collections";
import {
  joinCompleteSchema,
  joinStartSchema,
  type JoinCompleteInput,
} from "../db/students/students.schema";
import { findProfileById } from "../db/students/students.admin.repo";
import { sendOobCode, signInWithOutboundLink, maskEmail } from "./oob.server";
import { createSessionCookie, getSession } from "./session";
import { hashKey } from "./tokens";
import { idTokenForUid } from "./verification.server";
import { getSeries } from "../../types/series";

/**
 * Self sign-up for a series.
 *
 * The flow mirrors the claim flow: a Firebase EMAIL_SIGNIN link proves
 * mailbox control, and the exchange endpoint creates the account on first
 * sign-in — so no password exists until the student has proven the address,
 * and no unverified or passwordless account can be stranded by an abandoned
 * form. Because the link itself is the proof, the account is marked
 * `emailVerified` at exchange time; there is no separate verification email.
 *
 * Invariants:
 *  - one uniform response for new and existing addresses, so the endpoint
 *    cannot be used to enumerate accounts;
 *  - the series must be registered and open — decided server-side, never
 *    trusted from the client;
 *  - a resend cooldown, so the endpoint cannot be used to mail-bomb an
 *    address.
 */

const GENERIC_START_MESSAGE =
  "If that email can join, we've sent a sign-in link to it.";
const GENERIC_LINK_MESSAGE =
  "That link is invalid or has expired. Request a new one.";
const RESEND_COOLDOWN_MS = 60 * 1000;

type Result<T> = { ok: true } & T | { ok: false; error: string };

function siteBase(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://ruetcsearchive.app"
      : "http://localhost:3000");
  return base.replace(/\/+$/, "");
}

export function joinContinueUrl(seriesId: string): string {
  return `${siteBase()}/s/${seriesId}/join`;
}

function joinSendRef(email: string) {
  return adminDb
    .collection(COLLECTIONS.rateLimits)
    .doc(hashKey(`join:${email}`));
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Sends the magic sign-in link. Same response for every valid address. */
export async function startJoin(
  seriesId: string,
  rawEmail: string,
): Promise<Result<{ message: string }>> {
  const parsed = joinStartSchema.safeParse({ series: seriesId, email: rawEmail });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const entry = getSeries(parsed.data.series);
  if (!entry || entry.status !== "open") {
    console.log(`[auth] join start ${maskEmail(parsed.data.email)} -> series-${parsed.data.series}-closed`);
    return { ok: false, error: "This series is not accepting new accounts." };
  }

  const email = parsed.data.email;
  const now = Date.now();
  const ref = joinSendRef(email);
  console.log(`[auth] join start ${maskEmail(email)} series=${entry.id} -> eligible`);

  // Cooldown so the endpoint cannot be used to mail-bomb an address. A
  // resend inside the window is silently dropped; the previous link stays
  // valid.
  const canSend = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const lastSentAt = num((snap.data() as { lastSentAt?: unknown } | undefined)?.lastSentAt);
    if (now - lastSentAt < RESEND_COOLDOWN_MS) return false;
    tx.set(ref, { lastSentAt: now }, { merge: true });
    return true;
  });

  if (!canSend) {
    console.log(`[auth] join cooldown ${maskEmail(email)} (resend dropped)`);
  } else {
    await sendOobCode({
      requestType: "EMAIL_SIGNIN",
      email,
      continueUrl: joinContinueUrl(entry.id),
      canHandleCodeInApp: true,
    });
  }

  return { ok: true, message: GENERIC_START_MESSAGE };
}

/**
 * Exchanges the clicked link's `oobCode` for a session. The exchange creates
 * the account when none exists; either way the link has proved mailbox
 * control, so the account is marked verified here.
 */
export async function openJoinLink(
  rawOobCode: string,
  rawEmail: string,
): Promise<Result<{ hasProfile: boolean }>> {
  const oobCode = rawOobCode.trim();
  const parsed = joinStartSchema.omit({ series: true }).safeParse({ email: rawEmail });

  if (!oobCode || !parsed.success) {
    console.log("[auth] join link -> invalid-input");
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  const exchanged = await signInWithOutboundLink(oobCode, parsed.data.email);

  if (!exchanged.ok) {
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  const signedInAs = (exchanged.data.email ?? "").trim().toLowerCase();
  if (signedInAs && signedInAs !== parsed.data.email) {
    console.log(`[auth] join link -> email-mismatch ${maskEmail(parsed.data.email)}`);
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  // The clicked link is the proof of ownership — mark the account verified
  // before minting the cookie so every later fresh check passes.
  const uid = exchanged.data.localId ?? "";
  if (uid) {
    await adminAuth
      .updateUser(uid, { emailVerified: true })
      .catch((error) => console.error("[auth] join verify mark failed", error));
  }

  await createSessionCookie(exchanged.data.idToken);

  const session = await getSession();
  if (!session) {
    console.log("[auth] join link -> no-session after cookie");
    return { ok: false, error: GENERIC_LINK_MESSAGE };
  }

  // Belt: if the response omitted localId above, force it with the uid the
  // cookie actually carries.
  await adminAuth
    .getUser(session.uid)
    .then((user) =>
      user.emailVerified
        ? undefined
        : adminAuth.updateUser(session.uid, { emailVerified: true }),
    )
    .catch(() => undefined);

  const profile = await findProfileById(session.uid);
  console.log(
    `[auth] join link -> ok ${maskEmail(parsed.data.email)} hasProfile=${profile !== null}`,
  );
  return { ok: true, hasProfile: profile !== null };
}

/** Final step: set the password for the just-opened session. */
export async function completeJoin(
  input: JoinCompleteInput,
): Promise<Result<{ uid: string }>> {
  const parsed = joinCompleteSchema.safeParse(input);

  if (!parsed.success) {
    console.log("[auth] join complete -> invalid-input");
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const session = await getSession();
  if (!session) {
    console.log("[auth] join complete -> no-session");
    return { ok: false, error: "Your session expired. Start again." };
  }

  await adminAuth.updateUser(session.uid, { password: parsed.data.password });

  // A seeded series-24 account that came in through Join instead of Claim: the
  // link proved the mailbox and the pincode is now replaced, so lift the
  // rotation gate, end any pincode sessions, and re-open this one.
  if (session.mustRotate) {
    await adminAuth.setCustomUserClaims(session.uid, null);
    await adminAuth.revokeRefreshTokens(session.uid);

    const idToken = await idTokenForUid(session.uid).catch(() => null);
    if (idToken) await createSessionCookie(idToken);
    else console.error(`[auth] join complete re-sign-in failed uid=${session.uid}`);

    console.log(`[auth] join complete -> ok uid=${session.uid} (password set, activated)`);
    return { ok: true, uid: session.uid };
  }

  console.log(`[auth] join complete -> ok uid=${session.uid} (password set)`);
  return { ok: true, uid: session.uid };
}
