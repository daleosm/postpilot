"use client";

import { useCallback, useEffect, useState } from "react";

import { EpisodeTeam } from "@/components/episode-team";

type TeamData = {
  assignments: Array<{ id: string; personId: string; name: string; role: string; isLead: boolean }>;
  people: Array<{ id: string; name: string; role: string }>;
  signOffSlots: Array<{ approvalRuleId: string; stageName: string; label: string; isRequired: boolean; personId: string | null }>;
};

export function EpisodeTeamModal({ episodeId }: { episodeId: string }) {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch(`/api/episodes/${episodeId}/team`);
    if (!response.ok) throw new Error((await response.json()).error ?? "Could not load the episode team.");
    setData(await response.json() as TeamData);
  }, [episodeId]);

  useEffect(() => {
    // Loading is an external synchronization, and state is set only after its response settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((cause: Error) => setError(cause.message));
  }, [load]);

  if (error) return <p className="mt-5 text-xs text-[#a35e41]">{error}</p>;
  if (!data) return <p className="mt-5 text-xs text-[#858a87]">Loading episode team…</p>;

  return <div className="mt-5"><EpisodeTeam episodeId={episodeId} assignments={data.assignments} people={data.people} signOffSlots={data.signOffSlots} canManage onChanged={() => { void load().catch((cause: Error) => setError(cause.message)); }} /></div>;
}
