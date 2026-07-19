"use client";

import { Button } from "@heroui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Review = { id: string; episodeId: string; title: string; number: number; productionCode: string | null; showTitle: string; seasonNumber: number; reason: string; legacyStatus: string | null };

export function WorkflowMigrationReviewQueue({ reviews }: { reviews: Review[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  if (!reviews.length) return null;

  async function close(review: Review, status: "resolved" | "ignored") {
    const resolutionNote = notes[review.id]?.trim();
    if (!resolutionNote) return setMessage("Add a short review note before closing an item.");
    setSaving(review.id); setMessage("");
    try {
      const response = await fetch(`/api/episodes/${review.episodeId}/workflow-migration-review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, resolutionNote }) });
      if (!response.ok) return setMessage((await response.json().catch(() => null))?.error ?? "Could not update the review item.");
      router.refresh();
    } catch { setMessage("Could not update the review item."); } finally { setSaving(null); }
  }

  return <section className="panel overflow-hidden"><div className="border-b border-[#ebeae6] bg-[#fcf8f1] px-5 py-4"><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#987141]">Workflow migration review</p><h2 className="mt-1 text-sm font-semibold text-[#4a463d]">{reviews.length} episode{reviews.length === 1 ? "" : "s"} need a workflow-state check</h2><p className="mt-1 text-xs leading-5 text-[#756d60]">These legacy rows were left conservative rather than guessing progress. Confirm the episode’s tracks, then resolve or ignore the review item with a note.</p></div><div className="divide-y divide-[#efeeea]">{reviews.map((review) => <div key={review.id} className="px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/episodes/${review.episodeId}`} className="text-sm font-semibold text-[#466b61] hover:underline">{review.showTitle} · S{review.seasonNumber}E{String(review.number).padStart(2, "0")} · {review.title}</Link><p className="mt-1 text-xs leading-5 text-[#675f53]">{review.reason}</p>{review.legacyStatus && <p className="mt-1 text-[11px] text-[#8a8173]">Legacy status: {review.legacyStatus.replaceAll("_", " ")}</p>}</div></div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={notes[review.id] ?? ""} onChange={(event) => setNotes((items) => ({ ...items, [review.id]: event.target.value }))} placeholder="Review note…" className="h-8 min-w-0 flex-1 rounded-md border border-[#ddd9d0] bg-white px-2 text-xs text-[#4c504a]" /><div className="flex gap-2"><Button size="sm" variant="tertiary" onPress={() => close(review, "ignored")} isDisabled={saving === review.id} className="border border-[#ddd9d0] bg-white text-[#70695f]">Ignore</Button><Button size="sm" variant="primary" onPress={() => close(review, "resolved")} isDisabled={saving === review.id} className="bg-[#406d5d] text-white">{saving === review.id ? "Saving…" : "Resolve"}</Button></div></div></div>)}</div>{message && <p role="alert" className="border-t border-[#ebeae6] px-5 py-3 text-xs text-[#a35e41]">{message}</p>}</section>;
}
