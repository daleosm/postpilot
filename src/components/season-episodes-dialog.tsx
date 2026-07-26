"use client";

import { Button } from "@heroui/react";
import { List, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { WorkflowStateBadge } from "@/components/workflow-state-badge";

type SeasonEpisode = {
  id: string;
  number: number;
  title: string;
  workflowStage: string | null;
  status: string;
  editorName: string | null;
};

export function SeasonEpisodesDialog({ seasonNumber, episodes }: { seasonNumber: number; episodes: SeasonEpisode[] }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" variant="tertiary" onPress={() => setOpen(true)} className="min-w-0 text-xs font-semibold text-[#58766e] hover:text-[#365f53]">
      View episodes <List size={13} />
    </Button>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#202725]/30 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Season ${seasonNumber} episodes`}>
      <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[#e2e3de] bg-[#fafbf9] shadow-2xl sm:rounded-xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#ebeae6] px-5 py-4 sm:px-6">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#75817c]">Show episodes</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">Season {seasonNumber} episodes</h2><p className="mt-1 text-sm text-[#747c78]">{episodes.length} episode{episodes.length === 1 ? "" : "s"} in this season.</p></div>
          <Button isIconOnly variant="tertiary" onPress={() => setOpen(false)} aria-label="Close season episodes"><X size={18} /></Button>
        </header>
        <div className="divide-y divide-[#efeeea]">{episodes.map((episode) => <Link key={episode.id} href={`/episodes/${episode.id}`} onClick={() => setOpen(false)} className="flex items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-[#fbfbf9] sm:px-6"><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#3c4541]">E{String(episode.number).padStart(2, "0")} · {episode.title}</p><p className="mt-0.5 truncate text-xs text-[#78817c]">{episode.workflowStage ?? "Workflow not configured"} · {episode.editorName ?? "Unassigned"}</p></div><WorkflowStateBadge status={episode.status} className="shrink-0" /></Link>)}{!episodes.length && <p className="px-5 py-10 text-center text-sm text-[#858a87]">No episodes have been added to this season.</p>}</div>
      </section>
    </div>}
  </>;
}
