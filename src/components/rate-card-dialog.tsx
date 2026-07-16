"use client";

import { Button } from "@heroui/react";
import { Tags, X } from "lucide-react";
import { useState } from "react";

import { RateOverrideCard } from "@/components/rate-override-card";
import type { ServiceRate } from "@/components/service-rate-card";

type Scope = { type: "master" } | { type: "network"; network: string } | { type: "show"; showId: string } | { type: "episode"; episodeId: string };

/** Keeps rate maintenance intentional instead of expanding it into every budget row. */
export function RateCardDialog({ rates, scope, title }: { rates: ServiceRate[]; scope: Scope; title: string }) {
  const [open, setOpen] = useState(false);
  const description = scope.type === "master" ? "Set the post house defaults. Network, show and episode cards inherit these prices until they have an explicit override." : "Prices inherit from the master card and more general scopes unless this scope needs an agreed exception.";
  return <><Button variant="secondary" size="sm" onPress={() => setOpen(true)} className="border border-[#dfe3df] bg-white text-[#58635e]"><Tags size={14} /> Manage rate card</Button>{open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202725]/25 p-4"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-5 shadow-2xl"><div className="mb-4 flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-[-0.03em] text-[#2d3431]">{title}</h2><p className="mt-1 text-sm text-[#767c78]">{description}</p></div><Button isIconOnly variant="tertiary" onPress={() => setOpen(false)} aria-label="Close rate card" className="min-w-0 text-[#7d827e]"><X size={18}/></Button></div><RateOverrideCard rates={rates} scope={scope} title="Service prices" /></div></div>}</>;
}
