"use client";

import { Button } from "@heroui/react";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type WorkflowSignOffItem = {
  id: string;
  approvalRuleId: string;
  episodeId: string;
  showId: string;
  workflowStageId: string;
  stageName: string;
  stagePosition: number;
  signOffLabel: string;
  approverRole: string;
  approvalOrder: number;
  isRequired: boolean;
  passedAt: Date | null;
  showTitle: string;
  episodeTitle: string;
  episodeNumber: number;
};

export function WorkflowSignOffQueue({ signOffs, canSignOff }: { signOffs: WorkflowSignOffItem[]; canSignOff: boolean }) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[#ebeae6] px-5 py-4"><h2 className="text-sm font-semibold text-[#343b38]">Awaiting my sign-off</h2><p className="mt-1 text-xs text-[#858a87]">Current workflow stages that have reached your configured sign-off role.</p></div>
      <div className="divide-y divide-[#efeeea]">
        {signOffs.map((signOff) => <SignOffRow key={signOff.id} signOff={signOff} canSignOff={canSignOff} />)}
        {!signOffs.length && <p className="px-5 py-10 text-center text-sm text-[#858a87]">No workflow stages are waiting for your sign-off.</p>}
      </div>
    </section>
  );
}

function SignOffRow({ signOff: item, canSignOff }: { signOff: WorkflowSignOffItem; canSignOff: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function signOff() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${item.episodeId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowStageId: item.workflowStageId, approvalRuleId: item.approvalRuleId, action: "sign_off" }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error ?? "Could not record your decision.");
        return;
      }
      setMessage(body?.stageComplete ? "Stage fully signed off." : "Sign-off recorded.");
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
          <p className="text-xs font-medium text-[#617b75]">{item.showTitle} · E{String(item.episodeNumber).padStart(2, "0")} {item.episodeTitle}</p>
          <h3 className="mt-1 text-sm font-semibold"><Link href={`/episodes/${item.episodeId}`} className="text-[#3c4440] hover:text-[#54776d] hover:underline">{item.stageName}</Link></h3>
          <p className="mt-1 text-xs text-[#6e7772]">{item.signOffLabel} · Step {item.approvalOrder}{item.isRequired ? " · Required" : " · Optional"} · Current since {formatDate(item.passedAt)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canSignOff && <Button variant="primary" onClick={signOff} isDisabled={saving} className="button--success"><Check size={15} /> {saving ? "Saving…" : "Sign off"}</Button>}
        </div>
      </div>
      {message && <p role="status" className={`mt-3 text-xs ${message.includes("recorded") || message.includes("signed off") ? "text-[#3f7563]" : "text-[#a35e41]"}`}>{message}</p>}
    </article>
  );
}

function formatDate(value: Date | string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "just now";
}
