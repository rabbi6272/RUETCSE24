/**
 * Absolute base URL for links that leave the app (auth emails' `continueUrl`).
 *
 * Resolution order:
 *  1. `NEXT_PUBLIC_SITE_URL` — explicit override, wins everywhere (also lets
 *     local dev send links that point at the deployed site).
 *  2. Vercel production — `VERCEL_PROJECT_PRODUCTION_URL`, the stable
 *     `*.vercel.app` (or custom) domain of the production deployment.
 *  3. Vercel preview — the branch URL, falling back to the deployment URL.
 *  4. Local dev — `http://localhost:3000`.
 *
 * The request's Host header is deliberately not used: it is client-controlled,
 * and these links carry single-use sign-in codes.
 *
 * Whatever domain this returns must be listed in Firebase Auth → Settings →
 * Authorized domains, or Firebase refuses to send (`UNAUTHORIZED_DOMAIN`).
 */
export function siteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelHost =
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}

/** `siteBaseUrl()` + path, e.g. `siteUrlFor("/profiles/claim")`. */
export function siteUrlFor(path: string): string {
  return `${siteBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
