/**
 * Sequence detail/replay page - Server Component wrapper
 */

import { notFound } from "next/navigation";

import { ReplayView } from "@/components/replay/ReplayView";
import { fetchSequence } from "@/lib/api";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SequencePage({ params }: PageProps) {
  const { id } = await params;

  let sequence;
  try {
    sequence = await fetchSequence(id);
  } catch {
    notFound();
  }

  return <ReplayView sequence={sequence} />;
}
