import { MyTimeBoard } from "@/components/my-time-board";
import { getActiveOrganizationContext } from "@/lib/organizations";
import { canRecordBookingActuals, roleHome } from "@/lib/permissions";
import { listMyTimeBookings } from "@/server/data";
import { redirect } from "next/navigation";

export default async function MyTimePage() {
  if (!(await canRecordBookingActuals())) redirect(await roleHome());
  const context = await getActiveOrganizationContext();
  if (!context?.organization || !context.person) redirect(await roleHome());
  const now = new Date();
  const from = new Date(now.getTime() - 60 * 86_400_000);
  const to = new Date(now.getTime() + 30 * 86_400_000);
  const bookings = await listMyTimeBookings(context.organization.organizationId, context.person.id, from, to);

  return <div className="space-y-5 pb-6">
    <header>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Personal time confirmation · {context.organization.organizationName}</p>
      <h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">My time</h1>
      <p className="mt-1 max-w-2xl text-sm text-[#747977]">Confirm the actual time you worked. Confirmed time updates operational cost and billing immediately.</p>
    </header>
    <MyTimeBoard bookings={bookings} />
  </div>;
}
