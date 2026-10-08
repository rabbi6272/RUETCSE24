"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useSignIn } from "../../../lib/db/students/students.hooks";
import { resendVerificationAction } from "../../../lib/db/students/students.server";

import { Button, buttonClasses } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Alert, Check } from "../ui/Icon";

import { GoogleButton, OrDivider } from "./GoogleButton";
import { SpamNotice } from "./SpamNotice";

/**
 * Shown wherever a mutation needs a session. Deliberately not a route: both the
 * create and update pages need it inline, and a redirect would lose the visitor's
 * place and any half-typed form.
 *
 * A signed-in but unverified account gets its own state: profile creation is
 * gated on verification, so this panel says so up front and can re-send the
 * link (the action is session-bound — no password re-entry needed).
 */
export function SignInPanel({ context }: { context: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [needsClaim, setNeedsClaim] = useState(false);

  const signIn = useSignIn();

  // The Google callback lands here with `?authError=google` when it fails.
  // Read once on mount (no `useSearchParams`, so no Suspense boundary needed).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("authError") === "google") {
      setFormError("Google sign-in didn't go through. Try again, or use your email and password.");
    }
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNeedsClaim(false);

    const result = await signIn.mutateAsync({ email, password }).catch(() => null);

    if (!result) {
      setFormError("Could not sign in. Check your connection and try again.");
      return;
    }

    if (!result.ok) {
      setFormError(result.error);
      // Old-directory account: the pincode is not accepted, only the Claim link.
      setNeedsClaim(result.code === "claim");
      return;
    }

    // Signed in, but profile creation is blocked until the address is
    // verified. Sign-in itself just re-sent the link.
    if (!result.emailVerified) {
      setVerifyEmail(result.email);
      setVerifyNotice(null);
      setFormError(null);
      return;
    }

    router.refresh();
  }

  async function onResend() {
    setResending(true);
    setVerifyNotice(null);
    setFormError(null);

    const result = await resendVerificationAction().catch(() => null);

    if (result?.ok) {
      setVerifyNotice("Verification email sent again. Check your inbox and spam folder.");
    } else {
      setFormError(result?.error ?? "Could not resend the email. Try again.");
    }
    setResending(false);
  }

  if (verifyEmail) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
        <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-bold tracking-tight text-fg">
            Verify your email
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
            We sent a verification link to{" "}
            <strong className="font-semibold text-fg">{verifyEmail}</strong>.
            Open it and you&apos;ll land on your profile — no further sign-in
            needed.
          </p>

          <SpamNotice className="mt-5" />

          {verifyNotice ? (
            <p className="mt-5 flex items-start gap-2 rounded-control border border-border bg-surface-sunken px-3 py-2.5 text-sm text-fg-muted">
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
              {verifyNotice}
            </p>
          ) : null}

          {formError ? (
            <p
              role="alert"
              className="mt-5 flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
            >
              <Alert className="mt-0.5 size-4 shrink-0" />
              {formError}
            </p>
          ) : null}

          <div className="mt-6 space-y-3">
            <Button
              type="button"
              busy={resending}
              busyLabel="Sending…"
              onClick={onResend}
              className="w-full"
            >
              Resend verification email
            </Button>
            <button
              type="button"
              onClick={() => {
                setVerifyEmail(null);
                setVerifyNotice(null);
                setFormError(null);
              }}
              className="text-sm font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
            >
              Use a different account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
        <h1 className="text-center text-3xl font-bold tracking-tight text-fg">Sign in</h1>
        <p className="mt-0.5 text-center text-base text-fg-muted">{context}</p>

        <form onSubmit={onSubmit} className="space-y-2" noValidate>
          <TextField
            label="Email"
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />

          <TextField
            label="Password"
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />

          {formError ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
            >
              <Alert className="mt-0.5 size-4 shrink-0" />
              {formError}
            </p>
          ) : null}

          {needsClaim ? (
            <Link href="/profiles/claim" className={buttonClasses("primary", "md", "w-full")}>
              Reclaim with email link
            </Link>
          ) : null}

          <Button
            type="submit"
            busy={signIn.isPending}
            busyLabel="Signing in…"
            className="w-full"
          >
            Sign in
          </Button>
        </form>

        <OrDivider />

        <div className="mt-6">
          <GoogleButton next={pathname ?? undefined} />
        </div>

        <div className="mt-6 space-y-2 border-t border-border pt-5 text-sm">
          <p>
            <Link
              href="/profiles/forgot-password"
              className="font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
          <p className="text-fg-muted">
            Joining for the first time?{" "}
            <Link
              href="/"
              className="font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
            >
              Choose your series
            </Link>{" "}
            to create an account.
          </p>
          <p className="text-fg-muted">
            Had a profile in the old directory?{" "}
            <Link
              href="/profiles/claim"
              className="font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
            >
              Reclaim it with an email link
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
