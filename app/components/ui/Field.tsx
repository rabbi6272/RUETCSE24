import { useId } from "react";

import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import type { InputHTMLAttributes } from "react";

import { ChevronDown } from "./Icon";
import { cn } from "./cn";

const control =
  "w-full rounded-control border bg-surface px-3.5 text-[0.9375rem] text-fg " +
  "placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-150 " +
  "focus:outline-none focus:ring-[3px] " +
  "disabled:bg-surface-sunken disabled:text-fg-subtle disabled:cursor-not-allowed";

const controlOk =
  "border-border-strong focus:border-ink-700 focus:ring-ink-900/15";

const controlBad = "border-danger focus:border-danger focus:ring-danger/20";

function describedBy(hintId?: string, errorId?: string, error?: string) {
  return [hintId, error ? errorId : undefined].filter(Boolean).join(" ");
}

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  counter?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Label, control, hint, and error are rendered together so the wiring
 * (`htmlFor`, `aria-describedby`, `aria-invalid`) cannot drift between them.
 */
function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  counter,
  children,
  className,
}: FieldShellProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-fg">
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          ) : null}
        </label>
        {counter}
      </div>

      {children}

      {hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-fg-muted">
          {hint}
        </p>
      ) : null}

      {/*
        Always rendered, so the live region exists before the error arrives and
        the announcement is not swallowed on first render.
      */}
      <p
        id={errorId}
        role="alert"
        className={cn("text-xs font-medium text-danger", !error && "sr-only-focusable")}
      >
        {error ?? ""}
      </p>
    </div>
  );
}

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: ReactNode;
  error?: string;
  id?: string;
}

export function TextField({
  label,
  hint,
  error,
  id,
  required,
  className,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = `${fieldId}-hint`;

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <input
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId : undefined, `${fieldId}-error`, error)}
        className={cn(
          control,
          "h-11",
          error ? controlBad : controlOk,
        )}
        {...rest}
      />
    </FieldShell>
  );
}

export interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Renders a live "n / max" counter. Pass the current length as `value`. */
  maxLength?: number;
  value?: string;
  id?: string;
}

export function TextAreaField({
  label,
  hint,
  error,
  maxLength,
  value,
  id,
  required,
  className,
  rows = 4,
  ...rest
}: TextAreaFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = `${fieldId}-hint`;
  const used = value?.length ?? 0;
  const nearLimit = maxLength != null && used > maxLength * 0.9;

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
      counter={
        maxLength != null ? (
          <span
            aria-hidden="true"
            className={cn(
              "text-xs tabular-nums",
              nearLimit ? "font-semibold text-warning" : "text-fg-subtle",
            )}
          >
            {used} / {maxLength}
          </span>
        ) : null
      }
    >
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        maxLength={maxLength}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId : undefined, `${fieldId}-error`, error)}
        className={cn(control, "py-2.5 resize-y", error ? controlBad : controlOk)}
        {...rest}
      />
    </FieldShell>
  );
}

export interface ToggleFieldProps {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  className?: string;
}

/**
 * A real checkbox underneath a styled switch: keyboard support, form
 * participation, and the checked state come from the native control, while the
 * visual track is decoration.
 */
export function ToggleField({
  label,
  hint,
  checked,
  onChange,
  disabled,
  name,
  className,
}: ToggleFieldProps) {
  const hintId = name ? `${name}-hint` : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={hint ? hintId : undefined}
          className="peer sr-only-focusable"
        />
        <span
          aria-hidden="true"
          className={cn(
            "relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors duration-200",
            "peer-checked:bg-ink-900 peer-focus-visible:outline peer-focus-visible:outline-2",
            "peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink-900",
            "peer-disabled:opacity-50",
            checked ? "bg-ink-900" : "bg-border-strong",
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-card",
              "transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
              checked && "translate-x-4",
            )}
          />
        </span>

        <span className="min-w-0">
          <span className="block text-sm font-semibold text-fg">{label}</span>
          {hint ? (
            <span id={hintId} className="mt-0.5 block text-xs text-fg-muted">
              {hint}
            </span>
          ) : null}
        </span>
      </label>
    </div>
  );
}

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  hint?: ReactNode;
  error?: string;
  id?: string;
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  error,
  id,
  required,
  className,
  children,
  ...rest
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = `${fieldId}-hint`;

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      {/*
        `appearance-none` drops the platform arrow so the control looks the
        same everywhere; the icon is decoration — the select underneath keeps
        all of its native keyboard and screen-reader behaviour.
      */}
      <div className="relative">
        <select
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint ? hintId : undefined, `${fieldId}-error`, error)}
          className={cn(
            control,
            "h-11 appearance-none pr-9",
            error ? controlBad : controlOk,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      </div>
    </FieldShell>
  );
}
