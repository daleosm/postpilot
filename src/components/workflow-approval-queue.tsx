"use client";

import { Button } from "@heroui/react";
import { Check, ExternalLink, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type WorkflowApprovalItem = {
  id: string;
  episodeId: string;
  workflowStageId: string;
  stageName: string;
  stagePosition: number;
  approvalLabel: string;
  approverRole: string;
  approvalOrder: number;
  submittedAt: Date;
  showTitle: string;
  episodeTitle: string;
  episodeNumber: number;
  reviewCutId: string | null;
  reviewCutTitle: string | null;
  reviewCutVersion: number | null;
};

export function WorkflowApprovalQueue({ approvals, canOpenEpisodes }: { approvals: WorkflowApprovalItem[]; canOpenEpisodes: boolean }) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[#ebeae6] px-5 py-4"><h2 className="text-sm font-semibold text-[#343b38]">My approval queue</h2><p className="mt-1 text-xs text-[#858a87]">Only approval gates assigned to you appear here.</p></div>
      <div className="divide-y divide-[#efeeea]">
        {approvals.map((approval) => <ApprovalRow key={approval.id} approval={approval} canOpenEpisodes={canOpenEpisodes} />)}
        {!approvals.length && <p className="px-5 py-10 text-center text-sm text-[#858a87]">No workflow approvals are waiting for your sign-off.</p>}
      </div>
    </section>
  );
}

function ApprovalRow({ approval, canOpenEpisodes }: { approval: WorkflowApprovalItem; canOpenEpisodes: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function respond(action: "approve" | "request_changes") {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${approval.episodeId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowStageId: approval.workflowStageId, action }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error ?? "Could not record your decision.");
        return;
      }
      setMessage(action === "approve" ? "Approval recorded." : "Changes requested.");
      router.refresh();
    } catch {
      setMessage("Could not record your decision.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="px-5 py-4">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#617b75]">{approval.showTitle} · E{String(approval.episodeNumber).padStart(2, "0")} {approval.episodeTitle}</p>
          <h3 className="mt-1 text-sm font-semibold text-[#3c4440]">{approval.stageName}</h3>
          <p className="mt-1 text-xs text-[#6e7772]">{approval.approvalLabel} · Step {approval.approvalOrder} · Requested {formatDate(approval.submittedAt)}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {canOpenEpisodes && <Link href={`/episodes/${approval.episodeId}`} className="font-medium text-[#54776d] hover:underline">Open workflow</Link>}
            {approval.reviewCutId && <Link href={`/review/${approval.reviewCutId}`} className="inline-flex items-center gap-1 font-medium text-[#54776d] hover:underline"><ExternalLink size={12} /> Evidence: v{approval.reviewCutVersion} · {approval.reviewCutTitle}</Link>}
            {!approval.reviewCutId && <span className="text-[#858a87]">No review-cut evidence attached</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="tertiary" onClick={() => respond("request_changes")} isDisabled={saving} className="border border-[#e5d4c9] bg-[#fffaf7] text-[#9b5d41]"><RotateCcw size={14} /> Request changes</Button>
          <Button variant="primary" onClick={() => respond("approve")} isDisabled={saving} className="bg-[#3f7563] text-white"><Check size={15} /> {saving ? "Saving…" : "Approve"}</Button>
        </div>
      </div>
      {message && <p role="status" className={`mt-3 text-xs ${message === "Approval recorded." ? "text-[#3f7563]" : "text-[#a35e41]"}`}>{message}</p>}
    </article>
  );
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
