import Link from "next/link";

import { Avatar } from "../ui/Avatar";
import { Chip } from "../ui/Button";
import { Droplet, Spark } from "../ui/Icon";
import { cn } from "../ui/cn";

import type { Profile } from "../../../types/Student";

export interface ProfileCardProps {
  profile: Profile;
  className?: string;
}

/**
 * One directory entry. The whole surface is a single link — no nested buttons,
 * since a card-sized hit target with a stretched pseudo-element keeps it both
 * clickable and reachable by keyboard without nesting interactives.
 */
export function ProfileCard({ profile, className }: ProfileCardProps) {
  const { fullName, nickname, roll, bloodGroup, hobby, bio, profilePicture, sec } =
    profile;

  // Series-scoped URL; the pre-series `/profiles/{id}` stub redirects anyway,
  // so a profile stamped without a series still resolves.
  const href = profile.series
    ? `/s/${profile.series}/profiles/${profile.id}`
    : `/profiles/${profile.id}`;

  return (
    <Link
      href={href}
      className={cn(
        "group relative flex h-full flex-col rounded-card border border-border bg-surface p-4",
        "shadow-card transition-[box-shadow,border-color,transform] duration-250",
        "hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-raised",
        "focus-visible:-translate-y-0.5 focus-visible:border-ink-300",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={fullName} src={profilePicture?.url} size="lg" />

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.9375rem] font-bold leading-snug text-fg">
            {fullName}
          </h3>
          {nickname ? (
            <p className="truncate text-sm text-fg-muted">{nickname}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 min-h-11.5 flex-1">
        {bio ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-fg-muted">
            {bio}
          </p>
        ) : null}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <Chip tone="brand">{roll}</Chip>
        <Chip>
          Section {sec.toUpperCase()}
        </Chip>
        {bloodGroup ? (
          <Chip>
            <Droplet className="size-3.5 text-danger" />
            {bloodGroup}
          </Chip>
        ) : null}
      </div>

      <div className="mt-3 flex min-h-4 items-center gap-1.5 text-xs text-fg-subtle">
        {hobby ? (
          <>
            <Spark className="size-3.5" />
            <span className="truncate">{hobby}</span>
          </>
        ) : null}
      </div>
    </Link>
  );
}
