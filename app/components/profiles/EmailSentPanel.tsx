"use client";

import { useEffect, useState } from "react";

import { MailCheck } from "lucide-react";

import { Button } from "../ui/Button";

import { SpamNotice } from "./SpamNotice";

/** Matches the server's per-address resend cooldown (claim and join). */
const RESEND_COOLDOWN_S = 60;

/**
 * The "we sent you a link" state shared by Claim and Join. The server silently
 * drops a resend inside its cooldown, so the button counts down instead of
 * letting the user click into a request that does nothing.
 */
export function EmailSentPanel({
  email,
  body,
  onResend,
  onChangeEmail,
}: {
  email: string;
  /** What the link does once opened, e.g. "It brings you back here to set a password." */
  body: string;
  /** Resolves true when the resend went through. Omit to hide the button. */
  onResend?: () => Promise<boolean>;
  onChangeEmail: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_S);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  async function resend() {
    if (!onResend) return;
    setResending(true);
    const ok = await onResend();
    setResending(false);
    if (ok) {
      setResent(true);
      setSecondsLeft(RESEND_COOLDOWN_S);
    }
  }

  return (
    <div className="mt-6 space-y-4" role="status" aria-live="polite">
      <div className="flex flex-col items-center rounded-card border border-success/30 bg-success-soft px-4 py-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-success text-white motion-safe:animate-[fade_0.4s_ease-out]">
          <MailCheck className="size-6" aria-hidden="true" />
        </span>
        <p className="mt-3 text-base font-bold text-fg">
          {resent ? "Link sent again" : "Check your email"}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">
          We sent a link to <strong className="break-all font-semibold text-fg">{email}</strong>.
          <br />
          {body}
        </p>
      </div>

      <SpamNotice />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onResend ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            busy={resending}
            busyLabel="Resending…"
            disabled={secondsLeft > 0}
            onClick={resend}
          >
            {secondsLeft > 0 ? `Resend in ${secondsLeft}s` : "Resend link"}
          </Button>
        ) : null}
        <button
          type="button"
          onClick={onChangeEmail}
          className="text-sm font-semibold text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}
