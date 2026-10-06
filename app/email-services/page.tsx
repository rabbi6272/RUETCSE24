"use client";

import { useState } from "react";

import {
  getAudienceSizeAction,
  sendAnnouncementAction,
} from "./emailAction";

import { Button } from "../components/ui/Button";
import { TextAreaField, TextField } from "../components/ui/Field";
import { Alert } from "../components/ui/Icon";
import { Dialog } from "../components/ui/Dialog";

export default function EmailServicesPage() {
  const [audience, setAudience] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  async function loadAudience() {
    const { count } = await getAudienceSizeAction();
    setAudience(count);
  }

  async function send() {
    setBusy(true);
    setConfirming(false);

    const response = await sendAnnouncementAction(subject, body).catch(() => null);

    if (!response) {
      setResult({ ok: false, message: "Could not send. Try again." });
      setBusy(false);
      return;
    }

    setResult({ ok: response.success, message: response.message });
    setBusy(false);

    if (response.success) {
      setSubject("");
      setBody("");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="text-2xl font-bold tracking-tight text-fg">Announcements</h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        Sends one email to every published profile. Recipients are read from the
        directory on the server.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={loadAudience}>
          Check audience size
        </Button>
        {audience !== null ? (
          <p role="status" className="text-sm text-fg-muted">
            <span className="font-bold text-fg">{audience}</span>{" "}
            {audience === 1 ? "profile" : "profiles"} will receive this.
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setResult(null);
          setConfirming(true);
        }}
        className="mt-6 space-y-4 rounded-panel border border-border bg-surface p-6 shadow-card"
      >
        <TextField
          label="Subject"
          required
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />

        <TextAreaField
          label="Message"
          required
          rows={8}
          hint="Plain text. Line breaks are preserved."
          value={body}
          maxLength={2000}
          onChange={(event) => setBody(event.target.value)}
        />

        {result ? (
          <p
            role="status"
            className={
              result.ok
                ? "rounded-control border border-border bg-success-soft px-3 py-2.5 text-sm font-medium text-success"
                : "flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
            }
          >
            {result.ok ? null : <Alert className="mt-0.5 size-4 shrink-0" />}
            {result.message}
          </p>
        ) : null}

        <Button type="submit" busy={busy}>
          Send announcement
        </Button>
      </form>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Send to every published profile?"
        description="This cannot be undone, and it cannot be recalled once handed to the mail provider."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" busy={busy} onClick={() => void send()}>
              Send now
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          {audience === null
            ? "Recipient count has not been checked."
            : `${audience} ${audience === 1 ? "profile" : "profiles"}`}{" "}
          will receive this email.
        </p>
      </Dialog>
    </div>
  );
}
