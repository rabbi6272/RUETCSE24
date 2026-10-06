"use client";

import { useCallback, useEffect, useId, useRef } from "react";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { X } from "./Icon";
import { cn } from "./cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Built on the native `<dialog>` element so focus trapping, background inerting,
 * Escape handling, and top-layer stacking come from the platform rather than
 * from hand-rolled key handlers that usually miss edge cases.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // `cancel` covers Escape; this keeps React state in step with the element.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };

    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (event: ReactMouseEvent<HTMLDialogElement>) => {
      // Clicks land on the dialog itself only when they hit the backdrop, since
      // the inner panel stops propagation.
      if (event.target === ref.current) onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
      className={cn(
        "w-[min(30rem,calc(100vw-2rem))] rounded-panel p-0",
        "bg-surface text-fg shadow-overlay backdrop:bg-ink-950/45 backdrop:backdrop-blur-[2px]",
        // Native dialogs are display:none until opened; let our panel control it.
        "[&:not([open])]:hidden",
        className,
      )}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id={titleId}
              className="text-lg font-bold tracking-tight text-fg"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-fg-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1 -mt-1 rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-ink-100 hover:text-fg"
          >
            <X className="size-5" />
          </button>
        </div>

        {children ? <div className="mt-5">{children}</div> : null}
      </div>

      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-surface-sunken px-5 py-4 sm:px-6">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
