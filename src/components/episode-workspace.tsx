import type { ReactNode } from "react";
import { EmptyState, OperationalPanel, SummaryStrip } from "@/components/operations-ui";

export function EpisodeTabHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="episode-tab-header flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-[.11em] text-[#75817c]">{eyebrow}</p>
      <h2 className="mt-0.5 text-base font-semibold text-[#303936]">{title}</h2>
      <p className="mt-0.5 max-w-2xl text-[11px] leading-4 text-[#737d77]">{description}</p>
    </div>
    {action ? <div className="shrink-0">{action}</div> : null}
  </header>;
}

export function EpisodeSummaryStrip({ items }: { items: Array<{ label: string; value: string | number; tone?: "default" | "success" | "warning" | "danger" }> }) {
  return <SummaryStrip items={items} className="episode-summary-strip" />;
}

export function EpisodeWorkspaceSurface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <OperationalPanel className={`episode-workspace-surface overflow-hidden ${className}`}>{children}</OperationalPanel>;
}

export function EpisodeEmptyState({ children }: { children: ReactNode }) {
  return <EmptyState title="" className="episode-empty-state">{children}</EmptyState>;
}
