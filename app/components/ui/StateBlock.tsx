import type { ReactNode } from "react";

import { buttonClasses } from "./Button";
import { cn } from "./cn";

/**
 * Skeleton block. Uses a neutral fill with a single sweep, and hides itself from
 * assistive tech so screen readers are told "loading" once, by the live region
 * in `StateBlock`, instead of per-shape.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-ink-100 motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function ProfileCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-3">
        <Skeleton className="size-14 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-3 min-h-[2.875rem] flex-1">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-5/6" />
      </div>
      <div className="mt-3.5 flex gap-2">
        <Skeleton className="h-5 w-16 rounded-md" />
        <Skeleton className="h-5 w-12 rounded-md" />
      </div>
      <Skeleton className="mt-3 h-4 w-1/2" />
    </div>
  );
}

export function ProfileGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      <span className="sr-only-focusable">Loading profiles</span>
      {Array.from({ length: count }, (_, i) => (
        <ProfileCardSkeleton key={i} />
      ))}
    </div>
  );
}

export interface StateBlockProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Centred panel for "no results" and other non-error empty states. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: StateBlockProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card",
        "border border-dashed border-border-strong bg-surface px-6 py-14 text-center",
        className,
      )}
    >
      <p className="text-base font-semibold text-fg">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps extends StateBlockProps {
  onRetry?: () => void;
}

/**
 * Errors get a border and a colour that is not carried by the text alone, plus
 * an explicit retry, so a failed fetch is never a dead end.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-card",
        "border border-danger/30 bg-danger-soft px-6 py-12 text-center",
        className,
      )}
    >
      <p className="text-base font-semibold text-danger">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{description}</p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={buttonClasses("secondary", "sm")}
          >
            Try again
          </button>
        ) : null}
        {action}
      </div>
    </div>
  );
}
