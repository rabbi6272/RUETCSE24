"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "./ui/cn";
import { buttonClasses } from "./ui/Button";

export function Navbar() {
  const pathname = usePathname();

  // Series context comes from the URL (`/s/24/...`) — no provider needed.
  const seriesId = /^\/s\/(\d{2})(?:\/|$)/.exec(pathname)?.[1] ?? null;

  const updateActive = pathname === "/profiles/update";
  // Within a series everything (directory, detail pages) is "Directory";
  // account routes under /profiles keep the pre-series behaviour.
  const directoryActive = seriesId
    ? pathname.startsWith(`/s/${seriesId}`)
    : pathname.startsWith("/profiles") && !updateActive;

  const directoryHref = seriesId ? `/s/${seriesId}` : "/";

  return (
    <nav
      aria-label="Primary"
      className="sticky top-0 z-50 w-full border-b border-border bg-canvas/85 px-4 backdrop-blur-md md:px-6 lg:px-8"
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="RUET CSE home">
          <Image
            src="/TitleIcon.png"
            alt="RUET CSE"
            width={70}
            height={30}
            priority
            style={{ height: "auto" }}
          />
        </Link>

        <div className="flex items-center gap-1.5">
          <Link
            href={directoryHref}
            aria-current={directoryActive ? "page" : undefined}
            className={cn(
              "rounded-control px-3 py-2 text-sm font-semibold transition-colors",
              directoryActive
                ? "bg-ink-100 text-fg"
                : "text-ink-700 hover:bg-ink-100 hover:text-ink-900",
            )}
          >
            Directory
          </Link>
          <Link
            href="/profiles/update"
            aria-current={updateActive ? "page" : undefined}
            className={cn(
              buttonClasses("secondary", "sm"),
              updateActive && "border-ink-300 bg-ink-50",
            )}
          >
            My profile
          </Link>
        </div>
      </div>
    </nav>
  );
}
