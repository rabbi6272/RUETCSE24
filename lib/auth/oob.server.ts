import "server-only";

/**
 * Firebase Identity Toolkit out-of-band (OOB) actions, server-side.
 *
 * Firebase delivers these emails itself (Google infra, no DNS setup, no
 * third-party sender), which is why `lib/email/sender.ts` is gone. Two shapes
 * are used here:
 *
 *  - `sendOobCode` issues a link to the address (password reset, claim
 *    sign-in link, email verification). It only *sends* — completing the
 *    action happens either on Firebase's hosted page (reset/verify) or in our
 *    app via `signInWithOutboundLink` (claim, `canHandleCodeInApp`).
 *  - `signInWithOutboundLink` exchanges a clicked sign-in link's `oobCode`
 *    for an idToken. Identity Platform documents it as "signs in **or signs
 *    up**": a user record is created when the address has none, so the claim
 *    flow needs no separate account-creation step.
 *
 * Errors are surfaced as the raw Identity Toolkit message code so callers can
 * branch (e.g. `EMAIL_NOT_FOUND`), never to end users.
 */

const BASE = "https://identitytoolkit.googleapis.com/v1";

function getApiKey(): string {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is not configured");
  return key;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string };

async function post<T>(path: string, body: Record<string, unknown>): Promise<ApiResult<T>> {
  let response: Response;

  try {
    response = await fetch(`${BASE}/${path}?key=${getApiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    console.error(`identity toolkit ${path} request failed`, error);
    return { ok: false, code: "NETWORK_ERROR" };
  }

  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    idToken?: string;
  };

  if (response.ok) return { ok: true, data: data as T };

  const code = data.error?.message ?? "UNKNOWN";
  console.error(`identity toolkit ${path} rejected`, code);
  return { ok: false, code };
}

export type OobRequestType = "PASSWORD_RESET" | "EMAIL_SIGNIN" | "VERIFY_EMAIL";

/** `alice@example.com` → `a***@example.com`; logs never carry full addresses. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export async function sendOobCode(options: {
  requestType: OobRequestType;
  email: string;
  idToken?: string;
  continueUrl?: string;
  canHandleCodeInApp?: boolean;
}): Promise<ApiResult<{ requestType?: string }>> {
  const body: Record<string, unknown> = {
    requestType: options.requestType,
    email: options.email.trim().toLowerCase(),
  };

  if (options.idToken) body.idToken = options.idToken;
  if (options.continueUrl) body.continueUrl = options.continueUrl;
  if (options.canHandleCodeInApp !== undefined) {
    body.canHandleCodeInApp = options.canHandleCodeInApp;
  }

  const result = await post<{ requestType?: string }>("accounts:sendOobCode", body);
  const line = `[auth] oob ${options.requestType} ${maskEmail(body.email as string)} -> ${result.ok ? "sent" : result.code}`;
  if (result.ok) console.log(line);
  else console.error(line);
  return result;
}

/** Completes a clicked email sign-in link; creates the account if none exists. */
export async function signInWithOutboundLink(
  oobCode: string,
  email: string,
): Promise<ApiResult<{ idToken: string; email?: string; localId?: string }>> {
  const result = await post<{ idToken: string; email?: string; localId?: string }>(
    "accounts:signInWithEmailLink",
    {
      oobCode,
      email: email.trim().toLowerCase(),
    },
  );
  const line = `[auth] oob-exchange ${maskEmail(email.trim().toLowerCase())} -> ${result.ok ? "ok" : result.code}`;
  if (result.ok) console.log(line);
  else console.error(line);
  return result;
}
