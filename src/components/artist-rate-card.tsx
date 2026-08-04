"use client";

import { Button } from "@heroui/react";
import { Pencil, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

type Scope =
  | { type: "master" }
  | { type: "network"; network: string }
  | { type: "show"; showId: string }
  | { type: "episode"; episodeId: string };

type Person = { id: string; name: string; role: string };
type ArtistRate = {
  id: string;
  person: Person;
  category: string;
  unit: string;
  clientRate: string | number;
  internalCostRate: string | number | null;
  currency: string;
};

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

/** Explicit named-artist prices override the selected person's role rate. */
export function ArtistRateCard({ scope }: { scope: Scope }) {
  const router = useRouter();
  const [rates, setRates] = useState<ArtistRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const scopeKey = scopeParams(scope).toString();

  const load = useCallback(async () => {
    setLoading(true);
    const response = await postpilotUiFetch(`/v1/rate-cards/artist-rates?${scopeKey}`);
    const body = response.ok ? await response.json().catch(() => null) : null;
    setRates(body?.artistRates ?? []);
    setLoading(false);
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    async function fetchArtistRates() {
      const response = await postpilotUiFetch(`/v1/rate-cards/artist-rates?${scopeKey}`);
      const body = response.ok ? await response.json().catch(() => null) : null;
      if (cancelled) return;
      setRates(body?.artistRates ?? []);
      setLoading(false);
    }
    void fetchArtistRates();
    return () => { cancelled = true; };
  }, [scopeKey]);

  return <section className="overflow-hidden rounded-lg border border-[#ebeae6] bg-[#fefefa]">
    <div className="flex flex-col justify-between gap-3 border-b border-[#ebeae6] px-5 py-4 sm:flex-row sm:items-center">
      <div>
        <h3 className="text-sm font-semibold text-[#343b38]">Named artist rates</h3>
        <p className="mt-1 text-xs text-[#858a87]">Add only agreed personal exceptions. Everyone else is priced from their configured post-house role.</p>
      </div>
      <Button size="sm" variant="secondary" onPress={() => setOpen(true)} className="border border-[#dfe3df] bg-white text-[#52635d]">
        <Plus size={14} /> Add artist rate
      </Button>
    </div>
    <div className="divide-y divide-[#efeeea]">
      {rates.map((rate) => <ArtistRateRow key={rate.id} rate={rate} scope={scope} onChanged={async () => { await load(); router.refresh(); }} />)}
      {!loading && !rates.length && <p className="px-5 py-5 text-xs text-[#858a87]">No named artist rates on this card.</p>}
      {loading && <p className="px-5 py-5 text-xs text-[#858a87]">Loading artist rates…</p>}
    </div>
    {open && <ArtistRateDialog scope={scope} existingPeople={rates.map((rate) => rate.person.id)} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await load(); router.refresh(); }} />}
  </section>;
}

function ArtistRateRow({ rate, scope, onChanged }: { rate: ArtistRate; scope: Scope; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setRemoving(true);
    setError("");
    const response = await postpilotUiFetch(`/v1/rate-cards/items/${rate.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Could not remove the artist rate.");
      setRemoving(false);
      return;
    }
    await onChanged();
  }

  return <div className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><UserRound size={14} className="text-[#668273]" /><p className="truncate text-sm font-semibold text-[#404844]">{rate.person.name}</p></div>
      <p className="mt-1.5 text-xs text-[#7d837f]">{titleCase(rate.person.role)} · {rate.unit === "fixed" ? "Fixed service" : `per ${rate.unit}`}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      <div className="mr-1 text-right text-xs"><p className="font-semibold text-[#3d4642]">{money(rate.clientRate, rate.currency)}</p><p className="mt-0.5 text-[#858a87]">Internal {money(rate.internalCostRate, rate.currency)}</p></div>
      <Button size="sm" variant="tertiary" onPress={() => setOpen(true)} className="min-w-0 border border-[#dfe3df] bg-white text-[#58635e]"><Pencil size={13} /> Edit</Button>
      <Button size="sm" variant="tertiary" onPress={remove} isDisabled={removing} className="min-w-0 border border-[#eeded8] bg-[#fffdfb] text-[#a35e41]"><Trash2 size={13} /> {removing ? "Removing…" : "Remove"}</Button>
      {error && <p role="alert" className="basis-full text-right text-xs text-[#a35e41]">{error}</p>}
      {open && <ArtistRateDialog scope={scope} initialRate={rate} existingPeople={[]} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await onChanged(); }} />}
    </div>
  </div>;
}

function ArtistRateDialog({ scope, initialRate, existingPeople, onClose, onSaved }: { scope: Scope; initialRate?: ArtistRate; existingPeople: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [search, setSearch] = useState(initialRate?.person.name ?? "");
  const [matches, setMatches] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(initialRate?.person ?? null);
  const [unit, setUnit] = useState(initialRate?.unit ?? "hour");
  const [clientRate, setClientRate] = useState(initialRate ? String(initialRate.clientRate) : "");
  const [internalCostRate, setInternalCostRate] = useState(initialRate?.internalCostRate == null ? "" : String(initialRate.internalCostRate));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = Boolean(initialRate);

  useEffect(() => {
    if (editing || search.trim().length < 2) return;
    let cancelled = false;
    postpilotUiFetch(`/v1/rate-cards/artists?query=${encodeURIComponent(search.trim())}`)
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (!cancelled) setMatches((body?.people ?? []).filter((person: Person) => !existingPeople.includes(person.id))); })
      .catch(() => { if (!cancelled) setMatches([]); });
    return () => { cancelled = true; };
  }, [editing, existingPeople, search]);

  const visibleMatches = useMemo(
    () => (editing || search.trim().length < 2 ? [] : matches.slice(0, 8)),
    [editing, matches, search],
  );

  async function save() {
    if (!selected) return setError("Search for and select an artist.");
    if (!clientRate || Number(clientRate) <= 0) return setError("Enter a client rate greater than zero.");
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
        targetType: "person",
        personId: selected.id,
        category: initialRate?.category ?? titleCase(selected.role),
        unit,
        rate: Number(clientRate),
        internalCostRate: internalCostRate ? Number(internalCostRate) : null,
      }),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setError(body?.error ?? "Could not save the artist rate.");
    await onSaved();
  }

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#202725]/30 p-4" role="dialog" aria-modal="true" aria-labelledby="artist-rate-title">
    <div className="w-full max-w-md rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h3 id="artist-rate-title" className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{editing ? "Edit artist rate" : "Add artist rate"}</h3><p className="mt-1 text-sm text-[#767c78]">This overrides the artist’s configured role rate at this scope only.</p></div><Button isIconOnly variant="tertiary" onPress={onClose} aria-label="Close artist rate form" className="min-w-0 text-[#7d827e]"><X size={18} /></Button></div>
      <div className="mt-5 space-y-4">
        <label className="block text-xs font-medium text-[#535b57]">Artist<div className="relative mt-1.5"><Search size={14} className="absolute left-3 top-3 text-[#8b918d]" /><input value={search} disabled={editing} onChange={(event) => { setSearch(event.target.value); setSelected(null); }} placeholder="Search people by name or role" className="h-10 w-full rounded-md border border-[#dedfda] bg-white py-2 pl-9 pr-3 text-sm disabled:bg-[#f3f3ef]" /></div></label>
        {!editing && search.trim().length >= 2 && <div className="max-h-40 overflow-y-auto rounded-md border border-[#dedfda] bg-white">{visibleMatches.map((person) => <button key={person.id} type="button" onClick={() => { setSelected(person); setSearch(person.name); setMatches([]); }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs hover:bg-[#f3f6f3]"><span className="font-medium text-[#47514c]">{person.name}</span><span className="shrink-0 text-[#858d88]">{titleCase(person.role)}</span></button>)}{!visibleMatches.length && <p className="px-3 py-2.5 text-xs text-[#858d88]">No eligible people found.</p>}</div>}
        {selected && <div className="rounded-md border border-[#dce7df] bg-[#f2f8f3] px-3 py-2 text-xs text-[#486454]"><b>{selected.name}</b><span className="ml-2 text-[#718078]">{titleCase(selected.role)}</span></div>}
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-[#535b57]">Billing unit<select value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-white px-2 text-sm"><option value="hour">Hour</option><option value="episode">Episode</option><option value="fixed">Fixed service</option></select></label><label className="text-xs font-medium text-[#535b57]">Client rate<input value={clientRate} onChange={(event) => setClientRate(event.target.value)} type="number" min="0.01" step="0.01" className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-white px-3 text-sm" /></label></div>
        <label className="block text-xs font-medium text-[#535b57]">Internal cost rate <span className="font-normal text-[#858a87]">(optional)</span><input value={internalCostRate} onChange={(event) => setInternalCostRate(event.target.value)} type="number" min="0" step="0.01" className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-white px-3 text-sm" /></label>
        {error && <p role="alert" className="text-xs text-[#a35e41]">{error}</p>}
      </div>
      <div className="mt-6 flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button variant="tertiary" onPress={onClose}>Cancel</Button><Button variant="primary" onPress={save} isDisabled={saving} className="bg-[#263130] text-white">{saving ? "Saving…" : editing ? "Save artist rate" : "Add artist rate"}</Button></div>
    </div>
  </div>;
}
