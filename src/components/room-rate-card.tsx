"use client";

import { Button } from "@heroui/react";
import { Building2, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

const billingUnits = [["hour", "Hourly"], ["day", "Day"], ["fixed", "Fixed fee"]] as const;
type BillingUnit = (typeof billingUnits)[number][0];
type Scope = { type: "master" } | { type: "network"; network: string } | { type: "show"; showId: string } | { type: "episode"; episodeId: string };
type Rate = { id: string; category: string; unit: BillingUnit; rate: string | number; internalCostRate: string | number | null; currency: string; sourceScope: string };
type Room = { id: string; name: string; type: string; ownRates: Rate[]; inheritedRates: Rate[] };
type PriceValues = Record<BillingUnit, string>;

function scopeParams(scope: Scope) {
  if (scope.type === "master") return new URLSearchParams({ scope: "master" });
  if (scope.type === "network") return new URLSearchParams({ scope: "network", network: scope.network });
  if (scope.type === "show") return new URLSearchParams({ scope: "show", show_id: scope.showId });
  return new URLSearchParams({ scope: "episode", episode_id: scope.episodeId });
}
function titleCase(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function money(value: string | number | null, currency: string) { if (value === null) return "—"; return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value)); }
function blankPrices(): PriceValues { return { hour: "", day: "", fixed: "" }; }
function rateFor(rates: Rate[], unit: BillingUnit) { return rates.find((rate) => rate.unit === unit); }

/** Room-specific commercial prices are one room row with optional hourly, day and fixed-fee slots. */
export function RoomRateCard({ scope }: { scope: Scope }) {
  const router = useRouter(); const [rooms, setRooms] = useState<Room[]>([]); const [loading, setLoading] = useState(true);
  const params = scopeParams(scope).toString(); const isMaster = scope.type === "master";
  const load = useCallback(async () => { setLoading(true); const response = await postpilotUiFetch(`/v1/rate-cards/room-rates?${params}`); const body = response.ok ? await response.json().catch(() => null) : null; setRooms(body?.rooms ?? []); setLoading(false); }, [params]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  return <section className="overflow-hidden rounded-lg border border-[#ebeae6] bg-[#fefefa]">
    <div className="border-b border-[#ebeae6] px-5 py-4"><h3 className="text-sm font-semibold text-[#343b38]">Room prices</h3><p className="mt-1 text-xs text-[#858a87]">{isMaster ? "Rooms come from Settings. Add any agreed hourly, day, or fixed-fee price to each room." : "Rooms come from Settings. They inherit prices until this card needs a room-specific exception."}</p></div>
    <div className="divide-y divide-[#efeeea]">{rooms.map((room) => <RoomRateRow key={room.id} room={room} scope={scope} onChanged={async () => { await load(); router.refresh(); }} />)}{!loading && !rooms.length && <p className="px-5 py-5 text-xs text-[#858a87]">No rooms are configured in Settings.</p>}{loading && <p className="px-5 py-5 text-xs text-[#858a87]">Loading room prices…</p>}</div>
  </section>;
}

function RateSlots({ ownRates, inheritedRates }: { ownRates: Rate[]; inheritedRates: Rate[] }) {
  const currency = ownRates[0]?.currency ?? inheritedRates[0]?.currency ?? "GBP";
  return <div className="grid grid-cols-3 gap-2 text-right text-xs">{billingUnits.map(([unit, label]) => { const own = rateFor(ownRates, unit); const inherited = rateFor(inheritedRates, unit); const effective = own ?? inherited; return <div key={unit}><p className="text-[#858a87]">{label}</p><p className="font-semibold text-[#3d4642]">{effective ? money(effective.rate, currency) : "—"}</p>{own && inherited && <p className="text-[10px] text-[#718078]">override</p>}</div>; })}</div>;
}

function RoomRateRow({ room, scope, onChanged }: { room: Room; scope: Scope; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [removing, setRemoving] = useState(false); const [error, setError] = useState("");
  const ownRates = room.ownRates ?? []; const inheritedRates = room.inheritedRates ?? []; const isMaster = scope.type === "master";
  async function remove() { if (!ownRates.length) return; setRemoving(true); setError(""); for (const rate of ownRates) { const response = await postpilotUiFetch(`/v1/rate-cards/items/${rate.id}`, { method: "DELETE" }); if (!response.ok) { const body = await response.json().catch(() => null); setError(body?.detail ?? body?.error ?? "Could not remove the room override."); setRemoving(false); return; } } await onChanged(); }
  return <div className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Building2 size={14} className="text-[#668273]" /><p className="truncate text-sm font-semibold text-[#404844]">{room.name}</p><span className="service-rate-inactive">Room</span></div><p className="mt-1.5 text-xs text-[#7d837f]">{room.type} · {ownRates.length ? (isMaster ? "master prices" : "scope override") : inheritedRates.length ? `inherits from ${titleCase(inheritedRates[0].sourceScope)}` : "No prices configured"}</p></div><div className="flex flex-wrap items-center gap-2 sm:justify-end"><RateSlots ownRates={ownRates} inheritedRates={inheritedRates} /><Button size="sm" variant="tertiary" onPress={() => setOpen(true)} className="min-w-0 border border-[#dfe3df] bg-white text-[#58635e]"><Pencil size={13} /> {ownRates.length ? "Edit prices" : isMaster ? "Set prices" : "Override"}</Button>{ownRates.length > 0 && <Button size="sm" variant="tertiary" onPress={remove} isDisabled={removing} className="min-w-0 border border-[#eeded8] bg-[#fffdfb] text-[#a35e41]"><Trash2 size={13} /> {removing ? "Removing…" : "Remove"}</Button>}{error && <p role="alert" className="basis-full text-right text-xs text-[#a35e41]">{error}</p>}</div>{open && <RoomRateDialog room={room} scope={scope} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await onChanged(); }} />}</div>;
}

function RoomRateDialog({ room, scope, onClose, onSaved }: { room: Room; scope: Scope; onClose: () => void; onSaved: () => Promise<void> }) {
  const ownRates = room.ownRates ?? []; const inheritedRates = room.inheritedRates ?? [];
  const initial = (cost = false) => billingUnits.reduce<PriceValues>((values, [unit]) => { const rate = rateFor(ownRates, unit) ?? rateFor(inheritedRates, unit); values[unit] = rate ? String(cost ? rate.internalCostRate ?? "" : rate.rate) : ""; return values; }, blankPrices());
  const [rates, setRates] = useState<PriceValues>(() => initial()); const [costs, setCosts] = useState<PriceValues>(() => initial(true)); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const isMaster = scope.type === "master";
  async function save() { if (!billingUnits.some(([unit]) => rates[unit].trim())) return setError("Enter at least one client price."); setSaving(true); setError(""); for (const [unit] of billingUnits) { const existing = rateFor(ownRates, unit); const value = rates[unit].trim(); if (!value) { if (existing) { const removed = await postpilotUiFetch(`/v1/rate-cards/items/${existing.id}`, { method: "DELETE" }); if (!removed.ok) { setSaving(false); return setError("Could not remove the cleared price."); } } continue; } if (Number(value) <= 0) { setSaving(false); return setError("Client prices must be greater than zero."); } if (costs[unit] && Number(costs[unit]) < 0) { setSaving(false); return setError("Internal costs cannot be negative."); } const response = await postpilotUiFetch("/v1/rate-cards/overrides", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: scope.type, network: scope.type === "network" ? scope.network : null, showId: scope.type === "show" ? scope.showId : null, episodeId: scope.type === "episode" ? scope.episodeId : null, targetType: "room", roomId: room.id, category: existing?.category ?? rateFor(inheritedRates, unit)?.category ?? (room.type || room.name), unit, rate: Number(value), internalCostRate: costs[unit] ? Number(costs[unit]) : null }) }); const body = await response.json().catch(() => null); if (!response.ok) { setSaving(false); return setError(body?.detail ?? body?.error ?? "Could not save the room price."); } } await onSaved(); }
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#202725]/30 p-4" role="dialog" aria-modal="true" aria-labelledby="room-rate-override-title"><div className="w-full max-w-2xl rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h3 id="room-rate-override-title" className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{ownRates.length ? "Edit room prices" : isMaster ? "Set master room prices" : "Override room prices"}</h3><p className="mt-1 text-sm text-[#767c78]">Set only the billing structures this room can be sold on. Empty prices are not offered to estimates.</p></div><Button isIconOnly variant="tertiary" onPress={onClose} aria-label="Close room rate form" className="min-w-0 text-[#7d827e]"><X size={18} /></Button></div><div className="mt-5 rounded-md border border-[#dce7df] bg-[#f2f8f3] px-3 py-2 text-xs text-[#486454]"><b>{room.name}</b><span className="ml-2 text-[#718078]">{room.type}</span></div><div className="mt-5 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-[#e4e5df] text-[#747b76]"><th className="pb-2 font-medium">Billing structure</th><th className="pb-2 font-medium">Client price</th><th className="pb-2 font-medium">Internal cost <span className="font-normal">(optional)</span></th></tr></thead><tbody>{billingUnits.map(([unit, label]) => <tr key={unit} className="border-b border-[#efeeea]"><td className="py-3 font-medium text-[#4b544f]">{label}</td><td className="py-3 pr-3"><input value={rates[unit]} onChange={(event) => setRates((current) => ({ ...current, [unit]: event.target.value }))} type="number" min="0" step="0.01" placeholder="Not offered" className="h-10 w-full rounded-md border border-[#dedfda] bg-white px-3 text-sm" /></td><td className="py-3"><input value={costs[unit]} onChange={(event) => setCosts((current) => ({ ...current, [unit]: event.target.value }))} type="number" min="0" step="0.01" placeholder="Optional" className="h-10 w-full rounded-md border border-[#dedfda] bg-white px-3 text-sm" /></td></tr>)}</tbody></table></div>{error && <p role="alert" className="mt-3 text-xs text-[#a35e41]">{error}</p>}<div className="mt-6 flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button variant="tertiary" onPress={onClose}>Cancel</Button><Button variant="primary" onPress={save} isDisabled={saving} className="bg-[#263130] text-white">{saving ? "Saving…" : "Save room prices"}</Button></div></div></div>;
}
