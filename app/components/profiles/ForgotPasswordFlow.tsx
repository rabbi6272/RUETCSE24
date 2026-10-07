"use client";

import { useState } from "react";

import Link from "next/link";

import { requestPasswordResetAction } from "../../../lib/db/students/students.server";

import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Alert } from "../ui/Icon";

import { SpamNotice } from "./SpamNotice";

/**
 * Always reports the same outcome regardless of whether the address exists, so
 * this form cannot be used to test whether someone is registered.
 */
export function ForgotPasswordFlow() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await requestPasswordResetAction(email).catch(() => null);

    if (!result) {
      setError("Could not send the email. Try again.");
      setBusy(false);
      return;
    }

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    setSent(true);
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
        <h1 className="text-xl font-bold tracking-tight text-fg">Reset password</h1>

        {sent ? (
          <div className="mt-5 space-y-4">
            <p
              role="status"
              className="rounded-control border border-border bg-success-soft px-3 py-2.5 text-sm font-medium text-success"
            >
              If an account exists for {email}, a reset link is on its way.
            </p>
            <SpamNotice />
            <Link
              href="/profiles/update"
              className="block text-sm font-semibold text-ink-700 underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
              We will email you a link to set a new password.
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <TextField
                label="Email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />

              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
                >
                  <Alert className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              ) : null}

              <Button type="submit" busy={busy} className="w-full">
                Send reset link
              </Button>
            </form>

            <p className="mt-6 border-t border-border pt-5 text-sm text-fg-muted">
              <Link
                href="/profiles/update"
                className="font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
