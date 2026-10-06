import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Navbar } from "../../components/Navbar";
import { seriesMetadata } from "../../seo";
import { getSeries } from "../../../types/series";

interface SeriesLayoutProps {
  children: React.ReactNode;
  params: Promise<{ series: string }>;
}

export async function generateMetadata({
  params,
}: SeriesLayoutProps): Promise<Metadata> {
  const { series } = await params;
  const entry = getSeries(series);
  if (!entry) return {};

  return seriesMetadata(entry);
}

export default async function SeriesLayout({
  children,
  params,
}: SeriesLayoutProps) {
  const { series } = await params;
  if (!getSeries(series)) notFound();

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-64px)]">{children}</main>
    </>
  );
}
