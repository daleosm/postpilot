"use client";

import { Button } from "@heroui/react";
import { Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { postpilotApiFetch } from "@/lib/postpilot-api-client";

type ResourceOptions = {
  services: Array<{ id: string; name: string; category: string; unit: string }>;
  rooms: Array<{ id: string; name: string; type: string }>;
  people: Array<{ id: string; name: string; role: string }>;
  vendors: Array<{ id: string; name: string }>;
};
type Preview = { category: string; quantity: number; unit: string; rate: number; estimate: number; rate_source: string; currency: string; resource_reference: string };
type ItemType = "service" | "room" | "person" | "vendor" | "fixed";
type Row = { id: string; department: string; type: ItemType; resourceId: string; category: string; description: string; quantity: string; unit: string; manualRate: string; overrideReason: string; preview?: Preview; error?: string };

const departments = ["Editorial", "Colour", "Sound", "VFX", "QC", "Delivery", "Catering"];
const units = ["hour", "day", "episode", "fixed", "unit"];
const newRow = (): Row => ({ id: crypto.randomUUID(), department: "Editorial", type: "service", resourceId: "", category: "", description: "", quantity: "1", unit: "day", manualRate: "", overrideReason: "" });

export function EstimateBuilder({ episode, resources }: { episode: { id: string; label: string }; resources: ResourceOptions }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const grouped = useMemo(() => departments.map((department) => ({ department, rows: rows.filter((row) => row.department === department && row.preview) })), [rows]);
  const total = grouped.reduce((sum, group) => sum + group.rows.reduce((subtotal, row) => subtotal + (row.preview?.estimate ?? 0), 0), 0);

  const update = (id: string, patch: Partial<Row>) => setRows((current) => current.map((row) => {
    if (row.id !== id) return row;
    // Input edits invalidate a previously resolved rate, but resolution and
    // error handlers must be allowed to retain the values they just wrote.
    const clearsPreview = !Object.prototype.hasOwnProperty.call(patch, "preview");
    const clearsError = !Object.prototype.hasOwnProperty.call(patch, "error");
    return { ...row, ...patch, ...(clearsPreview ? { preview: undefined } : {}), ...(clearsError ? { error: undefined } : {}) };
  }));
  const resolve = async (row: Row) => {
    try {
      const isResource = ["service", "room", "person"].includes(row.type);
      const preview = await postpilotApiFetch<Preview>("/budget/estimate-preview", {
        method: "POST",
        body: {
          episode_id: episode.id,
          category: row.category || "Planned cost",
          planned_quantity: Number(row.quantity),
          planned_unit: row.unit,
          rate_resource_type: isResource ? row.type : undefined,
          rate_resource_id: isResource ? row.resourceId : undefined,
          manual_rate_override: isResource && row.manualRate ? Number(row.manualRate) : !isResource ? Number(row.manualRate) : undefined,
          manual_override_reason: row.overrideReason || undefined,
          vendor_company_id: row.type === "vendor" ? row.resourceId : undefined,
        },
      });
      update(row.id, { preview });
    } catch (error) {
      update(row.id, { error: error instanceof Error ? error.message : "Unable to resolve this rate." });
    }
  };
  const resolveAll = async () => { for (const row of rows) await resolve(row); };
  const save = async () => {
    setSaving(true);
    try {
      const resolved = await Promise.all(rows.map(async (row) => {
        let preview = row.preview;
        if (!preview) {
          const isResource = ["service", "room", "person"].includes(row.type);
          preview = await postpilotApiFetch<Preview>("/budget/estimate-preview", { method: "POST", body: { episode_id: episode.id, category: row.category || "Planned cost", planned_quantity: Number(row.quantity), planned_unit: row.unit, rate_resource_type: isResource ? row.type : undefined, rate_resource_id: isResource ? row.resourceId : undefined, manual_rate_override: isResource && row.manualRate ? Number(row.manualRate) : !isResource ? Number(row.manualRate) : undefined, manual_override_reason: row.overrideReason || undefined, vendor_company_id: row.type === "vendor" ? row.resourceId : undefined } });
        }
        return { row, preview };
      }));
      await Promise.all(resolved.map(({ row, preview }) => postpilotApiFetch("/budget/lines", { method: "POST", body: { episode_id: episode.id, category: preview.category, description: row.description || null, external_cost: row.type === "vendor", budgeted_amount: preview.estimate, planned_quantity: preview.quantity, planned_unit: preview.unit, rate_resource_type: ["service", "room", "person"].includes(row.type) ? row.type : undefined, rate_resource_id: ["service", "room", "person"].includes(row.type) ? row.resourceId : undefined, manual_rate_override: !["service", "room", "person"].includes(row.type) || row.manualRate ? preview.rate : undefined, manual_override_reason: row.overrideReason || undefined, vendor_company_id: row.type === "vendor" ? row.resourceId : undefined } })));
      setOpen(false); setRows([newRow()]); router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save this estimate.";
      setRows((current) => current.map((row, index) => index === 0 ? { ...row, error: message } : row));
    } finally { setSaving(false); }
  };

  return <>
    <Button variant="primary" onPress={() => setOpen(true)} className="bg-[#263130] text-white"><Plus size={16} /> Build estimate</Button>
    {open && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5">
      <section role="dialog" aria-modal="true" aria-label="Build episode estimate" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-[#fefefa] shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between border-b border-[#e8e9e5] px-5 py-4 sm:px-7"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#708078]">Episode estimate</p><h2 className="mt-1 text-xl font-semibold tracking-[-.035em] text-[#28312e]">Build estimate</h2><p className="mt-1 text-sm text-[#737a76]">{episode.label} · rates are resolved and snapshotted by the server.</p></div><Button isIconOnly variant="tertiary" aria-label="Close" onPress={() => setOpen(false)}><X size={18} /></Button></header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="hidden grid-cols-[130px_118px_minmax(180px,1fr)_100px_90px_120px_105px_40px] gap-2 border-b border-[#e9eae6] pb-2 text-[10px] font-semibold uppercase tracking-[.09em] text-[#858b87] lg:grid"><span>Department</span><span>Item type</span><span>Resource / category</span><span>Quantity</span><span>Unit</span><span>Rate source</span><span>Estimate</span><span /></div>
          <div className="space-y-3 pt-3">{rows.map((row) => <EstimateRow key={row.id} row={row} resources={resources} onChange={(patch) => update(row.id, patch)} onResolve={() => resolve(row)} onRemove={() => setRows((items) => items.length === 1 ? items : items.filter((item) => item.id !== row.id))} />)}</div>
          <Button variant="tertiary" className="mt-4 border border-dashed border-[#cfd5d0]" onPress={() => setRows((items) => [...items, newRow()])}><Plus size={15} /> Add estimate item</Button>
          <div className="mt-6 grid gap-3 md:grid-cols-3">{grouped.filter((group) => group.rows.length).map((group) => <div key={group.department} className="rounded-xl border border-[#e6e7e3] bg-[#fafaf8] px-4 py-3"><p className="text-xs font-semibold text-[#53615b]">{group.department}</p><p className="mt-1 text-lg font-semibold text-[#27312d]">{formatMoney(group.rows.reduce((sum, row) => sum + (row.preview?.estimate ?? 0), 0), group.rows[0]?.preview?.currency)}</p><p className="text-xs text-[#858a87]">{group.rows.length} resolved item{group.rows.length === 1 ? "" : "s"}</p></div>)}</div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8e9e5] bg-[#fafaf8] px-5 py-4 sm:px-7"><p className="text-sm font-medium text-[#53615b]">Resolved estimate total <span className="ml-2 text-lg font-semibold text-[#28312e]">{formatMoney(total, rows.find((row) => row.preview)?.preview?.currency)}</span></p><div className="flex gap-2"><Button variant="tertiary" onPress={resolveAll} isDisabled={saving}>Resolve rates</Button><Button variant="tertiary" onPress={() => setOpen(false)}>Cancel</Button><Button variant="primary" className="bg-[#263130] text-white" onPress={save} isDisabled={saving}>{saving ? "Saving…" : "Save estimate"}</Button></div></footer>
      </section>
    </div>}
  </>;
}

function EstimateRow({ row, resources, onChange, onResolve, onRemove }: { row: Row; resources: ResourceOptions; onChange: (patch: Partial<Row>) => void; onResolve: () => void; onRemove: () => void }) {
  const choose = (value: string) => { const [type, id] = value.split(":"); if (type === "service") { const service = resources.services.find((item) => item.id === id); onChange({ type: "service", resourceId: id, category: service?.category ?? "", unit: service?.unit ?? "day" }); } else onChange({ resourceId: id }); };
  const needsManualRate = row.type === "vendor" || row.type === "fixed";
  return <div className="grid gap-2 rounded-xl border border-[#e4e6e2] bg-white p-3 lg:grid-cols-[130px_118px_minmax(180px,1fr)_100px_90px_120px_105px_40px] lg:items-center lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-0"><select aria-label="Estimate department" value={row.department} onChange={(event) => onChange({ department: event.target.value })} className="control text-xs">{departments.map((department) => <option key={department}>{department}</option>)}</select><select aria-label="Estimate item type" value={row.type} onChange={(event) => onChange({ type: event.target.value as ItemType, resourceId: "", preview: undefined })} className="control text-xs"><option value="service">Service</option><option value="room">Room</option><option value="person">Person</option><option value="vendor">External vendor</option><option value="fixed">Fixed cost</option></select><div className="min-w-0">{row.type === "service" ? <select aria-label="Estimate service" value={row.resourceId} onChange={(event) => choose(`service:${event.target.value}`)} className="control text-xs"><option value="">Choose service</option>{resources.services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : row.type === "room" ? <><select aria-label="Estimate room" value={row.resourceId} onChange={(event) => choose(`room:${event.target.value}`)} className="control text-xs"><option value="">Choose room</option>{resources.rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="Estimate rate category" value={row.category} onChange={(event) => onChange({ category: event.target.value })} placeholder="Rate category" className="control mt-2 text-xs" /></> : row.type === "person" ? <><select aria-label="Estimate person" value={row.resourceId} onChange={(event) => choose(`person:${event.target.value}`)} className="control text-xs"><option value="">Choose person</option>{resources.people.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="Estimate rate category" value={row.category} onChange={(event) => onChange({ category: event.target.value })} placeholder="Rate category" className="control mt-2 text-xs" /></> : row.type === "vendor" ? <><select aria-label="Estimate vendor" value={row.resourceId} onChange={(event) => choose(`vendor:${event.target.value}`)} className="control text-xs"><option value="">Choose vendor</option>{resources.vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="Estimate cost category" value={row.category} onChange={(event) => onChange({ category: event.target.value })} placeholder="Cost category" className="control mt-2 text-xs" /></> : <input aria-label="Estimate fixed-cost category" value={row.category} onChange={(event) => onChange({ category: event.target.value })} placeholder="Fixed-cost category" className="control text-xs" />}</div><input aria-label="Estimate quantity" type="number" min="0.01" step="0.01" value={row.quantity} onChange={(event) => onChange({ quantity: event.target.value })} className="control text-xs" /><select aria-label="Estimate billing unit" value={row.unit} onChange={(event) => onChange({ unit: event.target.value })} className="control text-xs">{units.map((unit) => <option key={unit}>{unit}</option>)}</select><div className="text-xs">{needsManualRate || row.manualRate ? <><input aria-label="Estimate manual rate" type="number" min="0" step="0.01" value={row.manualRate} onChange={(event) => onChange({ manualRate: event.target.value })} placeholder="Rate" className="control text-xs" /><input aria-label="Estimate override reason" value={row.overrideReason} onChange={(event) => onChange({ overrideReason: event.target.value })} placeholder={needsManualRate ? "Quote/source (optional)" : "Override reason"} className="control mt-2 text-xs" /></> : <button type="button" onClick={onResolve} className="text-left font-medium text-[#4c7568] hover:underline">{row.preview ? sourceLabel(row.preview.rate_source) : "Resolve rate"}</button>}</div><div className="text-sm font-semibold text-[#303a36]">{row.preview ? <>{formatMoney(row.preview.estimate, row.preview.currency)}<p className="mt-1 text-[10px] font-normal text-[#858a87]">{row.preview.quantity} × {formatMoney(row.preview.rate, row.preview.currency)}</p></> : "—"}</div><Button isIconOnly variant="tertiary" aria-label="Remove estimate item" onPress={onRemove}><Trash2 size={16} /></Button>{row.error && <p className="lg:col-span-8 text-xs text-[#ad5e43]">{row.error}</p>}<input aria-label="Estimate operational note" value={row.description} onChange={(event) => onChange({ description: event.target.value })} placeholder="Optional operational note" className="control lg:col-span-3 text-xs" /></div>;
}

function sourceLabel(source: string) { return source.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatMoney(value: number, currency = "USD") { try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
