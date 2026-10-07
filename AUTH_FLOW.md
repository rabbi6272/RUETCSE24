# Auth Flow — Current Architecture

Authoritative description of how authentication works in this codebase **as it exists now**:
Firebase-only email auth, server-side, with magic-link claim/join and a 5-day session cookie.

Companion doc: `IMPLEMENTATION_PLAN.md` (the plan that produced this).

---

## 1. Core principles

1. **Firebase Identity Toolkit is the only identity authority.** The app never hashes,
   stores, or compares a password. Every credential check is a REST call to Google
   (`accounts:signInWithPassword`, `accounts:sendOobCode`, `accounts:signInWithEmailLink`,
   `accounts:signInWithCustomToken`). One hashing implementation, one salt policy, one
   set of brute-force protections — all of them Google's.
2. **No `firebase/auth` in the browser.** The client Firebase SDK is used for public
   Firestore reads only. All auth code lives in `lib/auth/*.server.ts` and runs behind
   server actions.
3. **Writes go through the Admin SDK.** `firestore.rules` is defense-in-depth; the Admin
   SDK bypasses it, so server actions are the single write path for profiles/contact.
4. **Session = HttpOnly cookie, never a token in JS.** The browser holds a Firebase
   session cookie (`__session`), minted server-side. No refresh token, no idToken, and no
   way for page scripts to read the session.
5. **Anti-enumeration by default.** Claim, join, and password-reset return one uniform
   response whether or not an account/entry exists. Skip reasons are visible **only** in
   `[auth]` server logs (emails masked).

---

## 2. The moving parts

| Piece | File(s) | Role |
|---|---|---|
| Password verification | `lib/auth/verify-password.server.ts` | REST `signInWithPassword` → returns `idToken` (or a failure code). Password goes to Google, never touches app storage. |
| OOB email choke point | `lib/auth/oob.server.ts` | `sendOobCode` (send links) + `signInWithOutboundLink` (exchange clicked magic link → `idToken`, **creates the account if none exists**). Logs every send/exchange; exports `maskEmail`. |
| Session | `lib/auth/session.ts` | `createSessionCookie(idToken)` / `getSession()` (React `cache`-deduped per request, `verifySessionCookie(..., checkRevoked: true)`) / `clearSessionCookie()`. |
| Password & lifecycle | `lib/auth/auth.service.ts` | `signIn`, `requestPasswordReset`, `changePassword`, `deleteAccount`, `signOut`. |
| Password rotation | `lib/auth/rotation.server.ts` | One-time upgrade of the seeded public pincode (`mustRotate` accounts). |
| Email verification | `lib/auth/verification.server.ts` | `freshEmailVerified(uid)` (live Admin read) + `resendVerification()` (custom-token → idToken → `VERIFY_EMAIL`). |
| Claim (legacy, series 24) | `lib/auth/claim.server.ts` | `startClaim` → `openClaimLink` → `completeClaim`. |
| Join (self sign-up, open series) | `lib/auth/join.server.ts` | `startJoin` → `openJoinLink` → `completeJoin`. |
| Rate-limit keys | `lib/auth/tokens.ts` | `hashKey()` for `rateLimits` doc ids (never the raw email). |
| Server action surface | `lib/db/students/students.server.ts` | The **only** entry points the UI can call. Each action = one auth/db operation + logging. |
| UI flows | `app/components/profiles/` | `SignInPanel`, `ForgotPasswordFlow`, `SetPasswordForm`, `ClaimFlow`, `JoinFlow`, create/update forms. |

### 2.1 Identity stores (Firestore)

| Collection | Role in auth |
|---|---|
| `profiles/{uid}` | Canonical student profile; `uid` ties it to the Auth account. Roll reservation happens here (`reserveRoll`). |
| `legacyProfiles/{id}` | Pre-Firebase entries, addressed by `email`; consumed (deleted) by a successful claim. |
| `rollIndex` | Roll → uid reservation used to make claims race-safe. |
| `rateLimits/{sha256(key)}` | `claim:<email>` / `join:<email>` resend cooldowns (`lastSentAt`). |

### 2.2 Session cookie contract

- Name `__session`, HttpOnly, `SameSite=Lax`, `Secure` in production, **5-day** max age
  (`lib/auth/session.ts:9-10`).
- Minted only from a verified `idToken` via Admin SDK `createSessionCookie`.
- Decoded claims surfaced to the app: `uid`, `email`, `emailVerified`, `mustRotate`,
  `needsSection`. Claims are compared against `=== true`, so an absent/null claim can
  never read as "done".
- `checkRevoked: true` on every read → password change, rotation, or global sign-out
  (`revokeRefreshTokens`) kills existing cookies instead of letting them linger.
- `mustRotate` / `needsSection` are set at **seed time** as custom claims
  (`scripts/seed-auth-users.ts:371`), cleared by `setCustomUserClaims(uid, null)` after a
  successful rotation.

---

## 3. Emails — all sent by Firebase

One function issues every email: `sendOobCode` in `lib/auth/oob.server.ts`. Firebase hosts
the sending (Google infra, no DNS/SPF setup, no third-party sender). **Resend (`lib/email/`)
is reserved for the broadcast feature in `app/email-services` — it never sends auth mail.**

| `requestType` | Used by | Needs `idToken`? | Where the click lands |
|---|---|---|---|
| `PASSWORD_RESET` | forgot-password | No | Firebase's hosted page → user sets a new password there; app never sees a code |
| `EMAIL_SIGNIN` | claim + join (`canHandleCodeInApp: true`) | No | `continueUrl` back into the app with `?oobCode=…` → app exchanges it |
| `VERIFY_EMAIL` | sign-in auto-resend, Resend button | **Yes** | Firebase action page flips `emailVerified` → redirects to `continueUrl` (`/profiles/create`) |

Firebase console toggles that must be **enabled** (Authentication → Templates):
`PASSWORD_RESET`, `VERIFY_EMAIL`, **`EMAIL_SIGNIN` ("Email link (passwordless sign-in)")** —
the last one gates both claim and join; if disabled, sends fail with
`OPERATION_NOT_ALLOWED` and the failure shows up as `[auth] oob EMAIL_SIGNIN … -> <code>`
in the logs.

`continueUrl` base comes from `siteBaseUrl()` (`lib/site-url.ts`), in priority order:
`NEXT_PUBLIC_SITE_URL` → on Vercel production `VERCEL_PROJECT_PRODUCTION_URL` → on Vercel
preview `VERCEL_BRANCH_URL`/`VERCEL_URL` → `http://localhost:3000`. The Host header is never used
(client-controlled, and these links carry sign-in codes). **Whatever domain it resolves to must be
in Firebase Auth → Settings → Authorized domains.** To get deployed-site links while running
locally, set `NEXT_PUBLIC_SITE_URL` in `.env`.

---

## 4. Flows

### 4.1 Sign in — `/profiles` (`SignInPanel`)

```
UI → signInAction → signIn()
  → loginSchema parse
  → verifyPassword(email, password)            [REST signInWithPassword]
       fail → log "signin … -> bad-password" → "Incorrect email or password."
  → createSessionCookie(idToken)
  → getSession()
  → if !emailVerified: sendOobCode(VERIFY_EMAIL, idToken, continueUrl=/profiles/create)
  → return { email, emailVerified, mustRotate, needsSection }
```

UI branching on the result (`SignInPanel.tsx:54-70`):

| Condition | UI behavior |
|---|---|
| `mustRotate` (seeded pincode) | `router.push("/profiles/set-password")` — rotation form first; no profile editing while on a world-readable password |
| `!emailVerified` | "Check your inbox" state + **Resend** button (`resendVerificationAction`); sign-in itself already re-sent the link |
| otherwise | `router.refresh()` into the signed-in shell |

Failures are uniformly `"Incorrect email or password."` (no user-enumeration signal).

### 4.2 Password rotation — `/profiles/set-password` (`SetPasswordForm`)

For seeded accounts whose old password was the publicly listed pincode
(`rotation.server.ts`, invoked via `completePasswordRotationAction`):

1. Session required.
2. Re-auth with the current (pincode) password — a stolen cookie alone is not enough.
3. New password must parse `passwordSchema` and differ from the old one.
4. If the session carries `needsSection`, the form shows a section picker; the chosen
   section is patched onto the profile **first** (idempotent, retryable).
5. Set the new password → clear **all** custom claims (`setCustomUserClaims(uid, null)`)
   → `revokeRefreshTokens` → clear cookie → success. UI then goes to `/profiles/update`.

Ordering matters: profile write first (retry-safe), password second, claims cleared only
after the password actually changed. If claim-clearing ever failed, the forgot-password
link on the form is the documented recovery path.

### 4.3 Password reset — `/profiles/forgot-password` (`ForgotPasswordFlow`)

```
requestPasswordResetAction → requestPasswordReset(email)
  → sendOobCode({ requestType: PASSWORD_RESET, email })
  → ok                    → generic success
  → EMAIL_NOT_FOUND       → generic success   ← deliberate: no enumeration
  → other                 → generic "Something went wrong"
```

No cooldown doc here (Firebase applies its own per-email throttling), and the response
never reveals whether the address exists.

### 4.4 Email verification

- **Auto-resend:** every sign-in by an unverified account sends `VERIFY_EMAIL` using the
  `idToken` minted for that very attempt (`auth.service.ts:61-68`). Failures are silent —
  sign-in already succeeded.
- **Resend button** (`resendVerification`): the server never holds the user's password or
  refresh token, so it mints a current `idToken` the supported way —
  `createCustomToken(uid)` → REST `signInWithCustomToken` → `VERIFY_EMAIL` with that token.
  Session-bound: requires a signed-in session; if already verified → logs
  `already-verified` and returns ok.
- **The gate:** `createProfileAction` calls `freshEmailVerified(uid)` — a **live** Admin
  read (`lib/db/students/students.server.ts:190`), not the cookie claim, because magic-link
  flows flip `emailVerified` without re-signing the user in. Failure logs
  `[auth] create-profile -> email-not-verified`.

### 4.5 Join — self sign-up, open series — `/s/[series]/join` (`JoinFlow`)

Three-step UI: **email → link → password** (stepper rendered in `JoinFlow.tsx`).

```
Step 1  startJoinAction(seriesId, email) → startJoin()
          → joinStartSchema parse
          → getSeries(seriesId): must exist && status === "open"
               else → log "join start … -> series-<id>-closed" → 4xx-style message
          → cooldown: rateLimits/{hashKey("join:"+email)}, 60 s, transactional
               inside window → log "join cooldown … (resend dropped)", no email
          → sendOobCode(EMAIL_SIGNIN, continueUrl=/s/<id>/join, canHandleCodeInApp)
          → ALWAYS: "If that email can join, we've sent a sign-in link to it."

Step 2  page reloads with ?oobCode= → openJoinLinkAction(oobCode, email)
          → signInWithOutboundLink (creates account if none; wrong email+code pairing fails)
          → email mismatch → log "join link -> email-mismatch" → generic invalid-link message
          → adminAuth.updateUser(emailVerified: true)   ← the click IS the proof
          → createSessionCookie
          → belt-and-braces re-check of emailVerified via the cookie's uid
          → hasProfile? → return { hasProfile }  (UI: existing profile → update flow)

Step 3  completeJoinAction(password) → completeJoin()
          → session required (else "Your session expired.")
          → adminAuth.updateUser({ password })
          → UI → /profiles/create (or /profiles/update if a profile already exists)
```

### 4.6 Claim — legacy entry, series 24 only — `/profiles/claim` (`ClaimFlow`)

Same three-step shape, but eligibility is checked **twice** (send time and completion)
and a profile is written at the end.

```
Step 1  startClaimAction(email) → startClaim()
          → claimStartSchema
          → deny reasons, in order (never disclosed to the caller):
               no-legacy    — no legacyProfiles doc for that email
               bad-series   — seriesFromRoll(roll) === null (roll not in a registered series)
               auth-exists   — an Auth account already exists for the email
               roll-held    — the roll is already reserved by another identity
          → log "claim start <masked> -> <deny|eligible>"
          → if eligible: 60 s cooldown (rateLimits hashKey("claim:"+email))
               inside window → log "claim cooldown … (resend dropped)"
               else sendOobCode(EMAIL_SIGNIN, continueUrl=/profiles/claim, canHandleCodeInApp)
          → ALWAYS: "If that email matches an unclaimed profile, we've sent a sign-in link to it."

Step 2  ?oobCode= → openClaimLinkAction(oobCode, email)
          → signInWithOutboundLink (account created here on first use)
          → email mismatch → generic invalid-link message
          → RE-CHECK: legacy still exists? roll still unheld? (state may have changed)
          → createSessionCookie
          → UI strips the single-use code from the URL and advances to the password step

Step 3  completeClaimAction(password) → completeClaim()
          → session required (bound to the verified mailbox — never client input)
          → re-check legacy + seriesFromRoll + roll-held
          → reserveRoll(roll, uid)   ← race-safe; failure → "already been claimed"
          → adminAuth.updateUser({ password, emailVerified: true })
          → writeProfile(...)        ← series = seriesFromRoll(roll).id, published: true
          → setPrivateContact (mobile carried over from legacy)
          → removeLegacy(legacyId)
          → on ANY mid-flight failure: compensating rollback
               releaseRoll + deleteProfileDoc, then rethrow
               (the Auth account deliberately stays — it owns the session)
```

#### 4.6.1 Activation branch — seeded accounts

`scripts/seed-auth-users.ts` gave almost every legacy student an Auth account (old pincode as
password, `mustRotate: true`, roll reserved, profile written) but left their `legacyProfiles`
entry in place. Those students use the Claim page too, so the flow treats an account that still
has `mustRotate === true` as **pending activation**:

```
Step 1  startClaim: pendingActivation(email) → eligible (activate), checked before the deny chain
          → same 60 s cooldown, same EMAIL_SIGNIN send, same uniform response
Step 2  openClaimLink: after the exchange, pendingActivation again → skip legacy/roll checks
          → createSessionCookie → { mode: "activate", needsSection }
Step 3  completeClaim with session.mustRotate → completeActivation:
          patchProfile(sec) if needsSection → updateUser({ password, emailVerified: true })
          → setCustomUserClaims(uid, null) → revokeRefreshTokens (kills pincode sessions)
          → removeLegacy (best effort) → fresh cookie via idTokenForUid (custom token)
```

`auth-exists` now means an **already-activated** account; those students should sign in or use
forgot-password.

**Claim eligibility data note:** most legacy entries are already consumed or shadowed by
seeded accounts, so real-world sends are rare — the `[auth] claim start … -> <reason>`
log line is how you tell a silent skip from a real send.

### 4.7 Profile create / update — `/profiles/create`, `/profiles/update`

- Both are session-gated by their `layout.tsx` (`getSession`).
- `createProfileAction`: session → **`freshEmailVerified` live gate** → schema →
  `createProfileFor(uid, email, draft, contact?)`. The `series` written is derived from
  the roll, never taken from client input.
- `updateProfileAction` / `updateContactAction`: session → schema → Admin SDK write →
  `revalidateProfiles()`.
- Reads of one's own profile/contact (`getMyProfileAction`, `getMyContactAction`) are
  session-scoped; published profile reads are public via the client SDK.

### 4.8 Change password / delete account / sign out — `auth.service.ts`

| Action | Behavior |
|---|---|
| `changePassword` | Session + schema → **re-auth with current password** → `updateUser({password})` → `revokeRefreshTokens` (kills every device, incl. this one) → clear cookie → sign-in again |
| `deleteAccount` | Session + **password confirmation** → `removeProfile(uid)` → `adminAuth.deleteUser(uid)` → clear cookie |
| `signOut` | Clear cookie (server-side revocation already handled by `checkRevoked` on later reads) |

---

## 5. Server action surface

All UI entry points, in `lib/db/students/students.server.ts`:

| Action | Backing function |
|---|---|
| `signInAction` | `auth.service.signIn` |
| `signOutAction` | `auth.service.signOut` |
| `requestPasswordResetAction` | `auth.service.requestPasswordReset` |
| `changePasswordAction` | `auth.service.changePassword` |
| `deleteAccountAction` | `auth.service.deleteAccount` |
| `completePasswordRotationAction` | `rotation.completePasswordRotation` |
| `startClaimAction` / `openClaimLinkAction` / `completeClaimAction` | `claim.server.*` |
| `startJoinAction` / `openJoinLinkAction` / `completeJoinAction` | `join.server.*` |
| `resendVerificationAction` | `verification.resendVerification` |
| `createProfileAction` / `updateProfileAction` / `updateContactAction` | Admin repo (`freshEmailVerified` gate on create) |
| `getMyProfileAction` / `getMyContactAction` | session-scoped reads |
| `getUnclaimedCountAction` | legacy count (unclaimed badge) |
| `getRollForEmailAction` | "did I already claim?" lookup |

---

## 6. Security invariants (checklist)

- [x] Password never stored/compared/logged in app code — REST verification only.
- [x] Browser never holds idToken/refresh token — HttpOnly session cookie only.
- [x] `checkRevoked: true` on every session read.
- [x] Credential changes require re-authentication with the current password.
- [x] Anti-enumeration: uniform responses for claim/join/reset; reasons only in logs.
- [x] Eligibility decided server-side at **send and completion** time, never trusted from
      the client; `series` always derived from the roll.
- [x] 60 s resend cooldown per flow via hashed Firestore keys (no raw emails at rest).
- [x] Race-safe roll reservation (`reserveRoll` transaction) with compensating rollback.
- [x] Live `freshEmailVerified` for the profile-creation gate (cookie claims can be stale).
- [x] Rate-limit keys and log lines use `maskEmail` (`a***@example.com`).

---

## 7. Logging reference — `[auth]` lines

All lines are emitted server-side: dev terminal (this session: `/tmp/opencode/next-dev.log`),
production: **Vercel → Functions → runtime logs**, filter `[auth]`. Successes go to
`console.log`, failures to `console.error`.

| Line | Meaning |
|---|---|
| `[auth] oob <TYPE> <masked> -> sent\|<code>` | Firebase accepted/refused an email send (`PASSWORD_RESET` / `EMAIL_SIGNIN` / `VERIFY_EMAIL`) |
| `[auth] oob-exchange <masked> -> ok\|<code>` | Clicked magic link exchanged for an idToken |
| `[auth] signin <masked> -> bad-password\|no-session\|ok verified=… rotate=… needsSection=…` | Sign-in outcome |
| `[auth] password-change <masked> -> bad-current-password\|ok …` | Change-password outcome |
| `[auth] account-delete <masked> -> bad-password\|ok …` | Delete-account outcome |
| `[auth] sign-out -> ok (cookie cleared)` | Sign-out |
| `[auth] claim start <masked> -> eligible\|eligible (activate)\|no-legacy\|bad-series\|auth-exists\|roll-held` | **Why a claim email was (not) sent** |
| `[auth] claim cooldown <masked> (resend dropped)` | 60 s resend window |
| `[auth] claim link -> …` | Magic-link step outcomes (`ok`, `email-mismatch`, `no-legacy`, `roll-held`, `invalid-input`) |
| `[auth] claim complete -> …` | Final claim outcomes (`ok roll=… uid=…`, `no-session`, `roll-held`, `reserve-failed`, …) |
| `[auth] join start <masked> series=<id> -> eligible\|series-<id>-closed` | Join send decision |
| `[auth] join cooldown / join link / join complete …` | Same shape as claim |
| `[auth] verify-resend <masked> -> already-verified\|ok` | Resend-verification button |
| `[auth] create-profile -> email-not-verified uid=…` | Profile-creation gate blocked |
| `[auth] fresh email verification check failed …` | Admin read failed (treated as unverified) |
| `[auth] session creation failed …` / `identity toolkit … rejected …` | Infra-level errors |

**Reading a claim/join problem:** find the `claim start` / `join start` line first — it
tells you the exact deny reason; then check the `oob` line to see whether Firebase
actually accepted the send (`OPERATION_NOT_ALLOWED` = EMAIL_SIGNIN toggle off,
`INVALID_EMAIL` / `EMAIL_NOT_FOUND` = address problems).

---

## 8. Current status & known gotchas

- `EMAIL_SIGNIN` toggle **enabled** in the Firebase console (claim/join mail works;
  probes return 200).
- `PASSWORD_RESET` / `VERIFY_EMAIL` toggles enabled.
- E2E claim test requires a `legacyProfiles` scratch entry for a controllable email —
  most real legacy entries are already consumed (`no-legacy` / `auth-exists` /
  `roll-held` in the logs).
- A seeded account that still has `mustRotate` goes through the activation branch (§4.6.1).
  Once activated, `auth-exists` short-circuits it; sign in instead.
- Local dev fallback site URL is `http://localhost:3000`; production links need
  `NEXT_PUBLIC_SITE_URL` set (Vercel) + the domain in Firebase Authorized domains.
- Verification gates: `npx tsc --noEmit` and `npx next build` (never `next lint`).
  Scripts run with `node --env-file=.env --import tsx <script>`.
