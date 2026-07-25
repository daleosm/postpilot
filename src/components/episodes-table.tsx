"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

export type EpisodeTableRow = {
  id: string;
  code: string | null;
  title: string;
  number: number;
  showId: string;
  showTitle: string;
  seasonId: string;
  seasonNumber: number;
  workflowStage: string | null;
  editorName: string | null;
  producerName: string | null;
  lockedCutDate: string | null;
  deliveryDeadline: Date | null;
  qcStatus: string;
  status: string;
};

/** The episode register intentionally starts at the column labels. Page-level
 * scope and counts belong to the page header, not inside this dense table. */
export function EpisodesTable({ episodes }: { episodes: EpisodeTableRow[] }) {
  return (
    <section className="panel operational-register overflow-x-auto" aria-label="Episodes">
      <div className="min-w-[1090px]">
        <div className="episodes-register__header grid grid-cols-[92px_minmax(190px,1.4fr)_130px_74px_125px_125px_105px_106px] gap-3 border-b border-[#ebeae6] bg-[#fafaf8] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7e837f]">
          <span>Episode</span><span>Title</span><span>Show</span><span>Season</span><span>Editor</span><span>Producer</span><span>Lock</span><span>QC</span>
        </div>
        <div className="divide-y divide-[#efeeea]">
          {episodes.map((episode) => <EpisodeRow key={episode.id} episode={episode} />)}
          {!episodes.length && <div className="operational-empty px-5 py-12 text-center"><p className="font-semibold text-[#515b56]">No episodes are in this view.</p><p className="mt-1 text-xs text-[#858c87]">Choose another show or create an episode to begin the pipeline.</p></div>}
        </div>
      </div>
    </section>
  );
}

function EpisodeRow({ episode }: { episode: EpisodeTableRow }) {
  return (
    <div className={`operational-register__row grid grid-cols-[92px_minmax(190px,1.4fr)_130px_74px_125px_125px_105px_106px] items-center gap-3 px-5 py-3.5 ${episode.qcStatus === "needs_attention" ? "operational-register__row--attention" : ""}`}>
      <span className="font-mono text-xs font-semibold text-[#5a6964]">{episode.code ?? `E${String(episode.number).padStart(2, "0")}`}</span>
      <Link href={`/episodes/${episode.id}`} className="truncate text-sm font-medium text-[#3c4440] hover:text-[#3f7563] hover:underline">{episode.title}</Link>
      <span className="truncate text-xs text-[#737a76]">{episode.showTitle}</span>
      <span className="text-xs text-[#626965]">S{episode.seasonNumber}</span>
      <span className="truncate text-xs text-[#5e6763]">{episode.editorName ?? "—"}</span>
      <span className="truncate text-xs text-[#5e6763]">{episode.producerName ?? "—"}</span>
      <span className="text-xs text-[#777d79]">{episode.lockedCutDate ? new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(new Date(episode.lockedCutDate)) : "—"}</span>
      <span className={`flex w-fit items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${episode.qcStatus === "needs_attention" ? "bg-[#f8e5dc] text-[#a55f42]" : "bg-[#edf1ee] text-[#5e746d]"}`}>{episode.qcStatus === "needs_attention" && <TriangleAlert size={11} />}{episode.qcStatus.replaceAll("_", " ")}</span>
    </div>
  );
}
