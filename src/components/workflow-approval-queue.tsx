"use client";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

import { Button } from "@heroui/react";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WorkflowStateBadge } from "@/components/workflow-state-badge";
import { OperationalRegister } from "@/components/operations-ui";

export type WorkflowSignOffItem = {
  id: string;
  approvalRuleId: string;
  episodeId: string;
  showId: string;
  workflowStageId: string;
  stageName: string;
  stagePosition: number;
  signOffLabel: string;
  approverRole: string | null;
  approvalOrder: number;
  isRequired: boolean;
  passedAt: Date | null;
  showTitle: string;
  episodeTitle: string;
  episodeNumber: number;
};

export function WorkflowSignOffQueue({ signOffs }: { signOffs: WorkflowSignOffItem[] }) {
  return <OperationalRegister title="Awaiting my sign-off" description="Current workflow stages where you are the named sign-off person." empty={{ title: "No workflow stages are waiting for your sign-off.", description: "When an assigned episode reaches a required gate, it will appear here." }}>{signOffs.length ? signOffs.map((signOff) => <SignOffRow key={signOff.id} signOff={signOff} />) : null}</OperationalRegister>;
}

function SignOffRow({ signOff: item }: { signOff: WorkflowSignOffItem }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function signOff() {
    setSaving(true);
    setMessage("");
    try {
      const response = await postpilotUiFetch(`/v1/episodes/${item.episodeId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowStageId: item.workflowStageId, approvalRuleId: item.approvalRuleId, action: "sign_off" }) });
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
    <article className="operational-register__row operational-register__row--attention px-5 py-4">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#617b75]">{item.showTitle} · E{String(item.episodeNumber).padStart(2, "0")} {item.episodeTitle}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold"><Link href={`/episodes/${item.episodeId}`} className="text-[#3c4440] hover:text-[#54776d] hover:underline">{item.stageName}</Link></h3><WorkflowStateBadge status="awaiting_sign_off" /></div>
          <p className="mt-1 text-xs text-[#6e7772]">{item.signOffLabel} · Step {item.approvalOrder}{item.isRequired ? " · Required" : " · Optional"} · Current since {formatDate(item.passedAt)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="primary" onClick={signOff} isDisabled={saving} className="button--success"><Check size={15} /> {saving ? "Saving…" : "Sign off"}</Button>
        </div>
      </div>
      {message && <p role="status" className={`mt-3 text-xs ${message.includes("recorded") || message.includes("signed off") ? "text-[#3f7563]" : "text-[#a35e41]"}`}>{message}</p>}
    </article>
  );
}

function formatDate(value: Date | string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "just now";
}
