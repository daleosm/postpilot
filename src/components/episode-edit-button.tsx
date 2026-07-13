"use client";

import { Button } from "@heroui/react";
import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EpisodeTeamModal } from "@/components/episode-team-modal";

type EditableEpisode = {
  id: string;
  title: string;
  productionCode: string | null;
  status: string;
  airDate: string | null;
  lockedCutDate: string | null;
  deliveryDeadline: Date | string | null;
};

export function EpisodeEditButton({ episode }: { episode: EditableEpisode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  async function submit(form: FormData) {
    setError("");
    const payload = Object.fromEntries(form);
    const response = await fetch(`/api/episodes/${episode.id}/details`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        productionCode: payload.productionCode || null,
        airDate: payload.airDate || null,
        lockedCutDate: payload.lockedCutDate || null,
        deliveryDeadline: payload.deliveryDeadline ? new Date(String(payload.deliveryDeadline)).toISOString() : null,
      }),
    });
    if (!response.ok) return setError((await response.json()).error ?? "Could not save.");
    setOpen(false);
    router.refresh();
  }

  return <>
    <Button variant="tertiary" onPress={() => setOpen(true)} className="border border-[#dfe3df]"><Pencil size={14} /> Edit episode</Button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <form action={submit} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl bg-[#fafbf9] p-6 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Edit episode</h2>
          <Button isIconOnly type="button" variant="tertiary" onPress={() => setOpen(false)} aria-label="Close"><X size={16} /></Button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label>Title<input name="title" defaultValue={episode.title} /></label>
          <label>Production code<input name="productionCode" defaultValue={episode.productionCode ?? ""} /></label>
          <label>Status<select name="status" defaultValue={episode.status}>{["development", "assembly", "editor_cut", "review", "locked", "online", "delivered"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
          <label>Air date<input type="date" name="airDate" defaultValue={episode.airDate ?? ""} /></label>
          <label>Lock date<input type="date" name="lockedCutDate" defaultValue={episode.lockedCutDate ?? ""} /></label>
          <label>Delivery deadline<input type="datetime-local" name="deliveryDeadline" defaultValue={episode.deliveryDeadline ? new Date(episode.deliveryDeadline).toISOString().slice(0, 16) : ""} /></label>
        </div>
        <EpisodeTeamModal episodeId={episode.id} />
        {error && <p className="mt-3 text-xs text-[#a35e41]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" variant="primary" className="bg-[#263130] text-white">Save changes</Button>
        </div>
      </form>
    </div>}
  </>;
}
