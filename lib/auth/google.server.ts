import "server-only";

import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";

import { adminAuth } from "../firebase/admin";
import { findProfileById } from "../db/students/students.admin.repo";
import { isOldDirectoryEmail } from "./join.server";
import { maskEmail } from "./oob.server";
import { createSessionCookie } from "./session";
import { idTokenForUid } from "./verification.server";

/**
 * "Continue with Google", entirely server-side (no `firebase/auth` in the
 * browser):
 *
 *   /api/auth/google/start     → Google consent screen (state + PKCE)
 *   /api/auth/google/callback  → code → Google id_token
 *                              → Identity Toolkit `signInWithIdp` → session cookie
 *
 * The same route signs up new users and signs in existing ones. An address
 * with an unclaimed old-directory profile is sent to Claim without a session:
 * reclaiming is only possible through the emailed link. A normal password
 * account with the same (Google-verified) address gets Google linked to it.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const IDP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp";
const STATE_COOKIE = "__g_oauth";
const STATE_MAX_AGE_S = 10 * 60;

export const GOOGLE_ERROR_PATH = "/profiles/update?authError=google";

function config() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured");
  }
  return { clientId, clientSecret };
}

function apiKey(): string {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not configured");
  return key;
}

/**
 * The callback must return to the origin that started the flow — that is
 * where the state cookie lives — so it is built from the request, not from
 * `NEXT_PUBLIC_SITE_URL` (which may point at a different deployment). Using
 * the request origin is safe here: Google only redirects to URIs registered on
 * the OAuth client, so a forged Host header just fails with
 * `redirect_uri_mismatch`.
 */
function redirectUriFor(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/auth/google/callback`;
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** Only same-site paths; never `//host` or `/\host`, which browsers treat as external. */
function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return null;
  }
  return next.slice(0, 512);
}

/** Builds the consent URL and stores state + PKCE verifier in a short-lived cookie. */
export async function startGoogleSignIn(next: string | null, origin: string): Promise<string> {
  const { clientId } = config();
  const redirectUri = redirectUriFor(origin);
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const cookieStore = await cookies();
  cookieStore.set(
    STATE_COOKIE,
    JSON.stringify({ state, verifier, next: safeNext(next), redirectUri }),
    {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax is required: the cookie must ride along on Google's top-level
    // redirect back to the callback.
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: STATE_MAX_AGE_S,
    },
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });

  return `${AUTH_URL}?${params}`;
}

type GooglePayload = { email?: string; email_verified?: boolean; sub?: string };

/** The id_token came straight from Google's token endpoint over TLS, so its payload is trusted here; Firebase re-verifies it in `signInWithIdp`. */
function decodePayload(idToken: string): GooglePayload {
  const part = idToken.split(".")[1] ?? "";
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as GooglePayload;
  } catch {
    return {};
  }
}

function fail(reason: string): string {
  console.error(`[auth] google -> ${reason}`);
  return GOOGLE_ERROR_PATH;
}

/** Handles the callback and returns the path to redirect to. */
export async function completeGoogleSignIn(params: URLSearchParams): Promise<string> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.set(STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });

  let saved: {
    state?: string;
    verifier?: string;
    next?: string | null;
    redirectUri?: string;
  } = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    saved = {};
  }

  if (params.get("error")) return fail(`consent-${params.get("error")}`);

  const code = params.get("code");
  if (
    !code ||
    !saved.state ||
    !saved.verifier ||
    !saved.redirectUri ||
    params.get("state") !== saved.state
  ) {
    return fail("state-mismatch");
  }

  const { clientId, clientSecret } = config();

  // 1. Authorization code → Google id_token.
  let googleIdToken: string | undefined;
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        // Must equal the redirect_uri sent at start, byte for byte.
        redirect_uri: saved.redirectUri,
        grant_type: "authorization_code",
        code_verifier: saved.verifier,
      }),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!response.ok || !data.id_token) return fail(`token-exchange ${data.error ?? response.status}`);
    googleIdToken = data.id_token;
  } catch (error) {
    console.error("[auth] google token request failed", error);
    return GOOGLE_ERROR_PATH;
  }

  const payload = decodePayload(googleIdToken);
  const email = payload.email?.trim().toLowerCase();
  if (!email || payload.email_verified !== true || !payload.sub) {
    return fail("unverified-google-email");
  }

  // 2. Old-directory profiles are reclaimed only through the emailed link.
  if (await isOldDirectoryEmail(email)) {
    console.log(`[auth] google ${maskEmail(email)} -> old-directory (sent to claim)`);
    return "/profiles/claim?from=google";
  }

  // 3. Google id_token → Firebase account (created on first use).
  const idp = await fetch(`${IDP_URL}?key=${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: saved.redirectUri,
      returnSecureToken: true,
      returnIdpCredential: true,
    }),
    cache: "no-store",
  })
    .then(async (response) => ({
      ok: response.ok,
      data: (await response.json().catch(() => ({}))) as {
        idToken?: string;
        localId?: string;
        needConfirmation?: boolean;
        isNewUser?: boolean;
        error?: { message?: string };
      },
    }))
    .catch((error) => {
      console.error("[auth] google signInWithIdp request failed", error);
      return null;
    });

  if (!idp) return GOOGLE_ERROR_PATH;
  if (!idp.ok) return fail(`idp ${idp.data.error?.message ?? "UNKNOWN"}`);

  let uid = idp.data.localId ?? "";
  let firebaseIdToken = idp.data.idToken;

  // 4. Same address already registered with a password: Google has proved the
  //    mailbox, so attach Google to that account and sign it in.
  if (idp.data.needConfirmation || !firebaseIdToken) {
    try {
      const existing = await adminAuth.getUserByEmail(email);
      await adminAuth.updateUser(existing.uid, {
        providerToLink: { providerId: "google.com", uid: payload.sub, email },
      });
      uid = existing.uid;
      firebaseIdToken = (await idTokenForUid(uid)) ?? undefined;
      console.log(`[auth] google ${maskEmail(email)} -> linked to existing uid=${uid}`);
    } catch (error) {
      console.error("[auth] google link failed", error);
      return GOOGLE_ERROR_PATH;
    }
  }

  if (!firebaseIdToken || !uid) return fail("no-token");

  try {
    await createSessionCookie(firebaseIdToken);

    const user = await adminAuth.getUser(uid);
    if (!user.emailVerified) await adminAuth.updateUser(uid, { emailVerified: true });
  } catch (error) {
    console.error("[auth] google session creation failed", error);
    return GOOGLE_ERROR_PATH;
  }

  const profile = await findProfileById(uid);
  console.log(
    `[auth] google ${maskEmail(email)} -> ok uid=${uid} new=${idp.data.isNewUser === true} hasProfile=${profile !== null}`,
  );

  if (!profile) return "/profiles/create";
  return saved.next ?? `/profiles/${uid}`;
}
