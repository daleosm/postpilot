"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@heroui/react";
import { AlertTriangle, Pencil, Plus, ReceiptText, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

const schema = z.object({
  name: z.string().trim().min(1, "Service name is required.").max(120),
  category: z.string().trim().min(1, "Category is required.").max(120),
  artistRole: z.string(),
  unit: z.enum(["hour", "episode", "fixed"]),
  rate: z.coerce.number().positive("Rate must be greater than zero."),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean(),
});

type Values = z.infer<typeof schema>;
type Input = z.input<typeof schema>;
type MasterPrice = { rate: string | number; currency: string };
type MasterRoom = {
  id: string;
  name: string;
  type: string;
  rate: {
    id: string;
    category: string;
    unit: "hour" | "episode" | "fixed";
    rate: string | number;
    internal_cost_rate: string | number | null;
    currency: string;
  } | null;
};

export type ServiceRate = {
  id: string;
  name: string;
  category: string;
  artistRole: string | null;
  unit: string;
  rate: string | number;
  currency: string;
  notes: string | null;
  isActive: boolean;
};

type MasterServiceRate = ServiceRate & { masterRate?: string | number };

export function ServiceRateCard({ rates, embedded = false }: { rates: ServiceRate[]; embedded?: boolean }) {
  const [masterPrices, setMasterPrices] = useState<Record<string, MasterPrice>>({});
  const [rooms, setRooms] = useState<MasterRoom[]>([]);

  useEffect(() => {
    let cancelled = false;
    postpilotUiFetch("/v1/rate-cards/overrides?scope=master")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled) setMasterPrices(body?.overrides ?? {});
      })
      .catch(() => {
        if (!cancelled) setMasterPrices({});
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    postpilotUiFetch("/v1/rate-cards/master-rooms")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled) setRooms(body?.rooms ?? []); })
      .catch(() => { if (!cancelled) setRooms([]); });
    return () => { cancelled = true; };
  }, []);

  const masterRates = rates.map((rate) => ({
    ...rate,
    masterRate: masterPrices[rate.category + ":" + rate.unit]?.rate,
  }));

  return <section className={(embedded ? "rounded-lg border border-[#ebeae6]" : "panel") + " overflow-hidden"}>
    <div className="flex flex-col justify-between gap-3 border-b border-[#ebeae6] px-5 py-4 sm:flex-row sm:items-center">
      <div>
        <h2 className="text-sm font-semibold text-[#343b38]">Master rate card</h2>
        <p className="mt-1 text-xs text-[#858a87]">Your post house’s standard room, artist, and service rates. Network, show, and episode cards inherit these prices until overridden.</p>
      </div>
      <div className="flex flex-wrap gap-2"><RoomRateDialog rooms={rooms} /><RateDialog /></div>
    </div>
    <div className="divide-y divide-[#efeeea]">
      {masterRates.map((rate) => <RateRow key={rate.id} rate={rate} />)}
      {rooms.filter((room) => room.rate).map((room) => <RoomRateRow key={room.id} room={room} rooms={rooms} />)}
      {!rates.length && <div className="px-5 py-12 text-center">
        <ReceiptText className="mx-auto text-[#a1a7a3]" size={22} />
        <p className="mt-3 text-sm font-medium text-[#59615d]">No master rates yet</p>
        <p className="mt-1 text-xs text-[#858a87]">Add standard post services to build a consistent estimating baseline.</p>
      </div>}
    </div>
  </section>;
}

function RateRow({ rate }: { rate: MasterServiceRate }) {
  const displayedRate = rate.masterRate ?? rate.rate;
  return <div className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="truncate text-sm font-semibold text-[#404844]">{rate.name}</p>
        {!rate.isActive && <span className="service-rate-inactive">Inactive</span>}
      </div>
      <p className="mt-1.5 text-xs text-[#7d837f]">{rate.artistRole ? `Artist role · ${titleCase(rate.artistRole)}` : rate.category}{rate.notes ? " · " + rate.notes : ""}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      <p className="mr-1 text-sm font-semibold text-[#3d4642]">{formatMoney(displayedRate, rate.currency)} <span className="text-xs font-normal text-[#7d837f]">/ {rate.unit}</span></p>
      <RateDialog rate={rate} />
      <RemoveRateButton rate={rate} />
    </div>
  </div>;
}

function RoomRateRow({ room, rooms }: { room: MasterRoom; rooms: MasterRoom[] }) {
  if (!room.rate) return null;
  return <div className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-[#404844]">{room.name}</p><span className="service-rate-inactive">Room</span></div>
      <p className="mt-1.5 text-xs text-[#7d837f]">{room.type} · selected from Settings → Rooms</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      <p className="mr-1 text-sm font-semibold text-[#3d4642]">{formatMoney(room.rate.rate, room.rate.currency)} <span className="text-xs font-normal text-[#7d837f]">/ {room.rate.unit}</span></p>
      <RoomRateDialog room={room} rooms={rooms} />
      <RemoveRoomRateButton room={room} />
    </div>
  </div>;
}

function RoomRateDialog({ room, rooms }: { room?: MasterRoom; rooms: MasterRoom[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState(room?.id ?? "");
  const [unit, setUnit] = useState<"hour" | "episode" | "fixed">(room?.rate?.unit ?? "hour");
  const [rate, setRate] = useState(room?.rate ? String(room.rate.rate) : "");
  const [internalCostRate, setInternalCostRate] = useState(room?.rate?.internal_cost_rate == null ? "" : String(room.rate.internal_cost_rate));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedRoom = rooms.find((candidate) => candidate.id === roomId);

  function close() {
    setOpen(false);
    setRoomId(room?.id ?? "");
    setUnit(room?.rate?.unit ?? "hour");
    setRate(room?.rate ? String(room.rate.rate) : "");
    setInternalCostRate(room?.rate?.internal_cost_rate == null ? "" : String(room.rate.internal_cost_rate));
    setError("");
  }

  async function save() {
    if (!selectedRoom) return setError("Choose a room from Settings.");
    if (!rate || Number(rate) <= 0) return setError("Enter a client rate greater than zero.");
    if (internalCostRate && Number(internalCostRate) < 0) return setError("Internal cost cannot be negative.");
    setSaving(true);
    setError("");
    const response = await postpilotUiFetch("/v1/rate-cards/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "master",
        targetType: "room",
        roomId: selectedRoom.id,
        category: selectedRoom.type || selectedRoom.name,
        unit,
        rate: Number(rate),
        internalCostRate: internalCostRate ? Number(internalCostRate) : null,
      }),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return setError(body?.detail ?? body?.error ?? "Could not save this room rate.");
    close();
    router.refresh();
  }

  return <>
    <Button variant={room ? "tertiary" : "primary"} onPress={() => setOpen(true)} className={room ? "min-w-0 border border-[#dfe3df] bg-white text-[#58635e]" : "bg-[#263130] text-white"}>
      {room ? <><Pencil size={14} /> Edit</> : <><Plus size={16} /> Add room rate</>}
    </Button>
    {open && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#202725]/25 p-4" role="dialog" aria-modal="true" aria-labelledby="room-rate-title">
      <div className="w-full max-w-md rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h2 id="room-rate-title" className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{room ? "Edit room rate" : "Add room rate"}</h2><p className="mt-1 text-sm text-[#767c78]">Choose a room from Settings. Its saved ID is used when bookings resolve the price.</p></div><Button isIconOnly variant="tertiary" onPress={close} aria-label="Close room rate form" className="min-w-0 text-[#7d827e]"><X size={18} /></Button></div>
        <div className="mt-5 space-y-4">
          <Field label="Room"><select value={roomId} disabled={Boolean(room)} onChange={(event) => setRoomId(event.target.value)}><option value="">Choose a configured room</option>{rooms.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.type}</option>)}</select></Field>
          {selectedRoom && <p className="rounded-md border border-[#dce7df] bg-[#f2f8f3] px-3 py-2 text-xs text-[#486454]">{selectedRoom.name} is managed in Settings → Rooms.</p>}
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Client rate"><input value={rate} onChange={(event) => setRate(event.target.value)} type="number" min="0.01" step="0.01" /></Field><Field label="Per"><select value={unit} onChange={(event) => setUnit(event.target.value as "hour" | "episode" | "fixed")}><option value="hour">Hour</option><option value="episode">Episode</option><option value="fixed">Fixed service</option></select></Field></div>
          <Field label="Internal cost rate (optional)"><input value={internalCostRate} onChange={(event) => setInternalCostRate(event.target.value)} type="number" min="0" step="0.01" /></Field>
          {error && <p role="alert" className="text-xs text-[#a35e41]">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button variant="tertiary" onPress={close}>Cancel</Button><Button variant="primary" onPress={save} isDisabled={saving} className="bg-[#263130] text-white">{saving ? "Saving…" : room ? "Save room rate" : "Add room rate"}</Button></div>
      </div>
    </div>}
  </>;
}

function RemoveRoomRateButton({ room }: { room: MasterRoom }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  if (!room.rate) return null;
  const rateId = room.rate.id;
  async function remove() {
    setRemoving(true);
    setError("");
    const response = await postpilotUiFetch("/v1/rate-cards/items/" + rateId, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.detail ?? body?.error ?? "Could not remove this room rate.");
      setRemoving(false);
      return;
    }
    router.refresh();
  }
  return <div className="relative"><Button variant="tertiary" onPress={remove} isDisabled={removing} className="min-w-0 border border-[#eeded8] bg-[#fffdfb] text-[#a35e41]"><Trash2 size={14} /> {removing ? "Removing…" : "Remove"}</Button>{error && <p role="alert" className="absolute right-0 top-full z-10 mt-1 w-48 text-right text-[11px] text-[#a35e41]">{error}</p>}</div>;
}

function RateDialog({ rate }: { rate?: MasterServiceRate }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [roles, setRoles] = useState<Array<{ role: string; label: string }>>([]);
  const form = useForm<Input, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults(rate),
  });

  function close() {
    setOpen(false);
    setError("");
    form.reset(defaults(rate));
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    postpilotUiFetch("/v1/rate-cards/artist-roles")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled) setRoles(body?.roles ?? []); })
      .catch(() => { if (!cancelled) setRoles([]); });
    return () => { cancelled = true; };
  }, [open]);

  async function submit(values: Values) {
    setError("");
    const serviceResponse = await postpilotUiFetch(
      rate ? "/v1/rate-cards/services/" + rate.id : "/v1/rate-cards/services",
      {
        method: rate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, artistRole: values.artistRole || null, notes: values.notes || null }),
      },
    );
    const service = await serviceResponse.json().catch(() => null);
    if (!serviceResponse.ok) return setError(service?.error ?? "Could not save this master rate.");

    const masterResponse = await postpilotUiFetch("/v1/rate-cards/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "master", serviceRateId: service.id, rate: values.rate }),
    });
    const masterBody = await masterResponse.json().catch(() => null);
    if (!masterResponse.ok) return setError(masterBody?.error ?? "The service was saved, but its master price could not be set.");
    close();
    router.refresh();
  }

  return <>
    <Button variant={rate ? "tertiary" : "primary"} onPress={() => setOpen(true)} className={rate ? "min-w-0 border border-[#dfe3df] bg-white text-[#58635e]" : "bg-[#263130] text-white"}>
      {rate ? <><Pencil size={14} /> Edit</> : <><Plus size={16} /> Add service rate</>}
    </Button>
    {open && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#202725]/25 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{rate ? "Edit master rate" : "Add master rate"}</h2>
            <p className="mt-1 text-sm text-[#767c78]">The post house currency is set in Settings. This price becomes the inherited default.</p>
          </div>
          <Button isIconOnly variant="tertiary" onPress={close} aria-label="Close" className="min-w-0 text-[#7d827e]"><X size={18} /></Button>
        </div>
        <form className="mt-6 space-y-4" onSubmit={form.handleSubmit(submit)}>
          <Field label="Service" error={form.formState.errors.name?.message}><input {...form.register("name")} placeholder="Senior editor" /></Field>
          <Field label="Applies to"><select {...form.register("artistRole", { onChange: (event) => { const match = roles.find((role) => role.role === event.target.value); if (match && !rate) { form.setValue("name", match.label); form.setValue("category", match.label); } } })}><option value="">Generic service</option>{roles.map((role) => <option key={role.role} value={role.role}>{role.label}</option>)}</select></Field>
          <Field label="Budget category" error={form.formState.errors.category?.message}><input {...form.register("category")} placeholder="Editorial artists" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Master rate" error={form.formState.errors.rate?.message}><input type="number" min="0" step="0.01" {...form.register("rate")} /></Field>
            <Field label="Per" error={form.formState.errors.unit?.message}>
              <select {...form.register("unit")}><option value="hour">Hour</option><option value="episode">Episode</option><option value="fixed">Fixed service</option></select>
            </Field>
          </div>
          <Field label="Notes" error={form.formState.errors.notes?.message}><textarea rows={2} {...form.register("notes")} placeholder="Overtime, equipment, or terms…" /></Field>
          <label className="flex items-center gap-2 text-xs text-[#535b57]"><input type="checkbox" {...form.register("isActive")} /> Available for new estimates</label>
          {error && <p role="alert" className="text-xs text-[#a35e41]">{error}</p>}
          <div className="mt-6 flex justify-end gap-2 border-t border-[#ecebe7] pt-4">
            <Button type="button" variant="tertiary" onPress={close}>Cancel</Button>
            <Button type="submit" variant="primary" isDisabled={form.formState.isSubmitting} className="bg-[#263130] text-white">{form.formState.isSubmitting ? "Saving…" : "Save master rate"}</Button>
          </div>
        </form>
      </div>
    </div>}
  </>;
}

function RemoveRateButton({ rate }: { rate: ServiceRate }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    setError("");
    const response = await postpilotUiFetch("/v1/rate-cards/services/" + rate.id, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Could not remove this master rate.");
      setRemoving(false);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const titleId = "remove-service-" + rate.id;
  return <>
    <Button variant="tertiary" onPress={() => setOpen(true)} className="min-w-0 border border-[#eeded8] bg-[#fffdfb] text-[#a35e41]" aria-label={"Remove " + rate.name}><Trash2 size={14} /> Remove</Button>
    {open && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#202725]/30 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="w-full max-w-md rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl">
        <div className="flex gap-3">
          <div className="rounded-full bg-[#fff0eb] p-2 text-[#a35e41]"><AlertTriangle size={18} /></div>
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">Remove {rate.name}?</h2>
            <p className="mt-1 text-sm text-[#767c78]">This removes the service and its live rate-card prices across the post house. Existing approved estimates keep their saved rate snapshots.</p>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 text-xs text-[#a35e41]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="tertiary" onPress={() => setOpen(false)} isDisabled={removing}>Cancel</Button>
          <Button variant="primary" onPress={remove} isDisabled={removing} className="bg-[#a34e36] text-white">{removing ? "Removing…" : "Remove master rate"}</Button>
        </div>
      </div>
    </div>}
  </>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[#535b57]">
    {label}
    <span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-[#dedfda] [&_input]:px-3 [&_input]:text-sm [&_select]:h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-[#dedfda] [&_select]:bg-white [&_select]:px-2 [&_select]:text-sm [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-[#dedfda] [&_textarea]:p-3 [&_textarea]:text-sm">{children}</span>
    {error && <span className="mt-1 block text-[11px] font-normal text-[#a35e41]">{error}</span>}
  </label>;
}

function defaults(rate?: MasterServiceRate): Input {
  return {
    name: rate?.name ?? "",
    category: rate?.category ?? "",
    artistRole: rate?.artistRole ?? "",
    unit: (rate?.unit as Input["unit"]) ?? "hour",
    rate: rate ? Number(rate.masterRate ?? rate.rate) : 0,
    notes: rate?.notes ?? "",
    isActive: rate?.isActive ?? true,
  };
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoney(value: string | number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value));
  } catch {
    return currency + " " + Number(value).toFixed(2);
  }
}
