import { BookingFormDialog } from "@/components/booking-form-dialog";
import { CopyEpisodeBookingsDialog } from "@/components/copy-episode-bookings-dialog";
import { PageHeader } from "@/components/operations-ui";
import { ScheduleBoard } from "@/components/schedule-board";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";
import { can, canManageBookings, canRecordBookingActuals, canViewAllOperations, roleHome } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ workOrder?: string; booking?: string }> }) {
  const [mayManage, maySubmitOwnTime, mayViewAll, mayManageCommercial, mayApproveCommercialOverrides] = await Promise.all([canManageBookings(), canRecordBookingActuals(), canViewAllOperations(), can("manage_commercial"), can("approve_booking_price_overrides")]);
  if (!mayManage && !maySubmitOwnTime && !mayViewAll) redirect(await roleHome());
  const context = await getActiveOrganizationContext();
  const data = await getScheduleData(mayManageCommercial, mayApproveCommercialOverrides);
  const { workOrder: requestedWorkOrderId, booking: requestedBookingId } = await searchParams;
  const initialStart = inputDate(new Date());
  return <div className="pp-page"><PageHeader eyebrow={`Post floor calendar · ${data.organizationName}`} title="Bookings" description="Edit bays, colour, mix, QC, artist assignments, and episode-linked work." metrics={[{ label: "Bookings", value: data.bookings.length }, { label: "Rooms", value: data.resources.rooms.length }, { label: "Option holds", value: data.bookings.filter((booking) => booking.isOption).length, tone: "warning" }]} action={mayManage ? <div className="flex flex-wrap gap-2"><CopyEpisodeBookingsDialog resources={data.resources} initialStart={initialStart} /><BookingFormDialog resources={data.resources} initialStart={initialStart} /></div> : undefined} /><ScheduleBoard bookings={data.bookings} rooms={data.resources.rooms} resources={data.resources} cateringRequests={data.cateringRequests} workOrders={data.workOrders} initialDate={new Date().toISOString()} initialWorkOrderId={requestedWorkOrderId ?? null} initialBookingId={requestedBookingId ?? null} canManage={mayManage} canSubmitOwnTime={maySubmitOwnTime} currentPersonId={context?.person?.id ?? null} /></div>;
}

async function getScheduleData(canManageCommercial: boolean, canApproveCommercialOverrides: boolean) {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return { organizationName: "No workspace", bookings: [], resources: { rooms: [], people: [], guestAccounts: [], episodes: [], budgetItems: [], canManageCommercial: false, canApproveCommercialOverrides: false }, cateringRequests: [], workOrders: [] };
  const from = new Date(Date.now() - 60 * 86_400_000); const to = new Date(Date.now() + 90 * 86_400_000);
  const query = `?from_at=${encodeURIComponent(from.toISOString())}&to_at=${encodeURIComponent(to.toISOString())}`;
    const [schedule, resources, catering, inbox] = await Promise.all([
      postpilotApiServerFetch<{ bookings: ApiBooking[] }>(`/bookings${query}`),
      postpilotApiServerFetch<ApiBookingResources>("/bookings/resources"),
      postpilotApiServerFetch<ApiCateringRequest[]>("/catering-requests"),
      postpilotApiServerFetch<{ work_orders: ApiWorkOrder[] }>("/work-orders/inbox"),
    ]);
  return {
      organizationName: context.organization.organizationName,
      bookings: schedule.bookings.map(mapBooking),
      resources: {
        rooms: resources.rooms,
        people: resources.people.map((person) => ({ ...person, isFreelancer: person.is_freelancer })),
        guestAccounts: resources.guest_accounts,
        episodes: resources.episodes,
        budgetItems: resources.budget_items.map((item) => ({ id: item.id, episodeId: item.episode_id, label: item.label, hasRateSnapshot: item.has_rate_snapshot })),
        canManageCommercial,
        canApproveCommercialOverrides,
      },
      cateringRequests: catering.map((request) => ({
        id: request.id,
        bookingId: request.booking_id,
        requestedByPersonId: request.requested_by_person_id,
        requestType: request.request_type,
        item: request.item,
        requestedFor: request.requested_for ? new Date(request.requested_for) : null,
        status: request.status,
      })),
      workOrders: inbox.work_orders.map((workOrder) => ({
        id: workOrder.id,
        title: workOrder.title,
        showTitle: workOrder.show_title,
        episodeTitle: workOrder.episode_title,
        episodeNumber: workOrder.episode_number,
        workflowStageName: workOrder.workflow_stage_name,
        dueAt: workOrder.due_at ? new Date(workOrder.due_at) : null,
        commercialTreatment: workOrder.commercial_treatment,
        bookingId: workOrder.booking_id,
        workType: workOrder.work_type,
        assigneePersonId: workOrder.assignee_person_id,
        status: workOrder.status,
      })),
  };
}

type ApiBooking = {
  id: string; title: string; starts_at: string; ends_at: string; actual_starts_at: string | null; actual_ends_at: string | null;
  approved_overtime_minutes: number; setup_minutes: number; handover_minutes: number; is_option: boolean; option_rank: number | null;
  status: string; booking_type: string; commercial_treatment: "wet_hire" | "dry_hire" | "flat_project_fee" | null; client_quote_amount: number | null; room_id: string | null; episode_id: string | null; budget_line_id: string | null; person_id: string | null; guest_person_id: string | null;
  notes: string | null; work_order_id: string | null; room_name: string | null; room_type: string | null; episode_title: string | null; episode_number: number | null;
  episode_production_code: string | null; person_name: string | null; actual_budget_status: "not_submitted" | "allocated" | "unallocated"; budget_item_label: string | null; budget_item: { id: string; label: string } | null; budget_item_context?: { estimated_amount: number; actual_amount: number; remaining_estimate: number; currency: string } | null; workflow_state: { display_status: string; primary_stage_name: string | null } | null;
};
type ApiBookingResources = {
  can_manage_commercial: boolean;
  can_approve_commercial_overrides: boolean;
  rooms: Array<{ id: string; name: string; type: string }>;
  people: Array<{ id: string; name: string; role: string; availability: string; is_freelancer: boolean }>;
  guest_accounts: Array<{ id: string; name: string; role: string; email: string | null }>;
  episodes: Array<{ id: string; label: string }>;
  budget_items: Array<{ id: string; episode_id: string; label: string; has_rate_snapshot: boolean }>;
};
type ApiCateringRequest = { id: string; booking_id: string | null; requested_by_person_id: string | null; request_type: string; item: string; requested_for: string | null; status: string };
type ApiWorkOrder = { id: string; title: string; show_title: string; episode_title: string; episode_number: number; workflow_stage_name: string | null; due_at: string | null; booking_id: string | null; work_type: string; assignee_person_id: string | null; status: string; commercial_treatment: "wet_hire" | "dry_hire" | "flat_project_fee" };
function mapBooking(booking: ApiBooking) { return { id: booking.id, title: booking.title, startsAt: new Date(booking.starts_at), endsAt: new Date(booking.ends_at), actualStartsAt: booking.actual_starts_at ? new Date(booking.actual_starts_at) : null, actualEndsAt: booking.actual_ends_at ? new Date(booking.actual_ends_at) : null, approvedOvertimeMinutes: booking.approved_overtime_minutes, setupMinutes: booking.setup_minutes, handoverMinutes: booking.handover_minutes, isOption: booking.is_option, optionRank: booking.option_rank, status: booking.status, bookingType: booking.booking_type, commercialTreatment: booking.commercial_treatment, clientQuoteAmount: booking.client_quote_amount, roomId: booking.room_id, episodeId: booking.episode_id, budgetLineId: booking.budget_line_id, personId: booking.person_id, guestPersonId: booking.guest_person_id, notes: booking.notes, workOrderId: booking.work_order_id, roomName: booking.room_name, roomType: booking.room_type, episodeTitle: booking.episode_title, episodeNumber: booking.episode_number, episodeProductionCode: booking.episode_production_code, personName: booking.person_name, actualBudgetStatus: booking.actual_budget_status, budgetItemLabel: booking.budget_item_label, budgetItem: booking.budget_item, budgetItemContext: booking.budget_item_context ? { estimatedAmount: booking.budget_item_context.estimated_amount, actualAmount: booking.budget_item_context.actual_amount, remainingEstimate: booking.budget_item_context.remaining_estimate, currency: booking.budget_item_context.currency } : null, workflowState: booking.workflow_state ? { displayStatus: booking.workflow_state.display_status, primaryStageName: booking.workflow_state.primary_stage_name } : null }; }

function inputDate(date: Date) { const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00`; }
