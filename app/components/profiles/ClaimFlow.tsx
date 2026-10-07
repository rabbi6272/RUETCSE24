"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  completeClaimAction,
  openClaimLinkAction,
  startClaimAction,
} from "../../../lib/db/students/students.server";
import { SECTION_LABELS } from "../../../types/Student";

import { Button } from "../ui/Button";
import { SelectField, TextField } from "../ui/Field";
import { Alert, Check } from "../ui/Icon";
import { cn } from "../ui/cn";

import { SpamNotice } from "./SpamNotice";

type Step = "email" | "link" | "password";

const EMAIL_STORAGE_KEY = "claimEmailForSignIn";

/**
 * Three steps: find your entry, open the emailed sign-in link, set a password.
 * Migrated accounts that still sign in with their old pincode come through
 * here too ("activate"); they may also be asked to confirm their section.
 *
 * The link is a Firebase EMAIL_SIGNIN OOB code exchanged server-side, so the
 * client never holds a credential — it only relays the `oobCode` from the
 * landing URL together with the address it was sent to (kept in
 * sessionStorage, or re-entered when the link is opened on another device).
 */
export function ClaimFlow({ oobCode }: { oobCode?: string | null }) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needsSection, setNeedsSection] = useState(false);
  const [sec, setSec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const landingHandled = useRef(false);

  function fail(message: string) {
    setError(message);
    setBusy(false);
  }

  async function onStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await startClaimAction(email).catch(() => null);

    if (!result) return fail("Could not start the claim. Try again.");
    if (!result.ok) return fail(result.error);

    try {
      sessionStorage.setItem(EMAIL_STORAGE_KEY, email.trim().toLowerCase());
    } catch {
      // Storage can be unavailable in private modes; the landing step then
      // simply asks for the address again.
    }

    setNotice(result.message);
    setStep("link");
    setBusy(false);
  }

  // The email link lands back on this page with `oobCode` in the URL. Exchange
  // it exactly once, then strip the query string so a refresh cannot replay it.
  useEffect(() => {
    if (!oobCode || landingHandled.current) return;
    landingHandled.current = true;

    let stored = "";
    try {
      stored = sessionStorage.getItem(EMAIL_STORAGE_KEY) ?? "";
    } catch {
      stored = "";
    }

    if (!stored) {
      setStep("link");
      setNotice("Open the link on this device, or enter the email it was sent to.");
      setBusy(false);
      return;
    }

    (async () => {
      setBusy(true);
      setError(null);

      const result = await openClaimLinkAction(oobCode, stored).catch(() => null);

      try {
        sessionStorage.removeItem(EMAIL_STORAGE_KEY);
      } catch {
        // Nothing to clean up if storage is unavailable.
      }

      if (result?.ok) {
        // The code is single-use: strip it so a refresh at the password step
        // cannot try to replay it.
        window.history.replaceState({}, "", "/profiles/claim");
        setNeedsSection(result.needsSection);
        setNotice("Email verified. Choose a password to finish claiming.");
        setStep("password");
      } else {
        window.history.replaceState({}, "", "/profiles/claim");
        setStep("email");
        setError(result?.error ?? "That link is invalid or has expired. Request a new one.");
      }
      setBusy(false);
    })();
  }, [oobCode]);

  async function onLinkSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!oobCode) return;

    setBusy(true);
    setError(null);

    const result = await openClaimLinkAction(oobCode, linkEmail).catch(() => null);

    if (!result) return fail("Could not open the link. Try again.");
    if (!result.ok) return fail(result.error);

    setNeedsSection(result.needsSection);

    try {
      sessionStorage.setItem(EMAIL_STORAGE_KEY, linkEmail.trim().toLowerCase());
    } catch {
      // Non-fatal; the session cookie is what matters from here on.
    }

    setNotice("Email verified. Choose a password to finish claiming.");
    setStep("password");
    setBusy(false);
  }

  async function onComplete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    if (needsSection && !sec) return fail("Pick your section.");

    const result = await completeClaimAction(password, needsSection ? sec : undefined).catch(
      () => null,
    );

    if (!result) return fail("Could not finish the claim. Try again.");
    if (!result.ok) return fail(result.error);

    setNotice("Profile claimed. Signing you in…");
    // The claim created a session, so a full load picks up the new cookies.
    router.push(`/profiles/${result.uid}`);
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
        <h1 className="text-xl font-bold tracking-tight text-fg">
          Claim your profile
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
          Joining for the first time? Confirm the email you used before, and we
          will carry your existing profile over.
        </p>

        <ol className="mt-5 flex items-center gap-2 text-xs font-semibold">
          {(["email", "link", "password"] as Step[]).map((value, index) => {
            const order: Step[] = ["email", "link", "password"];
            const currentIndex = order.indexOf(step);
            const done = index < currentIndex;

            return (
              <li key={value} className="flex items-center gap-2">
                <span
                  aria-current={value === step ? "step" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1",
                    value === step
                      ? "text-ink-900"
                      : done
                        ? "text-success"
                        : "text-fg-subtle",
                  )}
                >
                  {/* Shape, not colour alone, marks a completed step. */}
                  {done ? <Check className="size-3.5" /> : null}
                  {value === "email"
                    ? "Email"
                    : value === "link"
                      ? "Link"
                      : "Password"}
                </span>
                {index < order.length - 1 ? (
                  <span aria-hidden="true" className="text-fg-subtle">
                    /
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>

        {notice ? (
          <p className="mt-5 rounded-control border border-border bg-surface-sunken px-3 py-2.5 text-sm text-fg-muted">
            {notice}
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
          >
            <Alert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {step === "email" ? (
          <form onSubmit={onStart} className="mt-6 space-y-4" noValidate>
            <TextField
              label="Your email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              hint="The address your old profile was saved under."
            />
            <Button type="submit" busy={busy} className="w-full">
              Send sign-in link
            </Button>
          </form>
        ) : null}

        {step === "link" ? (
          oobCode ? (
            // Arrived from the email on a device without the stored address.
            <form onSubmit={onLinkSubmit} className="mt-6 space-y-4" noValidate>
              <TextField
                label="Email the link was sent to"
                type="email"
                required
                autoComplete="email"
                value={linkEmail}
                onChange={(event) => setLinkEmail(event.target.value)}
                hint="Only needed when opening the link on another device."
              />
              <Button type="submit" busy={busy} className="w-full">
                Open link
              </Button>
            </form>
          ) : (
            <div className="mt-6 space-y-4">
              <p className="rounded-control border border-border bg-surface-sunken px-3 py-2.5 text-sm text-fg-muted">
                Check your inbox and open the link — it brings you back here to
                set a password.
              </p>
              <SpamNotice />
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError(null);
                  setNotice(null);
                }}
                className="text-sm font-semibold text-ink-700 underline-offset-4 hover:underline"
              >
                Use a different email
              </button>
            </div>
          )
        ) : null}

        {step === "password" ? (
          <form onSubmit={onComplete} className="mt-6 space-y-4" noValidate>
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
              label="Choose a password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              hint="At least 8 characters."
            />
            <Button type="submit" busy={busy} className="w-full">
              Claim profile
            </Button>
          </form>
        ) : null}

        <p className="mt-6 border-t border-border pt-5 text-sm text-fg-muted">
          Already set up?{" "}
          <Link
            href="/profiles/update"
            className="font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
          >
            Sign in to edit your profile
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
