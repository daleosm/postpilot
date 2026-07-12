import { cookies } from "next/headers";

export const DEBUG_REVIEW_APPROVALS_COOKIE = "postpilot.debugReviewApprovals";
type ApprovalStatus = "approved" | "changes_requested";

export function parseDebugReviewApprovals(value?: string) {
  try {
    const parsed = JSON.parse(value ? decodeURIComponent(value) : "{}");
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ApprovalStatus] => entry[1] === "approved" || entry[1] === "changes_requested"));
  } catch {
    return {} as Record<string, ApprovalStatus>;
  }
}

export async function getDebugReviewApprovals() {
  const store = await cookies();
  return parseDebugReviewApprovals(store.get(DEBUG_REVIEW_APPROVALS_COOKIE)?.value);
}

export function withDebugApproval<T extends { id: string; status: string; approvalStatus: string }>(cut: T, approvals: Record<string, ApprovalStatus>): T {
  const approvalStatus = approvals[cut.id];
  return approvalStatus ? { ...cut, approvalStatus, status: approvalStatus } : cut;
}
