"use client";

import { Button } from "@heroui/react";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Assignment = { id: string; personId: string; name: string; role: string; isLead: boolean };
type Person = { id: string; name: string; role: string };
type SignOffSlot = { approvalRuleId: string; stageName: string; label: string; isRequired: boolean; personId: string | null };

export function EpisodeTeam({ episodeId, assignments, people, signOffSlots = [], canManage, onChanged }: { episodeId: string; assignments: Assignment[]; people: Person[]; signOffSlots?: SignOffSlot[]; canManage: boolean; onChanged?: () => void | Promise<void> }) {
  const router = useRouter();
  const [personId, setPersonId] = useState("");
  const [error, setError] = useState("");
  const availablePeople = people.filter((person) => !assignments.some((assignment) => assignment.personId === person.id));

  async function add() {
    const response = await fetch(`/api/episodes/${episodeId}/team`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId }) });
    if (!response.ok) return setError((await response.json()).error ?? "Could not assign person.");
    setPersonId("");
    await onChanged?.();
    router.refresh();
  }

  async function setSignOffPerson(approvalRuleId: string, personId: string) {
    setError("");
    const response = await fetch(`/api/episodes/${episodeId}/team`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalRuleId, personId: personId || null }) });
    if (!response.ok) return setError((await response.json()).error ?? "Could not update the sign-off person.");
    await onChanged?.();
    router.refresh();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/episodes/${episodeId}/team?assignmentId=${id}`, { method: "DELETE" });
    if (!response.ok) return setError((await response.json()).error ?? "Could not remove person.");
    await onChanged?.();
    router.refresh();
  }

  if (!canManage) {
    return <section className="self-start rounded-xl border border-[#e5e7e3] bg-[#fafbf9] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#75817c]">Episode team</p>
          <h2 className="mt-1 text-sm font-semibold text-[#303936]">Assigned people</h2>
        </div>
        <span className="rounded-full bg-[#edf0ed] px-2 py-1 text-[11px] font-semibold text-[#63716b]">{assignments.length} assigned</span>
      </div>
      {assignments.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {assignments.map((item) => <div key={item.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[#e8ebe7] bg-white/60 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[#46504b]">{item.name}</p>
            <p className="mt-0.5 truncate text-[11px] capitalize text-[#7a837e]">{item.role.replaceAll("_", " ")}</p>
          </div>
        </div>)}
      </div> : <p className="py-7 text-center text-sm text-[#858b87]">No people have been assigned to this episode yet.</p>}
    </section>;
  }

  return <div className="min-w-0 rounded-lg border border-[#ecebe7] p-3">
    <div className="flex items-center justify-between gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7d837f]">Episode team</p>
      <span className="text-[10px] text-[#858a87]">{assignments.length} assigned</span>
    </div>
    <p className="mt-1 text-[11px] leading-4 text-[#858a87]">Assign people to the episode first, then choose the named person for each workflow sign-off slot.</p>
    <div className="mt-2 overflow-hidden rounded border border-[#ecebe7]">
      <div className="grid grid-cols-[minmax(0,1fr)_1.75rem] items-center gap-2 border-b border-[#ecebe7] bg-[#f4f5f2] px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[.06em] text-[#7d837f]">
        <span>Team member</span><span />
      </div>
      {assignments.map((item) => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_1.75rem] items-center gap-2 border-b border-[#f0f0ed] bg-[#fafaf8] px-2 py-1.5 text-xs last:border-b-0">
        <span className="min-w-0 truncate font-medium text-[#46504b]">{item.name} · {item.role.replaceAll("_", " ")}</span>
        <Button type="button" isIconOnly size="sm" variant="tertiary" onPress={() => remove(item.id)} aria-label={`Remove ${item.name}`} className="min-w-0 text-[#9b5c42]"><X size={13} /></Button>
      </div>)}
      {!assignments.length && <p className="px-2 py-3 text-xs text-[#858a87]">No people assigned to this episode.</p>}
    </div>
    <div className="mt-3 rounded border border-[#ecebe7] bg-[#fafaf8] p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[.06em] text-[#7d837f]">Workflow sign-off slots</p>
      {signOffSlots.length ? <div className="mt-2 space-y-2">{signOffSlots.map((slot) => <label key={slot.approvalRuleId} className="grid gap-1 text-xs text-[#59635e] sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center sm:gap-3"><span className="min-w-0"><b className="font-semibold text-[#46504b]">{slot.label}</b><span className="text-[#858a87]"> · {slot.stageName}{slot.isRequired ? " · required" : " · optional"}</span></span><select value={slot.personId ?? ""} onChange={(event) => setSignOffPerson(slot.approvalRuleId, event.target.value)} disabled={!assignments.length} aria-label={`Sign-off person for ${slot.label}`} className="min-w-0"><option value="">Choose person</option>{assignments.map((person) => <option key={person.personId} value={person.personId}>{person.name}</option>)}</select></label>)}</div> : <p className="mt-2 text-xs text-[#858a87]">No sign-off slots are configured in Post workflow.</p>}
    </div>
    <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
      <select value={personId} onChange={(event) => setPersonId(event.target.value)} disabled={!availablePeople.length} className="min-w-0 max-w-full">
        <option value="">{availablePeople.length ? "Choose person" : "All people are assigned"}</option>
        {availablePeople.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role.replaceAll("_", " ")}</option>)}
      </select>
      <Button type="button" isIconOnly variant="tertiary" onPress={add} isDisabled={!personId} aria-label="Add episode team member" className="min-w-0 border border-[#dfe3df]"><Plus size={15} /></Button>
    </div>
    {error && <p className="mt-2 text-xs text-[#a35e41]">{error}</p>}
  </div>;
}
