import "next-auth";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    activeOrganizationId: string | null;
    organizations: Array<{
      organizationId: string;
      organizationName: string;
      organizationSlug: string;
      role: "owner" | "admin" | "member" | "guest";
    }>;
    user: {
      id: string;
    } & NonNullable<DefaultSession["user"]>;
  }
}
