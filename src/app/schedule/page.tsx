import { BookingFormDialog } from "@/components/booking-form-dialog";
import { CopyEpisodeBookingsDialog } from "@/components/copy-episode-bookings-dialog";
import { ScheduleBoard } from "@/components/schedule-board";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canApproveBookingTime, canManageBookings, canRecordBookingActuals, roleHome } from "@/lib/permissions";
import { getScheduleResources, listCateringRequests, listPendingBookingTimeSubmissions, listSchedule } from "@/server/data";
import { redirect } from "next/navigation";

export default async function SchedulePage() {
  const [mayManage, mayApproveTime, maySubmitOwnTime] = await Promise.all([canManageBookings(), canApproveBookingTime(), canRecordBookingActuals()]);
  if (!mayManage) {
    if (maySubmitOwnTime) redirect("/my-time");
    redirect(await roleHome());
  }
  const context = await getActiveOrganizationContext();
  const data = await getScheduleData();
  const initialStart = inputDate(new Date());
  return <div className="space-y-5"><header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Post floor calendar · {data.organizationName}</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Bookings</h1><p className="mt-1 text-sm text-[#747977]">Edit bays, color, mix, QC, artist assignments, and episode-linked work.</p></div><div className="flex flex-wrap gap-2"><CopyEpisodeBookingsDialog resources={data.resources} initialStart={initialStart} /><BookingFormDialog resources={data.resources} initialStart={initialStart} /></div></header><ScheduleBoard bookings={data.bookings} rooms={data.resources.rooms} resources={data.resources} cateringRequests={data.cateringRequests} pendingTimes={data.pendingTimes} initialDate={new Date().toISOString()} canManage={mayManage} canApproveTime={mayApproveTime} canSubmitOwnTime={maySubmitOwnTime} currentPersonId={context?.person?.id ?? null} /></div>;
}

async function getScheduleData() {
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return { organizationName: "No workspace", bookings: [], resources: { rooms: [], people: [], guestAccounts: [], guestRoles: [], episodes: [] }, cateringRequests: [], pendingTimes: [] };
  const from = new Date(Date.now() - 60 * 86_400_000); const to = new Date(Date.now() + 90 * 86_400_000);
  const [bookings, resources, cateringRequests, pendingTimes] = await Promise.all([listSchedule(context.organization.organizationId, from, to), getScheduleResources(context.organization.organizationId), listCateringRequests(context.organization.organizationId), listPendingBookingTimeSubmissions(context.organization.organizationId)]);
  return { organizationName: context.organization.organizationName, bookings, resources, cateringRequests, pendingTimes };
}

function inputDate(date: Date) { const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00`; }
