import type { Metadata } from "next";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { getDebugUser, listDebugUsersForOrganization } from "@/lib/debug-user";
import { getActiveOrganizationContext, getActiveShow } from "@/lib/organizations";
import { isDebugMode } from "@/lib/runtime";
import { listShowOptions } from "@/server/data/shows";

export const metadata: Metadata = {
  title: "PostPilot · Production operations",
  description: "Post-production operations for episodic television.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [debugUser, organizationContext] = await Promise.all([getDebugUser(), getActiveOrganizationContext()]);
  const activeOrganizationId = organizationContext?.organization?.organizationId;
  const [showOptions, activeShow, availableDebugUsers] = activeOrganizationId
    ? await Promise.all([
      listShowOptions(activeOrganizationId),
      getActiveShow(activeOrganizationId),
      isDebugMode ? listDebugUsersForOrganization(activeOrganizationId) : Promise.resolve([]),
    ])
    : [[], null, []];
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-[#f7f7f4] text-[#292d2d]">
          <AppSidebar />
          <div className="min-h-screen md:pl-[232px]">
            <TopBar
              key={activeOrganizationId ?? "no-active-organization"}
              debugUser={debugUser}
              debugUsers={availableDebugUsers}
              debugMode={isDebugMode}
              activeOrganization={organizationContext?.organization ?? null}
              organizations={organizationContext?.memberships ?? []}
              shows={showOptions}
              activeShow={activeShow}
            />
            <main className="mx-auto max-w-[1540px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
