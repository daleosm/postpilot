"use client";

import { Button } from "@heroui/react";
import { Check, ChefHat, Clock3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Request = { id: string; requestType: string; item: string; quantity: number; notes: string | null; requestedFor: Date | string | null; status: string; actualCost: string | number | null; billedAmount: string | number | null; markupPercent: string | number | null; currency: string; roomName: string | null; bookingTitle: string | null; episodeTitle: string | null; requesterName: string | null };
const transitions: Record<string, { label: string; value: string; icon: typeof Check }> = { requested: { label: "Acknowledge", value: "acknowledged", icon: Clock3 }, acknowledged: { label: "Start preparing", value: "preparing", icon: ChefHat }, preparing: { label: "Mark delivered", value: "delivered", icon: Check } };

export function RunnerRequestList({ requests }: { requests: Request[] }) {
  const router = useRouter();
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [costs, setCosts] = useState<Record<string, string>>({});
  async function advance(request: Request) {
    const next = transitions[request.status]; if (!next) return;
    setWorking(request.id); setError("");
    try {
      const response = await fetch("/api/catering-requests/" + request.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next.value }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(body?.error ?? "Could not update request."); else router.refresh();
    } catch { setError("Could not update request."); } finally { setWorking(null); }
  }
  async function recordCost(request: Request) { const amount = Number(costs[request.id]); if (!Number.isFinite(amount) || amount <= 0) return setError("Enter the total receipt cost before billing the episode."); setWorking(request.id); setError(""); try { const response = await fetch("/api/catering-requests/" + request.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "delivered", actualCost: amount }) }); const body = await response.json().catch(() => null); if (!response.ok) setError(body?.error ?? "Could not record the catering cost."); else router.refresh(); } catch { setError("Could not record the catering cost."); } finally { setWorking(null); } }
  return <section className="panel overflow-hidden"><div className="border-b border-[#ebeae6] px-5 py-4"><h2 className="text-sm font-semibold text-[#343b38]">Runner requests</h2><p className="mt-0.5 text-xs text-[#858a87]">Deliver first if needed; record the receipt total later to add it to the episode bill and budget.</p></div><div className="divide-y divide-[#efeeea]">{requests.map((request) => { const next = transitions[request.status]; const Icon = next?.icon; const awaitingCost = request.status === "delivered" && request.actualCost === null; return <div key={request.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1.3fr_1fr_auto] md:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-[#edf1ee] px-1.5 py-0.5 text-[10px] font-semibold capitalize text-[#557269]">{request.requestType.replaceAll("_", " ")}</span><span className="text-xs text-[#858a87]">{formatWhen(request.requestedFor)}</span></div><p className="mt-1.5 text-sm font-semibold text-[#3d4541]">{request.quantity}× {request.item}</p><p className="mt-1 text-xs text-[#747b77]">{request.notes || "No special instructions"}</p></div><div className="text-xs text-[#646d68]"><p className="font-medium text-[#434c47]">{request.roomName ?? "Room not set"}</p><p className="mt-1">{request.bookingTitle ?? "Ad hoc room request"}{request.episodeTitle ? " · " + request.episodeTitle : ""}</p><p className="mt-1 text-[#858a87]">Requested by {request.requesterName ?? "Post team"}</p></div>{next ? <Button variant="primary" isDisabled={working === request.id} onPress={() => advance(request)} className="bg-[#263130] text-white">{Icon && <Icon size={15} />}{working === request.id ? "Updating…" : next.label}</Button> : awaitingCost ? <div className="flex items-center gap-2"><input aria-label="Receipt total" type="number" min="0.01" step="0.01" placeholder={`Total ${request.currency}`} value={costs[request.id] ?? ""} onChange={(event) => setCosts((current) => ({ ...current, [request.id]: event.target.value }))} className="h-9 w-24 rounded-md border border-[#dedfda] bg-white px-2 text-xs" /><Button size="sm" variant="primary" isDisabled={working === request.id} onPress={() => recordCost(request)} className="bg-[#557269] text-white">Bill episode</Button></div> : <span className="rounded-full bg-[#e8f1eb] px-2 py-1 text-center text-[10px] font-semibold text-[#4d8068]">Billed {request.currency} {Number(request.billedAmount ?? request.actualCost).toFixed(2)}</span>}</div>; })}{!requests.length && <p className="px-5 py-10 text-center text-sm text-[#858a87]">No open requests. The floor is clear.</p>}</div>{error && <p className="border-t border-[#ebeae6] px-5 py-3 text-xs text-[#a35e41]">{error}</p>}</section>;
}

function formatWhen(value: Date | string | null) { return value ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "ASAP"; }
