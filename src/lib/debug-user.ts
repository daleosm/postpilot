import "server-only";

import type { DebugUser } from "@/lib/debug-users";
import { getPostPilotApiSession, postpilotApiServerFetch } from "@/lib/postpilot-api-server";

/** FastAPI decides whether the current opaque session may impersonate a user. */
export async function canUseDebugUserSwitcher() {
  return (await getPostPilotApiSession())?.debug_can_switch ?? false;
}

export async function getDebugUser() {
  const session = await getPostPilotApiSession();
  if (!session?.debug_can_switch) return null;
  const role = session.person?.role ?? "member";
  return {
    id: session.user_id,
    userId: session.user_id,
    name: session.user_name ?? session.user_id,
    role,
    label: formatRole(role),
  };
}

export async function getDebugUserByUserId(userId: string): Promise<DebugUser | null> {
  const users = await listDebugUsersForOrganization();
  return users.find((user) => user.userId === userId) ?? null;
}

/** Every actual user returned by FastAPI is available to assume in debug mode. */
export async function listDebugUsersForOrganization(_organizationId?: string): Promise<DebugUser[]> {
  void _organizationId;
  const users = await postpilotApiServerFetch<Array<{ user_id: string; name: string; role: string; label: string }>>("/debug/users");
  return users.map((user) => ({ id: user.user_id, userId: user.user_id, name: user.name, role: user.role, label: user.label }));
}

function formatRole(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
