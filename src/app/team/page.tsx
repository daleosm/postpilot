import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";
import { PageHeader } from "@/components/operations-ui";
import { can, roleHome } from "@/lib/permissions";
import { redirect } from "next/navigation";
export default async function TeamPage(){if(!(await can("manage_shows")))redirect(await roleHome());const data=await load();const available=data.team.filter((person)=>person.availability==="available").length;return <div className="pp-page"><PageHeader eyebrow="People and capacity" title="Team" description="People, roles, availability, and workload for this post house." metrics={[{label:"People",value:data.team.length},{label:"Available",value:available,tone:"success"},{label:"Booked / away",value:data.team.length-available,tone:data.team.length-available?"warning":"default"}]}/><section className="panel overflow-hidden"><div className="grid grid-cols-[1.2fr_140px_120px_100px_120px_120px] gap-3 border-b bg-[#fafaf8] px-5 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#7e837f]"><span>Person</span><span>Role</span><span>Availability</span><span>Workload</span><span>Hourly</span><span>Organization</span></div><div className="divide-y">{data.team.map((person)=>{const hours=data.bookings.filter((b)=>b.personName===person.name).reduce((s,b)=>s+(b.endsAt.getTime()-b.startsAt.getTime())/3600000,0);return <div key={person.id} className="grid grid-cols-[1.2fr_140px_120px_100px_120px_120px] items-center gap-3 px-5 py-3.5"><span><b className="text-sm">{person.name}</b><small className="mt-1 block text-xs text-[#858a87]">{person.email??person.company??""}</small></span><span className="capitalize text-xs">{person.role.replaceAll("_"," ")}</span><span className={`w-fit rounded-full px-2 py-1 text-[10px] font-semibold ${person.availability==="available"?"bg-[#e8f1eb] text-[#4d8068]":"bg-[#f7e7df] text-[#a35f42]"}`}>{person.availability.replaceAll("_"," ")}</span><span className="text-xs font-medium">{hours.toFixed(0)}h</span><span className="text-xs">{person.hourlyRate?`$${Number(person.hourlyRate)}/hr`:"—"}</span><span className="capitalize text-xs">{person.organizationRole}</span></div>})}</div></section></div>}

async function load() {
  const now = new Date();
  const fromAt = now.toISOString();
  const toAt = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [resources, schedule] = await Promise.all([
    postpilotApiServerFetch<{ people: Array<{ id: string; name: string; email: string | null; company: string | null; role: string; availability: string; hourly_rate: number | null; organization_role: string | null }> }>("/bookings/resources"),
    postpilotApiServerFetch<{ bookings: Array<{ person_name: string | null; starts_at: string; ends_at: string }> }>(`/bookings?from_at=${encodeURIComponent(fromAt)}&to_at=${encodeURIComponent(toAt)}`),
  ]);
  return {
    team: resources.people.map((person) => ({ id: person.id, name: person.name, email: person.email, company: person.company, role: person.role, availability: person.availability, hourlyRate: person.hourly_rate, organizationRole: person.organization_role ?? "member" })),
    bookings: schedule.bookings.map((booking) => ({ personName: booking.person_name ?? "", startsAt: new Date(booking.starts_at), endsAt: new Date(booking.ends_at) })),
  };
}
