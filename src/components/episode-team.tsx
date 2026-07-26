"use client";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

import { Button } from "@heroui/react";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Assignment = { id: string; personId: string; name: string; role: string; isLead: boolean };
type Person = { id: string; name: string; role: string };

export function EpisodeTeam({ episodeId, assignments, people, eligibleSignerRoles = [], canManage, onChanged }: { episodeId: string; assignments: Assignment[]; people: Person[]; eligibleSignerRoles?: string[]; canManage: boolean; onChanged?: () => void | Promise<void> }) {
  const router = useRouter();
  const [personId, setPersonId] = useState("");
  const [error, setError] = useState("");
  const availablePeople = people.filter((person) => !assignments.some((assignment) => assignment.personId === person.id));

  async function add() {
    const response = await postpilotUiFetch(`/v1/episodes/${episodeId}/team`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId }) });
    if (!response.ok) return setError((await response.json()).error ?? "Could not assign person.");
    setPersonId("");
    await onChanged?.();
    router.refresh();
  }

  async function setSigner(assignmentId: string, isSigner: boolean) {
    setError("");
    const response = await postpilotUiFetch(`/v1/episodes/${episodeId}/team`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId, isSigner }) });
    if (!response.ok) return setError((await response.json()).error ?? "Could not update the workflow signer.");
    await onChanged?.();
    router.refresh();
  }

  async function remove(id: string) {
    const response = await postpilotUiFetch(`/v1/episodes/${episodeId}/team/${id}`, { method: "DELETE" });
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
      {assignments.length ? <ul className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {assignments.map((item) => <li key={item.id} className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e8efea] text-[10px] font-bold tracking-[.04em] text-[#456b5e]">{item.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-[#46504b]">{item.name}</span>
            <span className="mt-0.5 block truncate text-[11px] capitalize text-[#7a837e]">{item.role.replaceAll("_", " ")}</span>
          </span>
        </li>)}
      </ul> : <p className="py-7 text-center text-sm text-[#858b87]">No people have been assigned to this episode yet.</p>}
    </section>;
  }

  const signerRoles = new Set(eligibleSignerRoles);

  return <div className="min-w-0 rounded-lg border border-[#ecebe7] p-3">
    <div className="flex items-center justify-between gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7d837f]">Episode team</p>
      <span className="text-[10px] text-[#858a87]">{assignments.length} assigned</span>
    </div>
    <p className="mt-1 text-[11px] leading-4 text-[#858a87]">Anyone can be assigned. Tick one person per configured sign-off role to nominate the person who can sign off that role’s workflow stages.</p>
    <div className="mt-2 overflow-hidden rounded border border-[#ecebe7]">
      <div className="grid grid-cols-[minmax(0,1fr)_5.75rem_1.75rem] items-center gap-2 border-b border-[#ecebe7] bg-[#f4f5f2] px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[.06em] text-[#7d837f]">
        <span>Team member</span><span>Signer</span><span />
      </div>
      {assignments.map((item) => {
        const canSign = signerRoles.has(item.role);
        return <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_5.75rem_1.75rem] items-center gap-2 border-b border-[#f0f0ed] bg-[#fafaf8] px-2 py-1.5 text-xs last:border-b-0">
        <span className="min-w-0 truncate font-medium text-[#46504b]">{item.name} · {item.role.replaceAll("_", " ")}</span>
        <label className={`flex items-center gap-1.5 text-[10px] font-medium ${canSign ? "cursor-pointer text-[#52635c]" : "cursor-not-allowed text-[#a2a8a4]"}`} title={canSign ? "Nominates this person to sign off workflow stages configured for their role." : "No workflow sign-off stage is configured for this role."}>
          <input type="checkbox" checked={item.isLead} disabled={!canSign} onChange={(event) => setSigner(item.id, event.target.checked)} aria-label={`Workflow signer: ${item.name}`} />
          <span>Signer</span>
        </label>
        <Button type="button" isIconOnly size="sm" variant="tertiary" onPress={() => remove(item.id)} aria-label={`Remove ${item.name}`} className="min-w-0 text-[#9b5c42]"><X size={13} /></Button>
      </div>;
      })}
      {!assignments.length && <p className="px-2 py-3 text-xs text-[#858a87]">No people assigned to this episode.</p>}
    </div>
    {!eligibleSignerRoles.length && <p className="mt-2 text-xs text-[#a35e41]">No workflow sign-off roles are configured. Choose a role for each sign-off in Post workflow.</p>}
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
