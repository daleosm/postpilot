"use client";

import { Button } from "@heroui/react";
import { Building2, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

const billingUnits = [
  ["hour", "Hour"],
  ["half_day", "Half-day"],
  ["day", "Day"],
  ["week", "Week"],
  ["fixed", "Fixed fee"],
  ["unit", "Unit"],
  ["episode", "Per episode"],
] as const;

type BillingUnit = (typeof billingUnits)[number][0];
type Scope = { type: "master" } | { type: "network"; network: string } | { type: "show"; showId: string } | { type: "episode"; episodeId: string };
type Rate = {
  id: string;
  category: string;
  unit: BillingUnit;
  rate: string | number;
  internalCostRate: string | number | null;
  currency: string;
  sourceScope: string;
};
type Room = { id: string; name: string; type: string; ownRate: Rate | null; inheritedRate: Rate | null };

function scopeParams(scope: Scope) {
  if (scope.type === "master") return new URLSearchParams({ scope: "master" });
  if (scope.type === "network") return new URLSearchParams({ scope: "network", network: scope.network });
  if (scope.type === "show") return new URLSearchParams({ scope: "show", show_id: scope.showId });
  return new URLSearchParams({ scope: "episode", episode_id: scope.episodeId });
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: string | number | null, currency: string) {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
}

function unitLabel(unit: string) {
  return billingUnits.find(([value]) => value === unit)?.[1] ?? titleCase(unit);
}

/** Room-specific prices stay attached to Settings rooms at every card scope. */
export function RoomRateCard({ scope }: { scope: Scope }) {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const params = scopeParams(scope).toString();
  const isMaster = scope.type === "master";

  const load = useCallback(async () => {
    setLoading(true);
    const response = await postpilotUiFetch(`/v1/rate-cards/room-rates?${params}`);
    const body = response.ok ? await response.json().catch(() => null) : null;
    setRooms(body?.rooms ?? []);
    setLoading(false);
  }, [params]);

  useEffect(() => { void load(); }, [load]);

  return <section className="overflow-hidden rounded-lg border border-[#ebeae6] bg-[#fefefa]">
    <div className="border-b border-[#ebeae6] px-5 py-4">
      <h3 className="text-sm font-semibold text-[#343b38]">Room prices</h3>
      <p className="mt-1 text-xs text-[#858a87]">{isMaster ? "Rooms come from Settings. Set the post house default for each room." : "Rooms come from Settings. They inherit their agreed rate until this card needs a room-specific exception."}</p>
    </div>
    <div className="divide-y divide-[#efeeea]">
      {rooms.map((room) => <RoomRateRow key={room.id} room={room} scope={scope} onChanged={async () => { await load(); router.refresh(); }} />)}
      {!loading && !rooms.length && <p className="px-5 py-5 text-xs text-[#858a87]">No rooms are configured in Settings.</p>}
      {loading && <p className="px-5 py-5 text-xs text-[#858a87]">Loading room prices…</p>}
    </div>
  </section>;
}

function RoomRateRow({ room, scope, onChanged }: { room: Room; scope: Scope; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const isMaster = scope.type === "master";
  const effective = room.ownRate ?? room.inheritedRate;

  async function remove() {
    if (!room.ownRate) return;
    setRemoving(true);
    setError("");
    const response = await postpilotUiFetch(`/v1/rate-cards/items/${room.ownRate.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.detail ?? body?.error ?? "Could not remove the room override.");
      setRemoving(false);
      return;
    }
    await onChanged();
  }

  return <div className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><Building2 size={14} className="text-[#668273]" /><p className="truncate text-sm font-semibold text-[#404844]">{room.name}</p><span className="service-rate-inactive">Room</span></div>
      <p className="mt-1.5 text-xs text-[#7d837f]">
        {room.type} · {room.ownRate ? <><b className="text-[#4f7767]">{isMaster ? "master" : "override"} {money(room.ownRate.rate, room.ownRate.currency)}</b>{room.inheritedRate ? ` · inherited ${money(room.inheritedRate.rate, room.inheritedRate.currency)}` : ""}</> : effective ? <>inherits <b className="text-[#586e65]">{money(effective.rate, effective.currency)}</b> from {titleCase(effective.sourceScope)}</> : isMaster ? "No master room price" : "No inherited room rate"} {effective ? ` / ${unitLabel(effective.unit)}` : ""}
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      {effective && <div className="mr-1 text-right text-xs"><p className="font-semibold text-[#3d4642]">{money(effective.rate, effective.currency)}</p><p className="mt-0.5 text-[#858a87]">Internal {money(effective.internalCostRate, effective.currency)}</p></div>}
      <Button size="sm" variant="tertiary" onPress={() => setOpen(true)} className="min-w-0 border border-[#dfe3df] bg-white text-[#58635e]"><Pencil size={13} /> {isMaster ? (room.ownRate ? "Edit master price" : "Set master price") : (room.ownRate ? "Edit override" : "Override")}</Button>
      {room.ownRate && <Button size="sm" variant="tertiary" onPress={remove} isDisabled={removing} className="min-w-0 border border-[#eeded8] bg-[#fffdfb] text-[#a35e41]"><Trash2 size={13} /> {removing ? "Removing…" : "Remove"}</Button>}
      {error && <p role="alert" className="basis-full text-right text-xs text-[#a35e41]">{error}</p>}
    </div>
    {open && <RoomRateDialog room={room} scope={scope} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await onChanged(); }} />}
  </div>;
}

function RoomRateDialog({ room, scope, onClose, onSaved }: { room: Room; scope: Scope; onClose: () => void; onSaved: () => Promise<void> }) {
  const existing = room.ownRate;
  const inherited = room.inheritedRate;
  const [unit, setUnit] = useState<BillingUnit>(existing?.unit ?? inherited?.unit ?? "hour");
  const [rate, setRate] = useState(existing ? String(existing.rate) : inherited ? String(inherited.rate) : "");
  const [internalCostRate, setInternalCostRate] = useState(existing?.internalCostRate == null ? (inherited?.internalCostRate == null ? "" : String(inherited.internalCostRate)) : String(existing.internalCostRate));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!rate || Number(rate) <= 0) return setError("Enter a client rate greater than zero.");
    if (internalCostRate && Number(internalCostRate) < 0) return setError("Internal cost cannot be negative.");
    setSaving(true);
    setError("");
    const response = await postpilotUiFetch("/v1/rate-cards/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: scope.type,
        network: scope.type === "network" ? scope.network : null,
        showId: scope.type === "show" ? scope.showId : null,
        episodeId: scope.type === "episode" ? scope.episodeId : null,
        targetType: "room",
        roomId: room.id,
        category: existing?.category ?? inherited?.category ?? (room.type || room.name),
        unit,
        rate: Number(rate),
        internalCostRate: internalCostRate ? Number(internalCostRate) : null,
      }),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setError(body?.detail ?? body?.error ?? "Could not save the room override.");
    await onSaved();
  }

  const isMaster = scope.type === "master";
  const actionTitle = isMaster ? (existing ? "Edit master room price" : "Set master room price") : (existing ? "Edit room override" : "Override room price");
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#202725]/30 p-4" role="dialog" aria-modal="true" aria-labelledby="room-rate-override-title">
    <div className="w-full max-w-md rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h3 id="room-rate-override-title" className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{actionTitle}</h3><p className="mt-1 text-sm text-[#767c78]">{room.name} stays linked to the room configured in Settings. {isMaster ? "This becomes the default price for every client, show, and episode until overridden." : "This change applies only at this scope and below."}</p></div><Button isIconOnly variant="tertiary" onPress={onClose} aria-label="Close room rate form" className="min-w-0 text-[#7d827e]"><X size={18} /></Button></div>
      <div className="mt-5 space-y-4">
        <div className="rounded-md border border-[#dce7df] bg-[#f2f8f3] px-3 py-2 text-xs text-[#486454]"><b>{room.name}</b><span className="ml-2 text-[#718078]">{room.type}</span></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-[#535b57]">Client rate<input value={rate} onChange={(event) => setRate(event.target.value)} type="number" min="0.01" step="0.01" className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-white px-3 text-sm" /></label><label className="text-xs font-medium text-[#535b57]">Billing unit<select value={unit} onChange={(event) => setUnit(event.target.value as BillingUnit)} className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-white px-2 text-sm">{billingUnits.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <label className="block text-xs font-medium text-[#535b57]">Internal cost rate <span className="font-normal text-[#858a87]">(optional)</span><input value={internalCostRate} onChange={(event) => setInternalCostRate(event.target.value)} type="number" min="0" step="0.01" className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-white px-3 text-sm" /></label>
        {error && <p role="alert" className="text-xs text-[#a35e41]">{error}</p>}
      </div>
      <div className="mt-6 flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button variant="tertiary" onPress={onClose}>Cancel</Button><Button variant="primary" onPress={save} isDisabled={saving} className="bg-[#263130] text-white">{saving ? "Saving…" : isMaster ? "Save master room price" : "Save room override"}</Button></div>
    </div>
  </div>;
}
