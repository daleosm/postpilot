"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EpisodeWorkOrders } from "@/components/episode-work-orders";
import { EpisodeTeam } from "@/components/episode-team";

const tabs = ["Overview", "Workflow", "QC", "Work orders", "Bookings", "Budget", "Activity"] as const;
type TabName = (typeof tabs)[number];
type Row = { id: string; [key: string]: unknown };
type EpisodeData = { id?: string; title: string; showTitle: string; seasonNumber: number; number: number; status: string; qcStatus: string; workflowStageId: string | null; workflowStage: string | null; editorName: string | null; producerName: string | null; lockedCutDate: string | null; deliveryDeadline: Date | string | null };
type WorkflowStage = { id: string; name: string; key: string; position: number; canStartEarly?: boolean };
type WorkflowApprovalRule = { id: string; workflowStageId: string; approverRole: string; label: string; approvalOrder: number; isRequired: boolean };
type WorkflowApproval = { id: string; workflowStageId: string; approvalRuleId: string; approverRole: string; requiredPersonId: string | null; status: string; comment: string | null; submittedAt: Date | string; respondedAt: Date | string | null };
type WorkOrder = { id: string; workflowStageId: string | null; workflowStageName: string | null; kind: string; title: string; description: string | null; department: string | null; assigneePersonId: string | null; assigneeName: string | null; assigneeRole: string | null; vendorCompanyId: string | null; priority: string; isBlocking: boolean; status: string; billingScope: string; billingStatus: string; estimatedAmount: string | number | null; clientQuoteAmount: string | number | null; actualAmount: string | number | null; currency: string; clientQuoteCurrency: string | null; billingNotes: string | null; budgetLineId: string | null; externalUrl: string | null; dueAt: Date | string | null; completedAt: Date | string | null };
type QcReport = { id: string; status: string; reportUrl: string | null; summary: string | null; waiverReason: string | null; completedAt: Date | string | null; createdAt: Date | string };
type QcIssue = { id: string; qcReportId: string; code: string | null; severity: string; description: string; timecodeSeconds: string | number | null; status: string; resolution: string | null; resolvedAt: Date | string | null; createdAt: Date | string };
type WorkspaceData = { episode: EpisodeData; schedule: Array<Row & { title: string; startsAt: Date | string; roomName: string | null }>; budget: Array<Row & { category: string; actualAmount: string | number; budgetedAmount: string | number }>; activity: Array<Row & { action: string; createdAt: Date | string }>; workflowStages: readonly WorkflowStage[]; workflowApprovalRules: WorkflowApprovalRule[]; workflowApprovals: WorkflowApproval[]; workflowApprovers: Array<{ id: string; name: string; role: string }>; episodeTeam: Array<{ id: string; personId: string; name: string; role: string; responsibility: string; isLead: boolean }>; workOrders: WorkOrder[]; qcHistory: QcReport[]; qcIssueHistory: QcIssue[]; vendorOptions: Array<{ id: string; name: string }> };

export function EpisodeDetailTabs({ data, canManageWorkOrders, canUpdateWorkOrders, canManageCommercial, canManageQc, canWaiveQc }: { data: WorkspaceData; canManageWorkOrders: boolean; canUpdateWorkOrders: boolean; canManageCommercial: boolean; canManageQc: boolean; canWaiveQc: boolean }) {
  const [tab, setTab] = useState<TabName>("Overview");
  const visibleTabs = canManageCommercial ? tabs : tabs.filter((item) => item !== "Budget");

  return (
    <section className="panel overflow-hidden">
      <div className="flex overflow-x-auto border-b border-[#ebeae6] px-4">
        {visibleTabs.map((item) => (
          <Button key={item} variant="tertiary" onPress={() => setTab(item)} className={`h-auto min-w-max rounded-none border-b-2 px-3 py-3 text-xs font-semibold transition ${tab === item ? "border-[#567b72] text-[#385c54]" : "border-transparent text-[#838986] hover:text-[#515a56]"}`}>
            {item}
          </Button>
        ))}
      </div>
      <div className="p-5"><TabContent tab={tab} data={data} canManageWorkOrders={canManageWorkOrders} canUpdateWorkOrders={canUpdateWorkOrders} canManageCommercial={canManageCommercial} canManageQc={canManageQc} canWaiveQc={canWaiveQc} /></div>
    </section>
  );
}

function TabContent({ tab, data, canManageWorkOrders, canUpdateWorkOrders, canManageCommercial, canManageQc, canWaiveQc }: { tab: TabName; data: WorkspaceData; canManageWorkOrders: boolean; canUpdateWorkOrders: boolean; canManageCommercial: boolean; canManageQc: boolean; canWaiveQc: boolean }) {
  if (tab === "Overview") return <EpisodeOverview data={data} />;
  if (tab === "Workflow") return <WorkflowPanel episodeId={data.episode.id} initialStageId={data.episode.workflowStageId} stages={data.workflowStages} rules={data.workflowApprovalRules} approvals={data.workflowApprovals} />;
  if (tab === "QC") return <QcPanel episodeId={data.episode.id ?? ""} episodeStatus={data.episode.qcStatus} initialHistory={data.qcHistory} initialIssues={data.qcIssueHistory} canManage={canManageQc} canWaive={canWaiveQc} />;
  if (tab === "Work orders") return <EpisodeWorkOrders episodeId={data.episode.id ?? ""} initialWorkOrders={data.workOrders} people={data.workflowApprovers} stages={data.workflowStages} currentStageId={data.episode.workflowStageId} vendors={data.vendorOptions} canManage={canManageWorkOrders} canUpdate={canUpdateWorkOrders} canManageCommercial={canManageCommercial} />;
  if (tab === "Bookings") return <List empty="No scheduled room bookings." items={data.schedule} render={(item) => <><b>{item.title}</b><span>{formatDate(item.startsAt)} · {item.roomName}</span></>} />;
  if (tab === "Budget") return <List empty="No budget lines are linked." items={data.budget} render={(item) => <><b>{item.category}</b><span>${Number(item.actualAmount).toLocaleString()} actual / ${Number(item.budgetedAmount).toLocaleString()} estimate</span></>} />;
  return <List empty="No recent activity." items={data.activity} render={(item) => <><b className="capitalize">{item.action.replaceAll(".", " ").replaceAll("_", " ")}</b><span>{formatDate(item.createdAt)}</span></>} />;
}

function EpisodeOverview({ data }: { data: WorkspaceData }) {
  const currentStage = data.workflowStages.find((stage) => stage.id === data.episode.workflowStageId);
  const stageIndex = currentStage ? data.workflowStages.findIndex((stage) => stage.id === currentStage.id) + 1 : 0;
  const stageRules = currentStage ? data.workflowApprovalRules.filter((rule) => rule.workflowStageId === currentStage.id) : [];
  const signedRules = stageRules.filter((rule) => data.workflowApprovals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"));
  const openWorkOrders = data.workOrders.filter((order) => !["complete", "cancelled"].includes(order.status));
  const upcomingBookings = data.schedule.slice(0, 3);
  const latestQc = data.qcHistory[0];

  return <div className="space-y-5">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
      <section className="rounded-xl border border-[#e5e7e3] bg-[#f8faf8] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#75817c]">Current workflow</p><h2 className="mt-1 text-lg font-semibold text-[#303936]">{currentStage?.name ?? data.episode.workflowStage ?? "Workflow not set"}</h2><p className="mt-1 text-xs text-[#737c77]">{stageIndex ? `Stage ${stageIndex} of ${data.workflowStages.length}` : "Set the current stage in Workflow."}</p></div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${stageRules.length && signedRules.length === stageRules.length ? "bg-[#dcebe4] text-[#3d7160]" : "bg-[#ecefea] text-[#617069]"}`}>{stageRules.length ? `${signedRules.length}/${stageRules.length} sign-offs` : "No sign-off gate"}</span>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#e6e9e5]"><div className="h-full rounded-full bg-[#5f8578]" style={{ width: `${data.workflowStages.length ? Math.max((stageIndex / data.workflowStages.length) * 100, stageIndex ? 8 : 0) : 0}%` }} /></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <OverviewItem label="Episode status" value={humanize(data.episode.status)} />
          <OverviewItem label="QC status" value={latestQc ? `${humanize(latestQc.status)} · ${formatDate(latestQc.completedAt ?? latestQc.createdAt)}` : "No report recorded"} tone={latestQc?.status === "failed" ? "danger" : latestQc?.status === "passed" || latestQc?.status === "waived" ? "success" : undefined} />
          <OverviewItem label="Picture lock" value={formatDate(data.episode.lockedCutDate)} />
          <OverviewItem label="Delivery deadline" value={formatDate(data.episode.deliveryDeadline)} />
        </div>
      </section>
      <EpisodeTeam episodeId={data.episode.id ?? ""} assignments={data.episodeTeam} people={data.workflowApprovers} canManage={false} />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-[#e7e8e4] p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#7b827f]">Schedule</p><h3 className="mt-1 text-sm font-semibold text-[#414b47]">Booked room time</h3></div><span className="text-xs text-[#75807a]">{data.schedule.length} booking{data.schedule.length === 1 ? "" : "s"}</span></div>
        <div className="mt-3 divide-y divide-[#ecece8]">{upcomingBookings.length ? upcomingBookings.map((booking) => <div key={booking.id} className="flex items-center justify-between gap-3 py-2.5 text-xs"><div className="min-w-0"><p className="truncate font-medium text-[#49534e]">{booking.title}</p><p className="mt-0.5 text-[#858c88]">{booking.roomName ?? "Room to be confirmed"}</p></div><time className="shrink-0 text-[#65736d]">{formatDate(booking.startsAt)}</time></div>) : <p className="py-5 text-center text-xs text-[#858a87]">No room bookings are linked to this episode.</p>}</div>
      </section>
      <section className="rounded-xl border border-[#e7e8e4] p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#7b827f]">Work orders</p><h3 className="mt-1 text-sm font-semibold text-[#414b47]">Episode actions</h3></div><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${openWorkOrders.length ? "bg-[#f4eee5] text-[#94633d]" : "bg-[#e7efe9] text-[#48705e]"}`}>{openWorkOrders.length} open</span></div>
        <div className="mt-3 divide-y divide-[#ecece8]">{openWorkOrders.length ? openWorkOrders.slice(0, 3).map((order) => <div key={order.id} className="flex items-center justify-between gap-3 py-2.5 text-xs"><div className="min-w-0"><p className="truncate font-medium text-[#49534e]">{order.title}</p><p className="mt-0.5 text-[#858c88]">{order.assigneeName ?? order.department ?? "Unassigned"}</p></div><span className="shrink-0 capitalize text-[#65736d]">{humanize(order.status)}</span></div>) : <p className="py-5 text-center text-xs text-[#858a87]">No open work orders.</p>}</div>
      </section>
    </div>
  </div>;
}

function QcPanel({ episodeId, episodeStatus, initialHistory, initialIssues, canManage, canWaive }: { episodeId: string; episodeStatus: string; initialHistory: QcReport[]; initialIssues: QcIssue[]; canManage: boolean; canWaive: boolean }) {
  const router = useRouter();
  const [history, setHistory] = useState(initialHistory);
  const [status, setStatus] = useState("in_progress");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const latest = history[0];

  async function submit(form: FormData) {
    setSaving(true);
    setMessage("");
    const payload = {
      episodeId,
      status,
      reportUrl: String(form.get("reportUrl") ?? "").trim() || null,
      summary: String(form.get("summary") ?? "").trim() || null,
      waiverReason: String(form.get("waiverReason") ?? "").trim() || null,
      checksum: null,
    };
    try {
      const response = await fetch("/api/qc-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (!response.ok) return setMessage(body?.error ?? "Could not record the QC result.");
      setHistory((items) => [{ id: body.id, status, reportUrl: payload.reportUrl, summary: payload.summary, waiverReason: payload.waiverReason, completedAt: ["passed", "failed", "waived"].includes(status) ? new Date() : null, createdAt: new Date() }, ...items]);
      setMessage(status === "failed" ? "QC failure recorded and a blocking correction work order was created." : "QC result recorded.");
      router.refresh();
    } catch {
      setMessage("Could not record the QC result.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
    <section className="rounded-xl border border-[#e5e7e3] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#77817d]">Episode QC</p><h2 className="mt-1 text-lg font-semibold capitalize text-[#313a36]">{humanize(episodeStatus)}</h2></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${episodeStatus === "needs_attention" ? "bg-[#f8e7df] text-[#a45f43]" : episodeStatus === "passed" || episodeStatus === "waived" ? "bg-[#e0ede6] text-[#427361]" : "bg-[#edf0ed] text-[#63716b]"}`}>{episodeStatus === "needs_attention" ? "Corrections required" : humanize(episodeStatus)}</span></div>
      <div className="mt-4 border-t border-[#eceeea] pt-3">{latest ? <><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold capitalize text-[#46504b]">Latest report · {humanize(latest.status)}</p><time className="text-xs text-[#818985]">{formatDate(latest.completedAt ?? latest.createdAt)}</time></div>{latest.summary && <p className="mt-2 text-sm leading-6 text-[#5e6863]">{latest.summary}</p>}{latest.waiverReason && <p className="mt-2 rounded-md bg-[#f3f0e8] px-3 py-2 text-xs text-[#766346]">Waiver: {latest.waiverReason}</p>}{latest.reportUrl && <a href={latest.reportUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-semibold text-[#4c7469] hover:underline">Open external QC report ↗</a>}</> : <p className="py-6 text-center text-sm text-[#858b87]">No QC report has been recorded for this episode yet.</p>}</div>
      <div className="mt-4 divide-y divide-[#eceeea] border-t border-[#eceeea]">{history.slice(1).map((report) => <div key={report.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="text-xs font-semibold capitalize text-[#4c5651]">{humanize(report.status)}</p><p className="mt-0.5 truncate text-xs text-[#858c88]">{report.summary ?? "No summary"}</p></div><time className="shrink-0 text-xs text-[#818985]">{formatDate(report.completedAt ?? report.createdAt)}</time></div>)}</div>
    </section>
    <section className="rounded-xl border border-[#e5e7e3] bg-[#fafbf9] p-4"><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#77817d]">Record QC result</p>{canManage ? <form action={submit} className="mt-3 space-y-3"><label className="block text-xs font-medium text-[#56605b]">Result<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-[#dfe3df] bg-white px-2 text-sm"><option value="in_progress">QC in progress</option><option value="passed">Passed</option><option value="failed">Failed — corrections required</option>{canWaive && <option value="waived">Waived</option>}</select></label><label className="block text-xs font-medium text-[#56605b]">External report link <span className="font-normal text-[#858c88]">(optional)</span><input name="reportUrl" type="url" placeholder="https://…" className="mt-1.5 h-10 w-full rounded-md border border-[#dfe3df] bg-white px-3 text-sm" /></label><label className="block text-xs font-medium text-[#56605b]">Summary <span className="font-normal text-[#858c88]">(optional)</span><textarea name="summary" rows={4} placeholder="Result, exceptions, and next steps…" className="mt-1.5 w-full rounded-md border border-[#dfe3df] bg-white p-3 text-sm" /></label>{status === "waived" && <label className="block text-xs font-medium text-[#56605b]">Waiver reason<textarea name="waiverReason" rows={3} required className="mt-1.5 w-full rounded-md border border-[#dfe3df] bg-white p-3 text-sm" /></label>}<Button type="submit" variant="primary" isDisabled={saving} className="bg-[#3f7563] text-white">{saving ? "Recording…" : "Record QC result"}</Button>{message && <p role="status" className={`text-xs ${message.includes("Could not") ? "text-[#a35e41]" : "text-[#3f7563]"}`}>{message}</p>}</form> : <p className="mt-3 text-sm leading-6 text-[#727b76]">You can view QC history, but your current role cannot record QC results.</p>}</section>
    <div className="xl:col-span-2"><QcIssueTracker reports={history} initialIssues={initialIssues} canManage={canManage} canWaive={canWaive} /></div>
  </div>;
}

function QcIssueTracker({ reports, initialIssues, canManage, canWaive }: { reports: QcReport[]; initialIssues: QcIssue[]; canManage: boolean; canWaive: boolean }) {
  const router = useRouter();
  const [issues, setIssues] = useState(initialIssues);
  const [reportId, setReportId] = useState(reports[0]?.id ?? "");
  const [severity, setSeverity] = useState("major");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const openIssues = issues.filter((issue) => issue.status === "open");
  const failedReports = reports.filter((report) => report.status === "failed");
  const reQcState = failedReports.length ? openIssues.length ? `${openIssues.length} correction${openIssues.length === 1 ? "" : "s"} open` : "Ready for re-QC" : "No failed QC report";

  async function create(form: FormData) {
    setSaving(true); setMessage("");
    const timecode = String(form.get("timecodeSeconds") ?? "").trim();
    const payload = { qcReportId: reportId, severity, code: String(form.get("code") ?? "").trim() || null, description: String(form.get("description") ?? "").trim(), timecodeSeconds: timecode ? Number(timecode) : null };
    try {
      const response = await fetch("/api/qc-issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (!response.ok) return setMessage(body?.error ?? "Could not log the QC issue.");
      setIssues((items) => [{ ...body, createdAt: new Date() }, ...items]);
      setMessage("QC issue logged.");
      router.refresh();
    } catch { setMessage("Could not log the QC issue."); } finally { setSaving(false); }
  }

  async function update(issue: QcIssue, status: "open" | "resolved" | "waived", resolution: string | null) {
    setMessage("");
    const response = await fetch(`/api/qc-issues/${issue.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, resolution }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) return setMessage(body?.error ?? "Could not update the QC issue.");
    setIssues((items) => items.map((item) => item.id === issue.id ? { ...item, ...body } : item));
    setMessage(status === "resolved" ? "QC issue resolved. Re-QC state updated." : status === "waived" ? "QC issue waived." : "QC issue reopened.");
    router.refresh();
  }

  return <section className="rounded-xl border border-[#e5e7e3] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#77817d]">QC exceptions</p><h3 className="mt-1 text-sm font-semibold text-[#414b47]">Issue log</h3></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${openIssues.length ? "bg-[#f8e7df] text-[#a45f43]" : "bg-[#e0ede6] text-[#427361]"}`}>{reQcState}</span></div><div className="mt-4 space-y-3">{issues.length ? issues.map((issue) => <QcIssueRow key={issue.id} issue={issue} canManage={canManage} canWaive={canWaive} onUpdate={update} />) : <p className="rounded-lg bg-[#fafbf9] py-5 text-center text-sm text-[#858b87]">No QC exceptions have been logged.</p>}</div>{canManage && reports.length > 0 && <form action={create} className="mt-5 rounded-lg border border-[#e3e7e2] bg-[#fafbf9] p-3"><p className="text-xs font-semibold text-[#4c5651]">Log QC exception</p><div className="mt-3 grid gap-3 sm:grid-cols-4"><label className="text-xs font-medium text-[#59635e]">Report<select value={reportId} onChange={(event) => setReportId(event.target.value)} className="mt-1 w-full rounded-md border border-[#dfe3df] bg-white p-2 text-xs">{reports.map((report) => <option key={report.id} value={report.id}>{humanize(report.status)} · {formatDate(report.completedAt ?? report.createdAt)}</option>)}</select></label><label className="text-xs font-medium text-[#59635e]">Code<input name="code" placeholder="PHOTOSENS-01" className="mt-1 w-full rounded-md border border-[#dfe3df] bg-white p-2 text-xs" /></label><label className="text-xs font-medium text-[#59635e]">Severity<select value={severity} onChange={(event) => setSeverity(event.target.value)} className="mt-1 w-full rounded-md border border-[#dfe3df] bg-white p-2 text-xs"><option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option></select></label><label className="text-xs font-medium text-[#59635e]">Timecode <span className="font-normal">(seconds)</span><input name="timecodeSeconds" type="number" min="0" step="0.001" className="mt-1 w-full rounded-md border border-[#dfe3df] bg-white p-2 text-xs" /></label></div><label className="mt-3 block text-xs font-medium text-[#59635e]">Exception description<textarea name="description" required rows={2} placeholder="Describe the technical issue and required correction…" className="mt-1 w-full rounded-md border border-[#dfe3df] bg-white p-2 text-sm" /></label><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[#7e8581]">Open exceptions keep a failed report in corrections until they are resolved or waived.</p><Button type="submit" variant="primary" isDisabled={saving || !reportId} className="bg-[#263130] text-white">{saving ? "Logging…" : "Log exception"}</Button></div></form>}{canManage && !reports.length && <p className="mt-4 text-xs text-[#858b87]">Record a QC report before logging exceptions.</p>}{message && <p role="status" className={`mt-3 text-xs ${message.includes("Could not") ? "text-[#a35e41]" : "text-[#3f7563]"}`}>{message}</p>}</section>;
}

function QcIssueRow({ issue, canManage, canWaive, onUpdate }: { issue: QcIssue; canManage: boolean; canWaive: boolean; onUpdate: (issue: QcIssue, status: "open" | "resolved" | "waived", resolution: string | null) => Promise<void> }) {
  const [resolution, setResolution] = useState(issue.resolution ?? "");
  const isClosed = issue.status !== "open";
  return <div className="rounded-lg border border-[#e6e8e4] p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${issue.severity === "critical" ? "bg-[#f7dfd8] text-[#9c5139]" : issue.severity === "major" ? "bg-[#f4ebdf] text-[#96683a]" : "bg-[#e8efeb] text-[#4e7164]"}`}>{issue.severity}</span>{issue.code && <span className="font-mono text-[11px] text-[#65716b]">{issue.code}</span>}{issue.timecodeSeconds !== null && <span className="text-[11px] text-[#7c8580]">{formatTimecode(issue.timecodeSeconds)}</span>}</div><p className="mt-2 text-sm text-[#48514d]">{issue.description}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${isClosed ? "bg-[#e4ece7] text-[#507363]" : "bg-[#f8e7df] text-[#a45f43]"}`}>{humanize(issue.status)}</span></div>{isClosed && issue.resolution && <p className="mt-3 rounded-md bg-[#f5f7f4] px-3 py-2 text-xs text-[#5f6964]">Resolution: {issue.resolution}</p>}{canManage && !isClosed && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Resolution note required to close" className="min-w-0 flex-1 rounded-md border border-[#dfe3df] bg-white px-3 py-2 text-xs" /><Button type="button" size="sm" variant="primary" isDisabled={!resolution.trim()} onPress={() => onUpdate(issue, "resolved", resolution.trim())} className="bg-[#3f7563] text-white">Resolve</Button>{canWaive && <Button type="button" size="sm" variant="tertiary" onPress={() => onUpdate(issue, "waived", resolution.trim() || null)}>Waive</Button>}</div>}</div>;
}

function OverviewItem({ label, value, tone }: { label: string; value: string; tone?: "warning" | "danger" | "success" }) {
  const toneClass = tone === "danger" ? "text-[#a35e41]" : tone === "warning" ? "text-[#a06f3a]" : tone === "success" ? "text-[#3f7563]" : "text-[#46504b]";
  return <div className="rounded-lg border border-[#e7e9e5] bg-white/50 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#858c88]">{label}</p><p className={`mt-1 text-sm font-medium capitalize ${toneClass}`}>{value}</p></div>;
}

function WorkflowPanel({ episodeId, initialStageId, stages, rules, approvals }: { episodeId?: string; initialStageId: string | null; stages: readonly WorkflowStage[]; rules: WorkflowApprovalRule[]; approvals: WorkflowApproval[] }) {
  const router = useRouter();
  const [currentStageId, setCurrentStageId] = useState(initialStageId ?? stages[0]?.id ?? "");
  const [selectedStageId, setSelectedStageId] = useState(initialStageId ?? stages[0]?.id ?? "");
  const [approvalState, setApprovalState] = useState(approvals);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");

  const stageStatus = (stageId: string) => {
    const stageRules = rules.filter((rule) => rule.workflowStageId === stageId);
    const stageApprovals = approvalState.filter((approval) => approval.workflowStageId === stageId);
    const required = stageRules;
    if (required.length && required.every((rule) => stageApprovals.some((approval) => approval.approvalRuleId === rule.id && approval.status === "approved"))) return "approved";
    if (stageApprovals.length) return "awaiting_sign_off";
    return stageId === currentStageId ? "in_progress" : "not_started";
  };

  const currentStatus = stageStatus(currentStageId);
  const currentRules = rules.filter((rule) => rule.workflowStageId === currentStageId);
  const currentStage = stages.find((stage) => stage.id === currentStageId);
  const selectedStage = stages.find((stage) => stage.id === selectedStageId);
  const selectedRules = rules.filter((rule) => rule.workflowStageId === selectedStageId);

  async function save() {
    if (!episodeId || !selectedStageId) return;
    const selected = stages.find((stage) => stage.id === selectedStageId);
    if (selectedStageId !== currentStageId) {
      if (!selected?.canStartEarly) {
        if (currentStage && selected && selected.position !== currentStage.position + 1) {
          setMessage("Workflow stages normally proceed in order. Enable Allow early start in workflow settings to make an exception.");
          return;
        }
        if (currentStatus !== "approved") {
          setMessage("Complete the current sign-off first.");
          return;
        }
      }
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${episodeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowStageId: selectedStageId }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error ?? "Could not update the workflow stage.");
        return;
      }
      setCurrentStageId(selectedStageId);
      setMessage("Workflow stage updated.");
      router.refresh();
    } catch {
      setMessage("Could not update the workflow stage.");
    } finally {
      setSaving(false);
    }
  }

  async function signOff() {
    if (!episodeId || !currentStageId) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/episodes/${episodeId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowStageId: currentStageId, action: "sign_off", comment }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error ?? "Could not record the sign-off.");
        return;
      }
      const signedRule = currentRules.find((rule) => rule.id === body?.approvalRuleId);
      if (signedRule) setApprovalState((items) => {
        const existing = items.find((approval) => approval.approvalRuleId === signedRule.id);
        return existing ? items.map((approval) => approval.approvalRuleId === signedRule.id ? { ...approval, status: "approved", comment, respondedAt: new Date() } : approval) : [...items, { id: `sign-off-${signedRule.id}`, workflowStageId: currentStageId, approvalRuleId: signedRule.id, approverRole: signedRule.approverRole, requiredPersonId: null, status: "approved", comment, submittedAt: new Date(), respondedAt: new Date() }];
      });
      setComment("");
      setMessage(body?.stageComplete ? "Stage fully signed off." : "Sign-off recorded.");
      if (!body?.debug) router.refresh();
    } catch {
      setMessage("Could not record the sign-off.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 rounded-lg border border-[#e4e7e2] bg-[#fafbf9] p-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#7c837f]">Current stage</p><p className="mt-1 text-sm font-semibold text-[#3e4642]">{currentStage?.name ?? "Not set"}</p></div>
          <div className="flex gap-2"><select aria-label="Select workflow stage" value={selectedStageId} onChange={(event) => setSelectedStageId(event.target.value)} className="h-9 min-w-0 rounded-md border border-[#dfe1dc] bg-[#fafbf9] px-2 text-xs">{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.position}. {stage.name}</option>)}</select><button type="button" onClick={save} disabled={saving || selectedStageId === currentStageId} className="h-9 shrink-0 rounded-md bg-[#263130] px-3 text-xs font-semibold text-white disabled:opacity-50">Update stage</button></div>
        </div>
        {selectedStageId !== currentStageId && <div className="mt-3 rounded-md border border-[#dce6e1] bg-[#f5f8f6] px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#597169]">Selected-stage sign-off roles · {selectedStage?.name}</p><p className="mt-1 text-xs text-[#58635e]">{selectedRules.map((rule) => rule.label).join(" · ") || "No sign-offs configured"}</p><p className="mt-1 text-[11px] text-[#77817c]">These sign-offs apply after the stage becomes current.</p></div>}
        <div className="mt-4 border-t border-[#e6e8e3] pt-3">
          <p className="text-xs font-semibold text-[#4b5651]">Current-stage sign-off · {currentStage?.name ?? "Not set"}</p>
          <div className="mt-2 space-y-1.5">{currentRules.map((rule) => <p key={rule.id} className="text-xs text-[#5a625e]">{rule.label}</p>)}{!currentRules.length && <p className="text-xs text-[#858a87]">No sign-offs are configured for this stage.</p>}</div>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="Optional sign-off note…" className="mt-3 w-full rounded-md border border-[#dfe1dc] p-2 text-xs" />
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={signOff} disabled={saving || currentStatus === "approved" || !currentRules.length} className="rounded-md bg-[#3f7563] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Sign off"}</button></div>
        </div>
      </div>
      <p className="mb-4 rounded-lg bg-[#f4f6f3] px-3 py-2 text-xs leading-5 text-[#66706b]">Stages progress in the order configured by your post house. Stages marked Allow early start may begin out of sequence. Green indicates every configured sign-off is complete.</p>
      <div className="space-y-3">{stages.map((stage) => { const status = stageStatus(stage.id); const stageRules = rules.filter((rule) => rule.workflowStageId === stage.id); return <div key={stage.id} className="flex items-start gap-3"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${status === "approved" ? "bg-[#dfeae6] text-[#467367]" : "bg-[#f0efec] text-[#8a8e8c]"}`}>{status === "approved" ? "✓" : stage.position}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`text-sm ${status === "approved" ? "font-medium text-[#3f635a]" : "text-[#4b5350]"}`}>{stage.name}</span><span className="rounded bg-[#edf0ed] px-1.5 py-0.5 text-[10px] font-semibold text-[#65736e]">{status.replaceAll("_", " ")}</span>{stage.id === currentStageId && <span className="text-[10px] font-semibold text-[#536f67]">Current</span>}</div><p className="mt-1 text-xs text-[#858a87]">{stageRules.map((rule) => rule.label).join(" · ") || "No sign-offs configured"}</p></div></div>; })}</div>
      {message && <p role="status" className={`mt-4 text-xs ${message.includes("Could not") || message.includes("Complete") ? "text-[#a35e41]" : "text-[#3f7563]"}`}>{message}</p>}
    </div>
  );
}

function List<T extends Row>({ items, empty, render }: { items: T[]; empty: string; render: (item: T) => React.ReactNode }) {
  return items.length ? <div className="divide-y divide-[#efeeea]">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm text-[#474f4b]"><div className="min-w-0"><div className="truncate">{render(item)}</div></div></div>)}</div> : <p className="py-7 text-center text-sm text-[#858a87]">{empty}</p>;
}

function formatDate(value: Date | string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(new Date(value)) : "—";
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function formatTimecode(value: string | number) {
  const seconds = Number(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
