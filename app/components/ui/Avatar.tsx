import { CldImage } from "next-cloudinary";

import { cn } from "./cn";

const SIZES = {
  sm: "size-10 text-sm",
  md: "size-14 text-lg",
  lg: "size-24 text-3xl",
  xl: "size-32 text-4xl",
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * Up to two initials. Handles single-word and Bangladeshi name order, where the
 * family name is commonly written first.
 */
export function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
  /** Decorative by default; pass a label when the image carries meaning. */
  alt?: string;
}

export function Avatar({
  name,
  src,
  size = "md",
  className,
  alt,
}: AvatarProps) {
  const ring = "ring-1 ring-border bg-ink-100 text-ink-600";

  if (src) {
    return (
      <CldImage
        crop="fill"
        gravity="face"
        width={256}
        height={256}
        src={src}
        alt={alt ?? ""}
        className={cn(
          "shrink-0 rounded-full object-cover",
          SIZES[size],
          ring,
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden={alt ? undefined : true}
      role={alt ? "img" : undefined}
      aria-label={alt}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        "font-bold tracking-tight select-none",
        SIZES[size],
        ring,
        className,
      )}
    >
      {initialsFrom(name)}
    </span>
  );
}
