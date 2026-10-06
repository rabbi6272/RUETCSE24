import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn, type ClassValue } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 " +
  "ease-[cubic-bezier(0.22,1,0.36,1)] select-none " +
  "disabled:opacity-50 disabled:pointer-events-none active:translate-y-px";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink-900 text-white hover:bg-ink-800 shadow-card",
  secondary:
    "bg-surface text-ink-900 border border-border-strong hover:bg-ink-50 hover:border-ink-300",
  ghost: "text-ink-700 hover:bg-ink-100",
  danger: "bg-danger text-white hover:brightness-110 shadow-card",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-[0.9375rem]",
};

/**
 * Exported separately so a `next/link` can be styled as a button without
 * wrapping it in a nested interactive element.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: ClassValue,
): string {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a busy state and blocks interaction without losing the label width. */
  busy?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // `disabled` alone would let a submit happen during a pending mutation.
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {busy ? (
        <>
          <Spinner />
          <span className="sr-only-focusable">Working</span>
        </>
      ) : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 rounded-full border-2 border-current border-r-transparent",
        "motion-safe:animate-[spin_0.7s_linear_infinite]",
        className,
      )}
    />
  );
}

export interface ChipProps {
  children: ReactNode;
  tone?: "neutral" | "brand" | "danger";
  className?: string;
}

const chipTones = {
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-ink-900 text-white",
  danger: "bg-danger-soft text-danger",
} as const;

/** Small metadata label. Square-ish, not a pill, to keep the grid calm. */
export function Chip({ children, tone = "neutral", className }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5",
        "text-xs font-semibold tabular-nums",
        chipTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
