# Implementation Plan — Multi-Series Directory + Firebase Email (Phase 0)

> **Handoff document.** An agent can implement everything below from this file alone.
> Repo: Next.js 15 (App Router) + Firebase (Firestore, Auth, Admin SDK) + TanStack Query.
> Verify after every phase: `npx tsc --noEmit` && `npx next build`.
> **Do NOT run `next lint`** — no ESLint config exists and it prompts interactively.

---

## 0. Confirmed product decisions (do not re-litigate)

1. **Scope**: all historical CSE series, driven by a **data registry** (roll formats/section counts may vary per series). Only series **24** has legacy/claim data today.
2. **Auth/email**: **All-Firebase.** Password reset, sign-up verification, and claim (redesigned as a magic link) use Firebase's built-in email. Resend remains only in the `app/email-services` broadcast page (currently broken for DNS reasons — see Appendix B — leave it as-is).
3. **Routes**: per-series `/s/[series]`. Account flows (`/profiles/create|update|claim|forgot-password|set-password`, sign-in) stay at their current paths.
4. **Landing**: `/` becomes a series picker. The legacy dark-green `HomePageClient` is **embedded as the top of `/s/24`** (directory renders below it under `id="directory"`).
5. **Roll edits**: a profile may **never** change series via a roll edit (reject cross-series rolls with a clear error).
6. **Claim** stays 24-only (data availability), gated by registry flag `hasLegacyClaims`.

### Domain facts

- Roll = 7 digits: `24 03 001` → series id `"24"` (2-digit roll prefix), dept `03` (CSE), serial `001`.
- Section = serial ranges of 60: a `001-060`, b `061-120`, c `121-180` (series 24; other series define their own via registry).
- `series` is **always derived from the roll** at the service layer; the stored field exists only for querying.
- Public Firestore reads: `profiles` (where published==true). Admin-only: everything else.
- Anti-enumeration is a hard invariant: claim + password reset must return **identical generic responses** for existing/non-existing emails regardless of internal failures.

---

## Phase 0 — Switch auth email to Firebase

### 0.1 Password reset → Firebase built-in

- `app/components/profiles/ForgotPasswordFlow.tsx`: replace the `requestPasswordResetAction(...)` server-action call with client-side
  ```ts
  import { getAuth, sendPasswordResetEmail } from "firebase/auth";
  // use the app auth instance from lib/firebase/client
  await sendPasswordResetEmail(getAuth(), email);
  ```
  Error handling: `auth/user-not-found` → show the existing generic success (anti-enumeration); `auth/too-many-requests` → show a rate-limit message; other errors → generic "Something went wrong".
- Delete `requestPasswordReset()` from `lib/auth/auth.service.ts` (~line 70) and its `sendPasswordSetEmail` import.
- Delete `requestPasswordResetAction` from `lib/db/students/students.server.ts:79`.

### 0.2 Claim: OTP code → Firebase magic link

Current flow (`ClaimFlow.tsx` steps `email → code → password`): `startClaim` emails a 6-digit OTP via Resend, `verifyClaimCode` returns a claim ticket, `completeClaimAction` creates the account. Replace the OTP leg with Firebase **email-link sign-in**; keep every eligibility guarantee.

**Server (`lib/auth/claim.server.ts`):**
- `startClaim`: keep ALL eligibility logic (legacy exists, no auth account, roll unheld) and the generic response message. Replace the OTP transaction + `sendOtpEmail` with a Firebase OOB send:
  ```
  POST https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${NEXT_PUBLIC_FIREBASE_API_KEY}
  { "requestType": "EMAIL_SIGNIN", "email": "...",
    "continueUrl": "<site url>/profiles/claim", "canHandleCodeInApp": true }
  ```
  Send **only when eligible** (same as today); on failure `console.error` only — response to the client stays generic.
- `verifyClaimCode` / claim tickets / OTP machinery: delete (`generateCode`, `codeDigest`, `counterRef`, `OTP_*` consts, challenge tokens with purpose `claim-challenge`/`claim-ticket`). **Grep first** (`tokens.ts`, `rateLimits` collection, `lib/auth/tokens.ts` consumers) to confirm no other users before deleting shared helpers.
- Completion becomes **session-based**: a new/reworked `completeClaimAction` that (a) requires a session (`getSession()`), (b) re-checks eligibility server-side (legacy exists + roll unheld), (c) sets `emailVerified: true` via `adminAuth.updateUser` (email-link proves mailbox control), (d) `legacyToProfile` + `reserveRoll` + write profile + private contact, (e) undo on failure (release roll / delete doc) exactly like today. Reuse `createClaimedProfile` logic in `students.service.ts`.

**Client (`app/components/profiles/ClaimFlow.tsx`):**
- Step 2 becomes a "check your inbox" state (resend button with the existing cooldown idea, optional).
- The continue URL lands back on `/profiles/claim?oobCode=...&mode=signIn`. That page must detect `isSignInWithEmailLink(auth, window.location.href)`, prompt for the email if it's not in `sessionStorage` (store it at send time — standard Firebase pattern), then `signInWithEmailLink(auth, email, url)`.
- Create the session cookie from the fresh credential: get `await user.getIdToken()` → send to a new server action that mirrors `signIn()`'s tail: `adminAuth.verifyIdToken(idToken)` → `createSessionCookie` (`lib/auth/session.ts`) → return `{ email, mustRotate: false, needsSection: session.needsSection }`.
- Then step 3 (set password): `updatePassword(user, password)` client-side (or `adminAuth.updateUser` server-side, matching current `completeClaimAction`), then call `completeClaimAction` (no ticket arg), then redirect to the profile as today.
- Clean up the step indicator (`email → link → password`).

**Also:** `claim.server.ts:269` currently creates users with `emailVerified: true` — that path disappears with OTP; make sure the new completion path preserves "claimed accounts are verified".

### 0.3 Delete

- `lib/email/sender.ts` entirely (`sendOtpEmail` / `sendPasswordSetEmail` have no other consumers — grep to confirm). Keep the `resend` package and `app/email-services/*` untouched.

### 0.4 Manual console steps (human, document in PR notes)

- Firebase console → Authentication → Settings → **Authorized domains**: ensure `ruetcsearchive.app` and `localhost` are listed (required for `continueUrl`).
- Optionally customize Auth email templates (display name) — cosmetic.

---

## Phase 1 — Series registry + data layer

### 1.1 `types/series.ts` (new)

```ts
import type { Section } from "./Student";

export interface SeriesConfig {
  id: string;                    // "24" — the roll's leading digits (2-digit string)
  admissionYear: number;         // 2024
  label: string;                 // "2024 series" (UI + SEO)
  rollPattern: RegExp;           // /^2403\d{3}$/
  sections: readonly Section[];  // ["a","b","c"]
  sectionFromRoll: (roll: string) => Section | null;
  status: "open" | "archived";
  hasLegacyClaims: boolean;      // true only for 24
  hasArchiveHome: boolean;       // true only for 24 (legacy HomePageClient hero)
}

export const SERIES: SeriesConfig[];
export function getSeries(id: string): SeriesConfig | null;
export function seriesFromRoll(roll: string): SeriesConfig | null; // first pattern match; assert no overlaps at module load
export function sectionFor(seriesId: string, roll: string): Section | null;
```

- Move `SECTION_ROLL_RANGES`, `getSectionFromRoll`, `ROLL_PATTERN` (`types/Student.ts:96-115`) into the `24` entry — behavior must be byte-identical.
- Seed entries: `24` (real data) + `23` with documented-but-placeholder pattern `/^2303\d{3}$/` and 60-per-section formula — mark placeholders clearly; unknown series must simply be absent (registry is data, adding series later = one entry, no code).

### 1.2 Type + schema

- `types/Student.ts`: `Profile` gains `series: string`. `SessionUser.emailVerified` already exists (line 71).
- `lib/db/students/students.schema.ts`:
  - `rollSchema`: matches **some** registered `rollPattern` (zod `superRefine` against `SERIES`); message e.g. "Roll must be a valid CSE roll number".
  - `sectionSchema`: built from registry — validate against the sections of the series derived from the accompanying roll (in create/update schema, validate `sec` inside `sectionFor(seriesFromRoll(roll), roll)`).
- `lib/db/students/students.mapper.ts`: `series: str(data.series)` with **fallback derive from roll** when missing (keeps reads working pre-backfill).

### 1.3 Service layer (`lib/db/students/students.service.ts`)

- `createProfileFor`: `series: seriesFromRoll(draft.roll)` — error if no registry entry (zod already guarantees, belt-and-braces).
- `updateProfileFor`: when roll changes, derived series **must equal `current.series`**, else `"You can only edit your roll within your series."` Re-derive and store on allowed change.
- Claim path (`legacyToProfile` consumers): stamps `series` from roll (24 rolls match automatically).
- `EmailBody`/branding untouched here.

### 1.4 Query layer

- `lib/db/students/students.repo.ts:32`:
  ```ts
  listPublishedProfiles(series: string)  // where("series","==",series).where("published","==",true)
  ```
  Two equality filters → **no composite index required** (zig-zag merge). If Firestore console complains, create the composite index it links.
- `lib/db/students/students.hooks.ts`: `studentsKeys.list(series)`; `useProfiles(series)`; detail-key updates cascade via existing invalidation (`studentsKeys.all`). Count hook for landing: use `getCountFromServer` (from `firebase/firestore`) per series.
- `rollIndex` collection: unchanged (rolls are globally unique already).

### 1.5 Backfill

- New `scripts/backfill-series.ts` (model on `scripts/migrate-legacy-profiles.ts`): iterate all `profiles` docs missing `series`, derive via `seriesFromRoll`, batch-write. **Dry-run by default**, `--apply` flag; report unparseable rolls instead of guessing.

### 1.6 Rules (`firestore.rules`)

```rules
function validProfile(d) {
  return d.keys().hasOnly([... , 'series'])   // add 'series'
    && d.series is string && d.series.matches('^[0-9]{2}$')   // add
    && ... existing ...
```
- Keep the loose roll check (`d.roll is string && d.roll.size() <= 12`) — the precise per-series pattern is zod's job; add a comment stating the division of labor (rules can't import the registry).
- **Deploy order: backfill `--apply` → then rules + app together.** After rules deploy, any write without `series` is rejected; new code always writes it.

---

## Phase 2 — Routing

```
/                                    series picker (Phase 5)
/s/[series]                          entry: hasArchiveHome → HomePageClient hero + directory below (id="directory");
                                      otherwise directory directly
/s/[series]/profiles/[uid]           detail (noindex — copy metadata from app/profiles/[id]/page.tsx)
/s/[series]/join                     sign-up (Phase 4; archived → read-only notice)
/profiles          → permanentRedirect("/s/24")          (next/navigation permanentRedirect)
/profiles/[uid]    → server admin-fetch profile → permanentRedirect(`/s/${series}/profiles/${uid}`); missing → not-found
/profiles/create|update|claim|forgot-password|set-password   UNCHANGED
```

- `app/s/[series]/layout.tsx` (new): `const { series } = await params; const entry = getSeries(series) ?? notFound();` → `generateMetadata` via `seriesMetadata(entry)` (Phase 5 helper) → renders Navbar + series context (React context `SeriesProvider` in this layout, consumed by Navbar/header).
- `app/s/[series]/page.tsx`: move the server logic from `app/profiles/page.tsx` (searchParams `q`/`sec` parsing) here; render hero conditionally when `entry.hasArchiveHome`.
- Detail page: reuse `ProfileDetail` component unchanged; admin fetch available via the admin repo (`lib/db/students/students.admin.repo.ts` — check for `findById`; add one if missing).
- `app/profiles/page.tsx` / `app/profiles/[id]/page.tsx` become redirect stubs (their directory/detail code moves under `app/s/[series]/`).
- `app/sitemap.ts`: `/` + `/s/[id]` for every registered series (drop `/profiles`).

---

## Phase 3 — Series-aware UI

- `ProfileDirectory` / `DirectoryToolbar`: section filter options = `["All", ...entry.sections]` (no hardcoded `["All","a","b","c"]`); receive `entry` as prop from the series page.
- `app/profiles/searchParams.ts` `parseSection`: validate against the active entry's sections (pass entry or return raw and validate server-side).
- `DirectoryHeader`: eyebrow = `entry.label` ("2024 series"); **claim callout only when `entry.hasLegacyClaims`** (uses existing `getUnclaimedCountAction` — legacy data exists only for 24).
- `Navbar.tsx`: derive series from `usePathname()` with `/^\/s\/([0-9]{2})/`; "Directory" href = `/s/${id}` when in context, `/` otherwise; keep `aria-current` behavior; generalize aria-labels/brand to "RUET CSE".
- `ProfileForm.tsx`: section `<select>` options from `seriesFromRoll(roll)?.sections ?? all-registered-sections`, recomputed as the roll field changes.
- `app/HomePageClient.tsx`: its single link `href="/profiles"` (line ~419-425) → `"#directory"`. Component can stay where it is; only rendered for `hasArchiveHome`.
- `ProfileDetail`: optional small `entry.label` chip (nice-to-have).

---

## Phase 4 — Sign-up (self registration)

- **Join panel** (new component, rendered by `app/s/[series]/join/page.tsx`): email + password + confirm. Client-side:
  ```ts
  createUserWithEmailAndPassword(auth, email, password)
  sendEmailVerification(user)   // Firebase sends it; no server action needed
  ```
  Archived series → read-only notice instead of the form. After verifying, user returns and signs in, then lands on `/profiles/create`.
- **Gate** (`createProfileAction`, `students.server.ts:149`): require `session.emailVerified`; else error `"Verify your email first."` (field already on `SessionUser`).
- **SignInPanel.tsx**: after `useSignIn` succeeds, if `!session.emailVerified` show a "check your email to verify" state with a **Resend verification** button (`sendEmailVerification(currentUser)` + `user.reload()` to re-check). Do not let them reach profile creation until verified.
- No admin `createUser` in sign-up; **no roll at signup** → no roll-squatting (roll reserved only at profile creation via existing `reserveRoll`).

---

## Phase 5 — Landing + branding

- `app/page.tsx` → series picker: one card per `SERIES` entry (label, live count via `getCountFromServer`, `open`/`archived` badge) → `/s/[id]`. Client component is fine (HomePageClient precedent).
- `app/seo.ts` refactor:
  - `baseSiteConfig`: name `"RUET CSE"`, dept-level description/keywords (keep `url`, `ogImage`, `logo`, contact/social).
  - `seriesMetadata(entry)`: title `RUET ${entry.label} Student Directory`, description/canonical per series (`/s/${entry.id}`).
  - Keep `createMetadata` for account pages; **grep every `siteConfig` consumer** (`app/layout.tsx`, manifest, sitemap, pages) and update.
- `app/manifest.ts`, `app/layout.tsx` JSON-LD (`alternateName: "RUET CSE"`), `app/sitemap.ts` — generalize.
- `app/email-services/EmailBody.tsx` `FROM` display name → "RUET CSE" (cosmetic; Resend itself stays broken until Appendix B is done).

---

## Phase 6 — Verification (definition of done)

1. `npx tsc --noEmit` → clean. `npx next build` → passes.
2. Registry unit sanity: a tiny script/assert at module load — every `rollPattern` matches its example roll, `seriesFromRoll` round-trips every entry, no pattern overlap.
3. Backfill dry-run output reviewed; then `--apply` **before** deploying rules.
4. Manual flows (dev):
   - Reset: request → Firebase email arrives → link opens → password changed → sign in.
   - Claim: enter legacy email → link arrives → click → session → set password → profile claimed; non-legacy email → same generic message, no email.
   - Non-verified sign-in → blocked with resend option → verify → create profile.
   - Join: `/s/24/join` → verify → create → appears in `/s/24` list + detail; roll edit to another series rejected.
   - `/profiles` → 301 to `/s/24`; `/profiles/<uid>` → 301 to `/s/24/profiles/<uid>`.
   - `/` picker → both series cards; `/s/08` (if registered archived) join shows notice; unknown series → 404.
   - `/s/24`: hero renders, `#directory` scrolls to directory; other series: no hero.
   - Claim callout visible only on `/s/24`.
5. Breakpoints: 360px / 768px / 1280px on `/`, `/s/24`, detail, forms.

### Invariants to preserve (review these before each commit)

- Generic claim/reset responses identical for existing vs missing emails.
- `series` derived from roll only — never user input, never route input.
- Account routes unmoved; zod = precise validation, rules = structural guard.
- `rollIndex`, image APIs, auth/session rotation, `app/email-services` untouched.

---

## Appendix A — Current-code map (file:line as of writing)

| Thing | Location |
|---|---|
| Roll ranges/pattern/section derive | `types/Student.ts:96-115` (`SECTION_ROLL_RANGES`, `getSectionFromRoll`, `ROLL_PATTERN`) |
| `rollSchema` hardcoded `^2403\d{3}$` | `lib/db/students/students.schema.ts:39` |
| `sectionSchema = z.enum(["a","b","c"])` | `students.schema.ts:43` |
| Profile mapper | `lib/db/students/students.mapper.ts` (`toProfile`) |
| List query | `lib/db/students/students.repo.ts:32` |
| Query keys / hooks | `lib/db/students/students.hooks.ts:28-33,43` |
| create/update/roll-reserve | `lib/db/students/students.service.ts` (`createProfileFor`, `updateProfileFor`) |
| Server actions | `lib/db/students/students.server.ts` (line numbers in Phase 0) |
| Claim flow | `lib/auth/claim.server.ts`, `app/components/profiles/ClaimFlow.tsx` |
| Password reset (current) | `lib/auth/auth.service.ts` `requestPasswordReset` |
| Session + `emailVerified` | `lib/auth/session.ts:62` |
| Rules `validProfile` | `firestore.rules:27-45` |
| Legacy home | `app/HomePageClient.tsx` (link line ~419), `app/page.tsx` |
| Directory page (moves) | `app/profiles/page.tsx`, `app/profiles/searchParams.ts` |
| Toolbar sections | `app/components/profiles/DirectoryToolbar.tsx` |
| Header/claim callout | `app/components/profiles/DirectoryHeader.tsx` |
| SEO | `app/seo.ts`, `app/sitemap.ts`, `app/manifest.ts` |
| Email sender (delete in Phase 0) | `lib/email/sender.ts` |

## Appendix B — Resend DNS (broadcast page only; optional later)

`app/email-services` still sends via Resend from `noreply@mail.ruetcsearchive.app`, but **its DNS auth records are missing in live DNS** (verified against Google + Cloudflare resolvers, 2026-10-01). To fix later, add at the DNS host (name.com, `NS = ns*.name.com`):

| Type | Name | Value |
|---|---|---|
| TXT | `resend._domainkey.mail.ruetcsearchive.app` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDdWHjKn0Z69wlswDo1CwUzTCEzG35zd8A1kc4Wxk09T0AXUn9gxWiww55J+m6idhxbPLB8YNQTca3NBsqh/xpWd6Q4TW4LR1/CeTHH1Bs6eONOoqNYFt7iSMMf9TIWgWHiyN/IgixnlgcdNEOQ/7GBmekytCySdkvVqCwcDVUGSQIDAQAB` |
| MX | `send.mail.ruetcsearchive.app` | `feedback-smtp.ap-northeast-1.amazonses.com` (priority 10) |
| TXT | `send.mail.ruetcsearchive.app` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc.ruetcsearchive.app` | `v=DMARC1; p=quarantine; rua=mailto:ruetcse24@gmail.com` |

Then re-verify in Resend dashboard and send one test broadcast. (Resend's API currently reports `verified` from stale cache — do not trust it; check live DNS.)

## Appendix C — Suggested execution order

1. Phase 0 (standalone bug fix; ship first)
2. Phase 1 (data) → deploy backfill `--apply`
3. Phase 2 (routes) + Phase 3 (UI) together with rules deploy
4. Phase 4 (sign-up) — needs `ruetcsearchive.app` in Authorized domains
5. Phase 5 (landing/SEO) — can parallel 4
6. Phase 6 verification pass
