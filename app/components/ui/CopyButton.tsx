"use client";

import { useEffect, useRef, useState } from "react";

import { Check, Copy } from "./Icon";
import { cn } from "./cn";

export interface CopyButtonProps {
  value: string;
  /** Accessible name, e.g. "Copy email address". */
  label: string;
  className?: string;
}

/**
 * Clipboard write with a confirmation the user actually perceives, plus a
 * textarea fallback for non-secure contexts, where `navigator.clipboard` is
 * undefined and a bare `await` would throw.
 */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const scratch = document.createElement("textarea");
        scratch.value = value;
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand("copy");
        document.body.removeChild(scratch);
      }

      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md",
          "text-fg-subtle transition-colors hover:bg-ink-100 hover:text-fg",
          copied && "text-success",
          className,
        )}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
      {/*
        Politely announced instead of relying on the icon swap, which is silent
        for anyone not watching the button.
      */}
      <span role="status" aria-live="polite" className="sr-only-focusable">
        {copied ? `${label}: copied` : ""}
      </span>
    </>
  );
}
