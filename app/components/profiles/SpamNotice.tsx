import { Alert } from "../ui/Icon";

// Firebase sends every auth email from its shared domain, which Gmail and
// Outlook often file under Spam or Promotions.
const SENDER = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  ? `noreply@${process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}`
  : null;

/** Prominent reminder shown wherever we have just sent an auth email. */
export function SpamNotice({ className = "" }: { className?: string }) {
  return (
    <div
      role="note"
      className={`flex items-start gap-3 rounded-control border-2 border-warning/50 bg-warning-soft px-4 py-3 text-sm text-warning ${className}`}
    >
      <Alert className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-1">
        <p className="font-bold uppercase tracking-wide">
          Can&apos;t find the email? Check your Spam folder
        </p>
        <p className="leading-relaxed">
          It often lands in <strong>Spam</strong> or <strong>Promotions</strong> and can take a few
          minutes to arrive. If you find it there, mark it &ldquo;Not spam&rdquo; so the link works.
          {SENDER ? (
            <>
              {" "}
              It comes from <span className="break-all font-semibold">{SENDER}</span>.
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
