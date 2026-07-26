"use client";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

import { Button } from "@heroui/react";
import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";

import { EpisodeTeamModal } from "@/components/episode-team-modal";

type EditableEpisode = {
  id: string;
  title: string;
  productionCode: string | null;
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
    const response = await postpilotUiFetch(`/v1/episodes/${episode.id}`, {
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

  const dialog = open ? <div className="pp-modal-layer fixed inset-0 z-[100] flex items-center justify-center bg-[#18211e]/35 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-episode-title">
      <form action={submit} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl bg-[#fafbf9] p-6 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="edit-episode-title" className="text-lg font-semibold">Edit episode</h2>
          <Button isIconOnly type="button" variant="tertiary" onPress={() => setOpen(false)} aria-label="Close"><X size={16} /></Button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <EpisodeField label="Title"><input name="title" defaultValue={episode.title} /></EpisodeField>
          <EpisodeField label="Production code"><input name="productionCode" defaultValue={episode.productionCode ?? ""} /></EpisodeField>
          <EpisodeField label="Air date"><input type="date" name="airDate" defaultValue={episode.airDate ?? ""} /></EpisodeField>
          <EpisodeField label="Lock date"><input type="date" name="lockedCutDate" defaultValue={episode.lockedCutDate ?? ""} /></EpisodeField>
          <EpisodeField label="Delivery deadline" className="sm:col-span-2"><input type="datetime-local" name="deliveryDeadline" defaultValue={episode.deliveryDeadline ? new Date(episode.deliveryDeadline).toISOString().slice(0, 16) : ""} /></EpisodeField>
        </div>
        <EpisodeTeamModal episodeId={episode.id} />
        {error && <p className="mt-3 text-xs text-[#a35e41]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" variant="primary" className="bg-[#263130] text-white">Save changes</Button>
        </div>
      </form>
    </div> : null;

  return <>
    <Button variant="tertiary" onPress={() => setOpen(true)} className="border border-[#dfe3df]"><Pencil size={14} /> Edit episode</Button>
    {dialog ? createPortal(dialog, document.body) : null}
  </>;
}

function EpisodeField({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={`block min-w-0 text-xs font-medium text-[#4b5651] ${className}`}><span>{label}</span><span className="mt-1.5 block [&_input]:h-10 [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-md [&_input]:border [&_input]:border-[#d9dfda] [&_input]:bg-white [&_input]:px-3 [&_input]:text-sm [&_input]:text-[#333c37]">{children}</span></label>;
}
