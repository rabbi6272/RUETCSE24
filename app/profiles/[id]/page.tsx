import { notFound, permanentRedirect } from "next/navigation";

import { findProfileById } from "../../../lib/db/students/students.admin.repo";
import { seriesFromRoll } from "../../../types/series";

interface ProfilePageProps {
  params: Promise<{ id: string }>;
}

/**
 * Old profile URLs (`/profiles/{uid}`) redirect to the profile's own series.
 * The series is read from the stored field (falling back to the roll, for
 * documents predating the backfill); a missing profile is a 404, not a
 * redirect.
 */
export default async function ProfilePage({ params }: ProfilePageProps) {
  const { id } = await params;

  const profile = await findProfileById(id);
  if (!profile) notFound();

  const series = profile.series || seriesFromRoll(profile.roll)?.id;
  if (!series) notFound();

  permanentRedirect(`/s/${series}/profiles/${id}`);
}
