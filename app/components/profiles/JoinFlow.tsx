"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { studentsKeys } from "../../../lib/db/students/students.hooks";
import { signUpAction } from "../../../lib/db/students/students.server";

import { Button, buttonClasses } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Alert } from "../ui/Icon";

import { GoogleButton, OrDivider } from "./GoogleButton";

/**
 * Self sign-up for a series: Google, or email + password. The new account is
 * signed in immediately; email/password accounts verify their address from the
 * profile page before the profile can be published. Old-directory profiles are
 * not created here — they are reclaimed through the Claim email link.
 */
export function JoinFlow({ seriesId }: { seriesId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<"claim" | "exists" | null>(null);

  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mismatch) return;

    setBusy(true);
    setError(null);
    setErrorCode(null);

    const result = await signUpAction(seriesId, email, password).catch(() => null);

    if (!result) {
      setError("Could not create the account. Try again.");
      setBusy(false);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      setErrorCode(result.code ?? null);
      setBusy(false);
      return;
    }

    // Signed in by the server action (which also revalidated every page);
    // drop client-side data cached while signed out, then move on.
    await queryClient.invalidateQueries({ queryKey: studentsKeys.all });
    router.push("/profiles/create");
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
        <h1 className="text-3xl text-center font-bold tracking-tight text-fg">Create your account</h1>
        <p className="mt-0.5 text-center text-base leading-relaxed text-fg-muted">
          Join the CSE {seriesId} directory with Google or with your email.
        </p>

        {error ? (
          <div
            role="alert"
            className="mb-4 space-y-3 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
          >
            <p className="flex items-start gap-2">
              <Alert className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
            {errorCode === "claim" ? (
              <Link href="/profiles/claim" className={buttonClasses("primary", "sm")}>
                Reclaim my profile
              </Link>
            ) : null}
            {errorCode === "exists" ? (
              <div className="flex flex-wrap gap-2">
                <Link href="/profiles/update" className={buttonClasses("secondary", "sm")}>
                  Sign in
                </Link>
                <Link href="/profiles/forgot-password" className={buttonClasses("ghost", "sm")}>
                  Reset password
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-2" noValidate>
          <TextField
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint="At least 8 characters."
          />
          <TextField
            label="Confirm password"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            error={mismatch ? "Passwords do not match" : undefined}
          />
          <Button
            type="submit"
            busy={busy}
            busyLabel="Creating account…"
            disabled={mismatch || !email || !password}
            className="w-full"
          >
            Create account
          </Button>
        </form>

        <OrDivider />

        <div className="mt-6">
          <GoogleButton next={`/s/${seriesId}`} />
        </div>

        <p className="mt-6 border-t border-border pt-5 text-sm text-fg-muted">
          Already have an account?{" "}
          <Link
            href="/profiles/update"
            className="font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
          >
            Sign in
          </Link>
          . Had a profile in the old directory?{" "}
          <Link
            href="/profiles/claim"
            className="font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
          >
            Reclaim it
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
