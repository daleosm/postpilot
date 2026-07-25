import type { ReactNode } from "react";
import Link from "next/link";

type Tone = "default" | "success" | "warning" | "danger" | "info" | "active" | "neutral";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type SummaryItem = { label: string; value: string | number; tone?: Exclude<Tone, "info" | "active" | "neutral"> };

/** Shared page framing for every production module. */
export function PageHeader({ eyebrow, title, description, metrics = [], action }: { eyebrow: string; title: string; description: string; metrics?: SummaryItem[]; action?: ReactNode }) {
  return <header className="pp-page-header">
    <div className="min-w-0"><p className="pp-page-header__eyebrow">{eyebrow}</p><h1>{title}</h1><p className="pp-page-header__description">{description}</p></div>
    {(action || metrics.length > 0) ? <div className="pp-page-header__aside">{metrics.length > 0 ? <SummaryStrip items={metrics} ariaLabel={`${title} summary`} compact /> : null}{action ? <div className="shrink-0">{action}</div> : null}</div> : null}
  </header>;
}

/** A small, reusable operational total strip for headers and episode workspaces. */
export function SummaryStrip({ items, ariaLabel = "Operational summary", compact = false, className = "" }: { items: SummaryItem[]; ariaLabel?: string; compact?: boolean; className?: string }) {
  return <div className={classes("pp-summary-strip", compact && "pp-summary-strip--compact", className)} aria-label={ariaLabel} style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}>
    {items.map((item, index) => <div key={item.label} className={classes("pp-summary-strip__item", index > 0 && "pp-summary-strip__item--divided")}><span>{item.label}</span><strong data-tone={item.tone ?? "default"}>{item.value}</strong></div>)}
  </div>;
}

/** A standard panel shell. Set actionable only when the entire surface itself is interactive. */
export function OperationalPanel({ children, className = "", actionable = false }: { children: ReactNode; className?: string; actionable?: boolean }) {
  return <section data-actionable={actionable || undefined} className={classes("panel", className)}>{children}</section>;
}

export function PanelHeader({ title, description, action, className = "" }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return <div className={classes("pp-panel-header", className)}><div className="min-w-0"><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action ? <div className="shrink-0">{action}</div> : null}</div>;
}

export function SectionAction({ children, href, className = "" }: { children: ReactNode; href?: string; className?: string }) {
  const content = <>{children}<span aria-hidden="true">→</span></>;
  return href ? <Link href={href} className={classes("pp-section-action", className)}>{content}</Link> : <span className={classes("pp-section-action", className)}>{content}</span>;
}

/** Shared dense list/table shell. The child rows own their grid, while this owns header and empty-state treatment. */
export function OperationalRegister({ title, description, action, children, empty, className = "" }: { title: string; description?: string; action?: ReactNode; children?: ReactNode; empty?: { title: string; description?: string; action?: ReactNode }; className?: string }) {
  return <OperationalPanel className={classes("operational-register overflow-hidden", className)}><PanelHeader className="operational-register__header" title={title} description={description} action={action} />{children ? <div className="divide-y divide-[#efeeea]">{children}</div> : empty ? <EmptyState {...empty} /> : null}</OperationalPanel>;
}

export function EmptyState({ title = "Nothing to show yet", description, action, children, className = "" }: { title?: string; description?: string; action?: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={classes("operational-empty pp-empty-state", className)}>{title ? <p className="font-semibold text-[#515b56]">{title}</p> : null}{description ? <p className="mt-1 text-xs text-[#858c87]">{description}</p> : null}{children}{action ? <div className="mt-4">{action}</div> : null}</div>;
}

/** Status labels use semantic tones rather than feature-specific colour utilities. */
export function StatusChip({ label, tone = "neutral", className = "" }: { label: string; tone?: Tone; className?: string }) {
  const toneClass: Record<Tone, string> = { default: "pp-status--neutral", neutral: "pp-status--neutral", active: "pp-status--active", success: "pp-status--success", warning: "pp-status--warning", danger: "pp-status--danger", info: "pp-status--info" };
  return <span className={classes("pp-status", toneClass[tone], className)}>{label}</span>;
}

/** A compact secondary panel intended for contextual totals, status, or next actions. */
export function SideSummary({ title, description, children, className = "" }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return <OperationalPanel className={classes("pp-side-summary", className)}><PanelHeader title={title} description={description} /><div className="pp-side-summary__body">{children}</div></OperationalPanel>;
}

/** Form spacing and responsive grid conventions, without imposing field controls. */
export function FormLayout({ children, columns = 2, className = "" }: { children: ReactNode; columns?: 1 | 2 | 3; className?: string }) {
  return <div data-columns={columns} className={classes("pp-form-layout", className)}>{children}</div>;
}
