"use client";

import Link from "next/link";

import { useProfile, useViewerProfile } from "../../../lib/db/students/students.hooks";
import { seriesFromRoll } from "../../../types/series";

import type { ReactNode } from "react";

import { Avatar } from "../ui/Avatar";
import { Chip, buttonClasses } from "../ui/Button";
import { CopyButton } from "../ui/CopyButton";
import { Alert, ArrowLeft, Droplet, Facebook, Pencil, Spark } from "../ui/Icon";
import { EmptyState, ErrorState, Skeleton } from "../ui/StateBlock";

function DetailSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <span className="sr-only-focusable">Loading profile</span>
      <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <Skeleton className="size-24 rounded-full" />
          <div className="w-full flex-1 space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-5 w-20 rounded-md" />
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-5 w-14 rounded-md" />
            </div>
          </div>
        </div>
        <Skeleton className="mt-8 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-11/12" />
        <Skeleton className="mt-2 h-3 w-8/12" />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border py-4 first:border-t-0 sm:flex-row sm:items-center sm:gap-6">
      <dt className="text-sm font-semibold text-fg-muted sm:w-40 sm:shrink-0">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-1 text-[0.9375rem] text-fg">
        {children}
      </dd>
    </div>
  );
}

export function ProfileDetail({ id }: { id: string }) {
  const { data: profile, isPending, isError, refetch } = useProfile(id);
  const { data: viewer } = useViewerProfile();

  if (isPending) return <DetailSkeleton />;

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
        <ErrorState
          title="Could not load this profile"
          description="The profile failed to load. This is usually temporary."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
        <EmptyState
          title="Profile not found"
          description="This profile does not exist, or it has not been published yet."
          action={
            <Link href="/" className={buttonClasses("secondary", "sm")}>
              Back to home
            </Link>
          }
        />
      </div>
    );
  }

  const isOwner = viewer?.id === profile.id;
  const targetSeries = profile.series || seriesFromRoll(profile.roll)?.id || "";
  const directoryHref = targetSeries ? `/s/${targetSeries}` : "/";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
      <Link
        href={directoryHref}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 underline-offset-4 hover:text-ink-900 hover:underline"
      >
        <ArrowLeft className="size-4" />
        Directory
      </Link>

      <article className="mt-4 rounded-panel border border-border bg-surface shadow-card">
        <header className="flex flex-col items-center gap-5 border-b border-border p-6 text-center sm:flex-row sm:items-start sm:gap-6 sm:p-8 sm:text-left">
          <Avatar
            name={profile.fullName}
            src={profile.profilePicture?.url}
            size="xl"
          />

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-fg">
              {profile.fullName}
            </h1>
            {profile.nickname ? (
              <p className="mt-0.5 text-[0.9375rem] text-fg-muted">
                {profile.nickname}
              </p>
            ) : null}

            <div className="mt-3.5 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              <Chip tone="brand">{profile.roll}</Chip>
              <Chip>Section {profile.sec.toUpperCase()}</Chip>
              {profile.bloodGroup ? (
                <Chip>
                  <Droplet className="size-3.5 text-danger" />
                  {profile.bloodGroup}
                </Chip>
              ) : null}
            </div>

            {isOwner ? (
              <div className="mt-5 flex justify-center sm:justify-start">
                <Link
                  href="/profiles/update"
                  className={buttonClasses("secondary", "sm")}
                >
                  <Pencil className="size-4" />
                  Edit profile
                </Link>
              </div>
            ) : null}
          </div>
        </header>

        <div className="p-6 sm:p-8">
          {profile.bio ? (
            <section aria-labelledby="detail-bio" className="mb-6">
              <h2
                id="detail-bio"
                className="text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle"
              >
                About
              </h2>
              <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-fg">
                {profile.bio}
              </p>
            </section>
          ) : null}

          <section aria-labelledby="detail-details">
            <h2
              id="detail-details"
              className="text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle"
            >
              Details
            </h2>

            <dl className="mt-2">
              <Row label="Email">
                <span className="break-all">{profile.email}</span>
                <CopyButton
                  value={profile.email}
                  label={`Copy ${profile.fullName}'s email address`}
                />
              </Row>

              {profile.hobby ? (
                <Row label="Hobby">
                  <Spark className="size-4 text-fg-subtle" />
                  {profile.hobby}
                </Row>
              ) : null}

              {profile.fbProfile ? (
                <Row label="Facebook">
                  <a
                    href={profile.fbProfile}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-2 break-all font-medium text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
                  >
                    <Facebook className="size-4 shrink-0" />
                    {profile.fbProfile.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                </Row>
              ) : null}

              <Row label="Member since">
                {new Date(profile.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </Row>
            </dl>
          </section>

          {/*
            The mobile number is intentionally absent: it is stored under
            `profiles/{uid}/private/contact` and is not readable by clients.
          */}
          {!isOwner ? (
            <p className="mt-6 flex items-start gap-2 border-t border-border pt-5 text-xs leading-relaxed text-fg-subtle">
              <Alert className="mt-0.5 size-3.5 shrink-0" />
              Contact details other than the email above are kept private. Use the
              email to reach this student.
            </p>
          ) : null}
        </div>
      </article>
    </div>
  );
}
