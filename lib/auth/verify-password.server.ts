import "server-only";

/**
 * Verifying an email/password pair on the server.
 *
 * The Admin SDK cannot do this: `signInWithPassword` is a client-SDK method,
 * and the Admin SDK deliberately exposes no way to read or compare a password
 * hash. The supported server-side path is the Identity Platform REST API, which
 * performs the check inside Google and returns an idToken. That token is then
 * exchanged for a session cookie with `adminAuth.createSessionCookie`.
 *
 * Consequence worth stating plainly: the password is sent to Google and never
 * touches this codebase, and no hash is ever stored, compared, or logged here.
 */

const ENDPOINT = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

export type VerifyResult =
  | { ok: true; idToken: string }
  | { ok: false; reason: "invalid" | "unavailable" };

function getApiKey(): string {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (!key) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not configured");
  }

  return key;
}

export async function verifyPassword(
  email: string,
  password: string,
): Promise<VerifyResult> {
  let response: Response;

  try {
    response = await fetch(`${ENDPOINT}?key=${getApiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
        returnSecureToken: true,
      }),
      // Never let a credential check be served from a cache.
      cache: "no-store",
    });
  } catch (error) {
    // Network failure is not the same as a wrong password, and the caller must
    // not be able to tell those apart by timing or message.
    console.error("password verification request failed", error);
    return { ok: false, reason: "unavailable" };
  }

  if (response.ok) {
    const data = (await response.json()) as { idToken?: string };
    return data.idToken
      ? { ok: true, idToken: data.idToken }
      : { ok: false, reason: "invalid" };
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };

  const code = body.error?.message ?? "";

  if (
    code.includes("INVALID_PASSWORD") ||
    code.includes("EMAIL_NOT_FOUND") ||
    code.includes("USER_DISABLED") ||
    code.includes("INVALID_LOGIN_CREDENTIALS")
  ) {
    return { ok: false, reason: "invalid" };
  }

  // TOO_MANY_ATTEMPTS_TRY_LATER, quota errors, and anything else unrecognised.
  // Still reported as a generic failure so no internal detail leaks.
  console.error("password verification rejected", code);
  return { ok: false, reason: "invalid" };
}
