import { ChevronRight, FileCheck2, MessageSquareText } from "lucide-react";
import Link from "next/link";

import { WorkflowSignOffQueue } from "@/components/workflow-approval-queue";
import { getActiveOrganizationContext, getActiveShow } from "@/lib/organizations";
import { isDebugDemoMode } from "@/lib/runtime";
import { can, getCurrentPerson, roleHome } from "@/lib/permissions";
import { listReviewQueueForUser, listWorkflowSignOffInbox } from "@/server/data";
import { redirect } from "next/navigation";

type ReviewItem = {
  id: string;
  title: string;
  version: number;
  status: string;
  approvalStatus: string;
  dueAt: Date | null;
  showId: string;
  showTitle: string;
  episodeTitle: string;
  episodeNumber: number;
  openNoteCount: number;
};

export default async function ReviewPage() {
  const [mayManage, mayApprove, mayAddNotes, person] = await Promise.all([can("manage_reviews"), can("approve_reviews"), can("update_notes"), getCurrentPerson()]);
  if (!(mayManage || mayApprove || mayAddNotes)) redirect(roleHome(person?.role));
  const activeShow = await getActiveShow();
  const [reviewData, context] = await Promise.all([getReviewData(), getActiveOrganizationContext()]);
  const { organizationName, items } = reviewData;
  const reviewItems = activeShow ? items.filter((item) => item.showId === activeShow.id) : items;
  const signOffs = context?.organization ? await listWorkflowSignOffInbox(context.organization.organizationId, context.userId) : [];
  const visibleSignOffs = activeShow ? signOffs.filter((item) => item.showId === activeShow.id) : signOffs;

  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#7c827f]">Review items · {organizationName}</p>
          <h1 className="mt-2 text-[27px] font-semibold tracking-[-0.045em] text-[#202524]">Review</h1>
          <p className="mt-1 text-sm text-[#747977]">Open a review item to add, resolve, and track feedback.</p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-medium text-[#5e746c]"><FileCheck2 size={15} /> {reviewItems.length} item{reviewItems.length === 1 ? "" : "s"}</span>
      </header>

      <WorkflowSignOffQueue signOffs={visibleSignOffs} canOpenEpisodes={mayManage} />

      <section className="panel overflow-hidden">
        <div className="border-b border-[#ebeae6] px-5 py-4">
          <h2 className="text-sm font-semibold text-[#343b38]">Review items</h2>
          <p className="mt-1 text-xs text-[#858a87]">Select an item to view its notes and record your feedback.</p>
        </div>
        <div className="divide-y divide-[#efeeea]">
          {reviewItems.map((item) => <ReviewItemRow key={item.id} item={item} />)}
          {!reviewItems.length && <p className="px-5 py-10 text-center text-sm text-[#858a87]">No review items are available for this show.</p>}
        </div>
      </section>
    </div>
  );
}

function ReviewItemRow({ item }: { item: ReviewItem }) {
  return (
    <Link href={`/review/${item.id}`} className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-[#fafbf9]">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-[#617b75]">{item.showTitle} · E{String(item.episodeNumber).padStart(2, "0")} {item.episodeTitle}</p>
        <h3 className="mt-1 truncate text-sm font-semibold text-[#3c4440]">{item.title} <span className="font-normal text-[#7a827e]">· v{item.version}</span></h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#747b77]">
          <span className="capitalize">{item.approvalStatus.replaceAll("_", " ")}</span>
          <span>Due {formatDate(item.dueAt)}</span>
          <span className="inline-flex items-center gap-1"><MessageSquareText size={13} /> {item.openNoteCount} open note{item.openNoteCount === 1 ? "" : "s"}</span>
        </div>
      </div>
      <ChevronRight size={18} className="shrink-0 text-[#9aa09c] transition-transform group-hover:translate-x-0.5 group-hover:text-[#5c746b]" />
    </Link>
  );
}

async function getReviewData(): Promise<{ organizationName: string; items: ReviewItem[] }> {
  if (isDebugDemoMode) {
    const demo = demoReviewData();
    return { organizationName: demo.organizationName, items: demo.cuts.map((item) => ({ ...item, status: item.status, openNoteCount: item.approvalStatus === "approved" ? 0 : 1 })) };
  }
  const context = await getActiveOrganizationContext();
  if (!context?.organization) return { organizationName: "No workspace", items: [] };
  return {
    organizationName: context.organization.organizationName,
    items: await listReviewQueueForUser(context.organization.organizationId, context.userId),
  };
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric" }).format(value);
}

/** Shared by the existing review item detail route while debug mode is enabled. */
export function demoReviewData() {
  const now = new Date();
  return {
    organizationName: "Northstar Post · Demo workspace",
    cuts: [
      { id: "demo-cut-1", title: "SN101 Director’s cut", version: 3, runtimeSeconds: "2640.000", status: "in_review", approvalStatus: "pending", dueAt: new Date(now.getTime() + 24 * 3_600_000), episodeId: "demo-e1", episodeTitle: "The Quiet Hour", episodeNumber: 1, showId: "demo-signal-north", showTitle: "Signal North" },
      { id: "demo-cut-2", title: "SN102 Network review", version: 2, runtimeSeconds: "2618.000", status: "changes_requested", approvalStatus: "changes_requested", dueAt: new Date(now.getTime() + 36 * 3_600_000), episodeId: "demo-e2", episodeTitle: "Second Skin", episodeNumber: 2, showId: "demo-signal-north", showTitle: "Signal North" },
      { id: "demo-cut-3", title: "UC101 Director’s cut", version: 4, runtimeSeconds: "2702.000", status: "approved", approvalStatus: "approved", dueAt: new Date(now.getTime() - 12 * 3_600_000), episodeId: "demo-e5", episodeTitle: "The Undertow", episodeNumber: 1, showId: "demo-under-current", showTitle: "Under Current" },
    ],
  };
}
