"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useCompletePasswordRotation } from "../../../lib/db/students/students.hooks";
import { SECTION_LABELS } from "../../../types/Student";

import { Button } from "../ui/Button";
import { SelectField, TextField } from "../ui/Field";
import { Alert } from "../ui/Icon";

/**
 * The one-time password upgrade every migrated account is forced through.
 *
 * Copy matters here: these students did not choose to be on this screen, and the
 * thing being asked of them replaces a password that was, until now, readable
 * by anyone who knew how to query the public database. Saying so plainly is the
 * difference between "we migrated you" and "your account was exposed, here is
 * the fix".
 */
export function SetPasswordForm({
  email,
  needsSection,
}: {
  email: string;
  needsSection: boolean;
}) {
  const router = useRouter();
  const rotate = useCompletePasswordRotation();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sec, setSec] = useState("");

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mismatch) return;

    const result = await rotate
      .mutateAsync({
        currentPassword,
        newPassword,
        ...(needsSection ? { sec } : {}),
      })
      .catch(() => null);

    if (!result) {
      return;
    }

    if (result.ok) {
      // The session was revoked server-side, so send them back through sign-in
      // rather than leaving a dead page in front of them.
      router.push("/profiles/update");
      router.refresh();
      return;
    }
  }

  const busy = rotate.isPending;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
        <h1 className="text-xl font-bold tracking-tight text-fg">
          Choose a new password
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          Your account was migrated from the old student database. It now signs
          in with <span className="font-medium text-fg">Firebase Authentication</span>,
          but your old 6-digit pincode was stored in a way that was publicly
          readable, so it can no longer be treated as private.
        </p>

        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          Set a password of at least 8 characters to finish. You will use it from
          now on instead of your pincode.
        </p>

        <p className="mt-4 rounded-control border border-border bg-surface-sunken px-3 py-2.5 text-sm text-fg-muted">
          Signing in as{" "}
          <span className="font-medium text-fg break-all">{email}</span>
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <TextField
            label="Your old pincode"
            hint="The 6-digit pincode you have been using to sign in."
            type="password"
            name="currentPassword"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            inputMode="numeric"
            required
          />

          {needsSection ? (
            <SelectField
              label="Your section"
              hint="We worked this out from your roll number — please confirm it."
              name="sec"
              value={sec}
              onChange={(event) => setSec(event.target.value)}
              required
            >
              <option value="">Select your section</option>
              {(["a", "b", "c"] as const).map((value) => (
                <option key={value} value={value}>
                  {SECTION_LABELS[value]}
                </option>
              ))}
            </SelectField>
          ) : null}

          <TextField
            label="New password"
            hint="At least 8 characters."
            type="password"
            name="newPassword"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />

          <TextField
            label="Confirm new password"
            type="password"
            name="confirmPassword"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            error={mismatch ? "Passwords do not match" : undefined}
            required
          />

          {rotate.isError ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
            >
              <Alert className="mt-0.5 size-4 shrink-0" />
              Could not save your new password. Please try again.
            </p>
          ) : null}

          {rotate.data && !rotate.data.ok ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
            >
              <Alert className="mt-0.5 size-4 shrink-0" />
              {rotate.data.error}
            </p>
          ) : null}

          <Button
            type="submit"
            busy={busy}
            disabled={mismatch || !newPassword}
            className="w-full"
          >
            Save new password
          </Button>
        </form>

        <p className="mt-6 border-t border-border pt-5 text-sm text-fg-muted">
          Lost track of your pincode?{" "}
          <Link
            href="/profiles/forgot-password"
            className="font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
          >
            Reset it by email
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
