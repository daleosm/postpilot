import { redirect } from "next/navigation";

import { MyTimeBoard, type MyTimeBooking } from "@/components/my-time-board";
import { PageHeader } from "@/components/operations-ui";
import { WorkflowSignOffQueue } from "@/components/workflow-approval-queue";
import { WorkOrderQueue } from "@/components/work-order-queue";
import { getActiveOrganizationContext, getActiveShow } from "@/lib/organizations";
import { canRecordBookingActuals, roleHome } from "@/lib/permissions";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export default async function MyWorkPage() {
  const [context, activeShow, mayRecordActuals] = await Promise.all([
    getActiveOrganizationContext(),
    getActiveShow(),
    canRecordBookingActuals(),
  ]);
  const [signOffs, workOrders, hasApprovalAccess] = context?.organization
    ? await loadFastApprovalInbox()
    : [[], [], false];
  const hasTimeWorkspace = mayRecordActuals && Boolean(context?.person);
  if (!hasApprovalAccess && !hasTimeWorkspace) redirect(await roleHome());

  const [timeBookings] = await Promise.all([
    hasTimeWorkspace ? loadMyTimeBookings() : Promise.resolve([]),
  ]);
  const visibleSignOffs = activeShow ? signOffs.filter((item) => item.showId === activeShow.id) : signOffs;
  const visibleWorkOrders = activeShow ? workOrders.filter((item) => item.showId === activeShow.id) : workOrders;
  const timeToConfirm = timeBookings.filter((booking) => booking.timeStatus === "ready").length;

  return (
    <div className="pp-page">
      <PageHeader eyebrow={`My work · ${context?.organization?.organizationName ?? "No workspace"}`} title="My work" description="Your workflow sign-offs, assigned post work, and booked time to confirm." metrics={[{ label: "Sign-offs", value: visibleSignOffs.length, tone: visibleSignOffs.length ? "warning" : "success" }, { label: "Work orders", value: visibleWorkOrders.length }, ...(hasTimeWorkspace ? [{ label: "Time to confirm", value: timeToConfirm, tone: timeToConfirm ? "warning" as const : "success" as const }] : [])]} />

      <WorkflowSignOffQueue signOffs={visibleSignOffs} />
      <WorkOrderQueue workOrders={visibleWorkOrders} canOpenEpisodes />
      {hasTimeWorkspace && <MyTimeBoard bookings={timeBookings} />}
    </div>
  );
}

async function loadFastApprovalInbox() {
  const inbox = await postpilotApiServerFetch<{
    has_workspace: boolean;
    sign_offs: Array<{ id: string; approval_rule_id: string; episode_id: string; show_id: string; workflow_stage_id: string; stage_name: string; stage_position: number; sign_off_label: string; approver_role: string | null; approval_order: number; is_required: boolean; passed_at: string | null; show_title: string; episode_title: string; episode_number: number }>;
    work_orders: Array<{ id: string; episode_id: string; show_id: string; show_title: string; episode_title: string; episode_number: number; workflow_stage_name: string | null; kind: string; title: string; description: string | null; priority: string; is_blocking: boolean; status: string; due_at: string | null; external_url: string | null; workflow_state: { display_status: string; primary_stage_name: string | null } | null }>;
  }>("/approvals");
  return [
    inbox.sign_offs.map((item) => ({ id: item.id, approvalRuleId: item.approval_rule_id, episodeId: item.episode_id, showId: item.show_id, workflowStageId: item.workflow_stage_id, stageName: item.stage_name, stagePosition: item.stage_position, signOffLabel: item.sign_off_label, approverRole: item.approver_role, approvalOrder: item.approval_order, isRequired: item.is_required, passedAt: item.passed_at ? new Date(item.passed_at) : null, showTitle: item.show_title, episodeTitle: item.episode_title, episodeNumber: item.episode_number })),
    inbox.work_orders.map((item) => ({ id: item.id, episodeId: item.episode_id, showId: item.show_id, showTitle: item.show_title, episodeTitle: item.episode_title, episodeNumber: item.episode_number, workflowStageName: item.workflow_stage_name, kind: item.kind, title: item.title, description: item.description, priority: item.priority, isBlocking: item.is_blocking, status: item.status, dueAt: item.due_at ? new Date(item.due_at) : null, externalUrl: item.external_url, workflowState: item.workflow_state ? { displayStatus: item.workflow_state.display_status, primaryStageName: item.workflow_state.primary_stage_name } : null })),
    inbox.has_workspace,
  ] as const;
}

type ApiMyTimeBooking = {
  id: string; title: string; starts_at: string; ends_at: string; actual_starts_at: string | null; actual_ends_at: string | null; approved_overtime_minutes: number; room_name: string | null; episode_title: string | null; episode_production_code: string | null;
};

async function loadMyTimeBookings(): Promise<MyTimeBooking[]> {
  const now = new Date();
  const from = new Date(now.getTime() - 60 * 86_400_000);
  const to = new Date(now.getTime() + 30 * 86_400_000);
  const response = await postpilotApiServerFetch<{ bookings: ApiMyTimeBooking[] }>(`/bookings?from_at=${encodeURIComponent(from.toISOString())}&to_at=${encodeURIComponent(to.toISOString())}`);
  return response.bookings.map((booking) => ({
    id: booking.id,
    title: booking.title,
    startsAt: new Date(booking.starts_at),
    endsAt: new Date(booking.ends_at),
    actualStartsAt: booking.actual_starts_at ? new Date(booking.actual_starts_at) : null,
    actualEndsAt: booking.actual_ends_at ? new Date(booking.actual_ends_at) : null,
    approvedOvertimeMinutes: booking.approved_overtime_minutes,
    roomName: booking.room_name,
    episodeTitle: booking.episode_title,
    episodeProductionCode: booking.episode_production_code,
    timeStatus: booking.actual_starts_at ? "confirmed" : "ready",
  }));
}
