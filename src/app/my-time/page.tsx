import { MyTimeBoard } from "@/components/my-time-board";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";
import { canRecordBookingActuals, roleHome } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function MyTimePage() {
  if (!(await canRecordBookingActuals())) redirect(await roleHome());
  const context = await getActiveOrganizationContext();
  if (!context?.organization || !context.person) redirect(await roleHome());
  const now = new Date();
  const from = new Date(now.getTime() - 60 * 86_400_000);
  const to = new Date(now.getTime() + 30 * 86_400_000);
  const bookings = (await postpilotApiServerFetch<{ bookings: ApiMyTimeBooking[] }>(`/bookings?from_at=${encodeURIComponent(from.toISOString())}&to_at=${encodeURIComponent(to.toISOString())}`)).bookings.map((booking) => ({
      id: booking.id, title: booking.title, startsAt: new Date(booking.starts_at), endsAt: new Date(booking.ends_at), actualStartsAt: booking.actual_starts_at ? new Date(booking.actual_starts_at) : null, actualEndsAt: booking.actual_ends_at ? new Date(booking.actual_ends_at) : null, approvedOvertimeMinutes: booking.approved_overtime_minutes, setupMinutes: booking.setup_minutes, handoverMinutes: booking.handover_minutes, isOption: booking.is_option, optionRank: booking.option_rank, status: booking.status, bookingType: booking.booking_type, roomId: booking.room_id, episodeId: booking.episode_id, personId: booking.person_id, guestPersonId: booking.guest_person_id, notes: booking.notes, roomName: booking.room_name, roomType: booking.room_type, episodeTitle: booking.episode_title, episodeNumber: booking.episode_number, episodeProductionCode: booking.episode_production_code, personName: booking.person_name, workflowState: booking.workflow_state ? { displayStatus: booking.workflow_state.display_status, primaryStageName: booking.workflow_state.primary_stage_name } : null, timeStatus: booking.actual_starts_at ? "confirmed" as const : "ready" as const,
    }));

  return <div className="space-y-5 pb-6">
    <header>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Personal time confirmation · {context.organization.organizationName}</p>
      <h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">My time</h1>
      <p className="mt-1 max-w-2xl text-sm text-[#747977]">Confirm the actual time you worked. Confirmed time updates operational cost and billing immediately.</p>
    </header>
    <MyTimeBoard bookings={bookings} />
  </div>;
}

type ApiMyTimeBooking = {
  id: string; title: string; starts_at: string; ends_at: string; actual_starts_at: string | null; actual_ends_at: string | null; approved_overtime_minutes: number; setup_minutes: number; handover_minutes: number; is_option: boolean; option_rank: number | null; status: string; booking_type: string; room_id: string | null; episode_id: string | null; person_id: string | null; guest_person_id: string | null; notes: string | null; room_name: string | null; room_type: string | null; episode_title: string | null; episode_number: number | null; episode_production_code: string | null; person_name: string | null; workflow_state: { display_status: string; primary_stage_name: string | null } | null;
};
