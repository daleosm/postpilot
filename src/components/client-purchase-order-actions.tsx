"use client";

import { Button } from "@heroui/react";
import { Check, CircleX, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ClientPurchaseOrderActions({ purchaseOrderId, status, mayApprove }: { purchaseOrderId: string; status: string; mayApprove: boolean }) {
  const router = useRouter(); const [error, setError] = useState<string | null>(null); const [pending, setPending] = useState<string | null>(null);
  if (!mayApprove || ["closed", "cancelled"].includes(status)) return null;
  async function update(nextStatus: "active" | "closed" | "cancelled") { setError(null); setPending(nextStatus); const response = await fetch(`/api/client-purchase-orders/${purchaseOrderId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) }); setPending(null); if (!response.ok) { const body = await response.json().catch(() => null); setError(body?.error ?? "Unable to update client PO status."); return; } router.refresh(); }
  return <div className="flex flex-wrap items-center justify-end gap-2">{error && <p role="alert" className="w-full text-right text-xs text-[#a35e41]">{error}</p>}{status === "draft" && <Button size="sm" variant="primary" isDisabled={Boolean(pending)} onPress={() => update("active")} className="bg-[#456f5e] text-white"><Check size={14}/>{pending === "active" ? "Activating…" : "Activate client PO"}</Button>}{status === "active" && <Button size="sm" variant="secondary" isDisabled={Boolean(pending)} onPress={() => update("closed")} className="border border-[#dfe3df] bg-white text-[#4e615a]"><LockKeyhole size={14}/>{pending === "closed" ? "Closing…" : "Close client PO"}</Button>}<Button size="sm" variant="tertiary" isDisabled={Boolean(pending)} onPress={() => update("cancelled")} className="text-[#a35e41]"><CircleX size={14}/>{pending === "cancelled" ? "Cancelling…" : "Cancel"}</Button></div>;
}
