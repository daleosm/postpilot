"use client";

import { Button } from "@heroui/react";
import { Bell, Building2, Check, ChevronDown, LoaderCircle, Search, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { DebugUser } from "@/lib/debug-users";
import type { OrganizationMembership } from "@/lib/organization-data";
import type { ActiveShow } from "@/lib/organizations";

type TopBarProps = {
  debugUser: DebugUser | null;
  debugUsers: DebugUser[];
  debugMode: boolean;
  activeOrganization: OrganizationMembership | null;
  organizations: OrganizationMembership[];
  shows: Array<{ id: string; title: string }>;
  activeShow: ActiveShow | null;
};

export function TopBar({ debugUser, debugUsers, debugMode, activeOrganization, organizations, shows, activeShow }: TopBarProps) {
  const [selectedShowId, setSelectedShowId] = useState(activeShow?.id ?? null);
  const [showOpen, setShowOpen] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [switchingOrganizationId, setSwitchingOrganizationId] = useState<string | null>(null);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(activeOrganization?.organizationId ?? null);
  const [userOpen, setUserOpen] = useState(false);
  const [activeDebugUser, setActiveDebugUser] = useState(debugUser);
  const showRef = useRef<HTMLDivElement>(null);
  const organizationRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const selectedOrganization = organizations.find((organization) => organization.organizationId === selectedOrganizationId) ?? activeOrganization;
  const organizationName = selectedOrganization?.organizationName ?? "No post house";
  const selectedShow = shows.find((show) => show.id === selectedShowId) ?? null;
  const activeShowName = selectedShow?.title ?? "All shows";
  const tenantDebugUsers = debugUsers;
  const canSwitchOrganizations = organizations.length > 1;
  const hasDebugControls = debugMode && activeDebugUser;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!showRef.current?.contains(target)) setShowOpen(false);
      if (!organizationRef.current?.contains(target)) setOrganizationOpen(false);
      if (!userRef.current?.contains(target)) setUserOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function chooseShow(showId: string | null) {
    const previousShowId = selectedShowId;
    setSelectedShowId(showId);
    setShowError(null);
    setShowOpen(false);
    try {
      const response = await fetch("/api/active-show", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "Could not select this show.");
      }
      router.refresh();
    } catch (error) {
      setSelectedShowId(previousShowId);
      setShowError(error instanceof Error ? error.message : "Could not select this show.");
    }
  }

  async function chooseOrganization(organization: OrganizationMembership) {
    if (organization.organizationId === selectedOrganization?.organizationId || switchingOrganizationId) {
      setOrganizationOpen(false);
      return;
    }

    setOrganizationError(null);
    setSwitchingOrganizationId(organization.organizationId);
    try {
      const response = await fetch("/api/organizations/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: organization.organizationId, pathname }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.redirectTo) {
        throw new Error(result.error ?? "Could not switch post houses. Please try again.");
      }

      setSelectedOrganizationId(organization.organizationId);
      setSelectedShowId(null);
      setShowOpen(false);
      setOrganizationOpen(false);
      // Tenant context is read by server components all the way up to the
      // persistent root layout. Reload after the cookie is confirmed so no
      // tenant-scoped screen can retain stale RSC data from the prior tenant.
      window.location.assign(result.redirectTo);
    } catch (error) {
      setOrganizationError(error instanceof Error ? error.message : "Could not switch post houses. Please try again.");
    } finally {
      setSwitchingOrganizationId(null);
    }
  }

  async function chooseDebugUser(user: DebugUser) {
    const response = await fetch("/api/debug/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.userId }),
    });
    if (response.ok) {
      setActiveDebugUser(user);
      setUserOpen(false);
      // The selected identity changes the server context, sidebar, and route
      // permissions. A full refresh avoids retaining a cached root layout.
      window.location.reload();
    }
  }

  return (
    <header className="sticky top-0 z-10 flex h-[60px] items-center justify-between gap-2 border-b border-[#e6e5e1] bg-[#fbfbf9]/95 px-3 backdrop-blur-sm sm:gap-3 sm:px-6 lg:h-[66px] lg:px-8">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="relative min-w-0" ref={organizationRef}>
          {canSwitchOrganizations ? (
            <Button
              variant="tertiary"
              onClick={() => {
                setOrganizationError(null);
                setOrganizationOpen((value) => !value);
              }}
              isDisabled={Boolean(switchingOrganizationId)}
              className={`flex h-8 w-[120px] min-w-0 max-w-[120px] items-center gap-2 border px-2.5 text-xs font-medium shadow-sm sm:w-auto sm:max-w-[250px] ${debugMode ? "border-[#e6c98a] bg-[#fff9ed] text-[#765720] hover:bg-[#fff2d6]" : "border-[#e3e4df] bg-white text-[#434946] hover:bg-[#f1f3f0]"}`}
              aria-label={debugMode ? "Switch debug tenant" : "Switch post house"}
              aria-expanded={organizationOpen}
            >
              {switchingOrganizationId ? <LoaderCircle size={14} className="shrink-0 animate-spin text-[#8a6727]" /> : <Building2 size={14} className={`shrink-0 ${debugMode ? "text-[#9a7124]" : "text-[#68706c]"}`} />}
              <span className="truncate">{debugMode ? `Debug tenant · ${organizationName}` : organizationName}</span>
              <ChevronDown size={14} className={`shrink-0 text-[#8b8f8d] transition ${organizationOpen ? "rotate-180" : ""}`} />
            </Button>
          ) : (
            <div className={`flex h-8 w-[120px] max-w-[120px] items-center gap-2 rounded-md border px-2.5 text-xs font-medium sm:w-auto sm:max-w-[250px] ${debugMode ? "border-[#ead39f] bg-[#fff9ed] text-[#765720]" : "border-[#e7e7e2] bg-[#f6f6f3] text-[#59605d]"}`} title={organizationName}>
              <Building2 size={14} className={`shrink-0 ${debugMode ? "text-[#9a7124]" : "text-[#747a77]"}`} />
              <span className="truncate">{debugMode ? `Debug tenant · ${organizationName}` : organizationName}</span>
            </div>
          )}
          {organizationOpen && (
            <div className="absolute left-0 top-10 z-30 w-[min(19rem,calc(100vw-2rem))] rounded-lg border border-[#e1e2de] bg-white p-1 shadow-lg">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[.08em] text-[#8a8e8c]">{debugMode ? "Debug tenants" : "Post houses"}</p>
              {organizations.map((organization) => {
                const active = organization.organizationId === selectedOrganization?.organizationId;
                const switching = organization.organizationId === switchingOrganizationId;
                return (
                  <Button
                    key={organization.organizationId}
                    variant="tertiary"
                    onClick={() => chooseOrganization(organization)}
                    isDisabled={Boolean(switchingOrganizationId)}
                    className="flex h-auto min-h-11 w-full justify-between gap-3 rounded-md px-3 py-2 text-left text-xs text-[#4f5753] hover:bg-[#f1f3f0]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{organization.organizationName}</span>
                      <span className="block truncate pt-0.5 text-[10px] text-[#898e8a]">{organization.role} access</span>
                    </span>
                    {switching ? <LoaderCircle size={14} className="shrink-0 animate-spin text-[#50786d]" /> : active ? <Check size={14} className="shrink-0 text-[#50786d]" /> : null}
                  </Button>
                );
              })}
              <p className="border-t border-[#efefeb] px-3 pb-2 pt-2 text-[10px] leading-4 text-[#858a87]" role="status">
                {debugMode ? "Debug tenant only. The selected debug user is retained and all data remains in PostgreSQL." : "Switching changes the workspace and refreshes its tenant-scoped data."}
              </p>
            </div>
          )}
          {organizationError && <p className="absolute left-0 top-10 z-40 mt-1 w-64 rounded-md border border-[#e7c5bd] bg-[#fff8f5] px-2.5 py-2 text-[11px] leading-4 text-[#a44e3b] shadow-sm" role="alert">{organizationError}</p>}
        </div>

        <div className="relative hidden sm:block" ref={showRef}>
          <Button variant="tertiary" onClick={() => { setShowError(null); setShowOpen((value) => !value); }} className="flex h-8 max-w-[160px] min-w-0 items-center gap-1.5 px-2 py-1 text-xs font-medium text-[#626865] hover:bg-[#f0f0ed]">
            <span className="truncate">{activeShowName}</span>
            <ChevronDown size={14} className={`shrink-0 text-[#8b8f8d] transition ${showOpen ? "rotate-180" : ""}`} />
          </Button>
          {showOpen && <div className="absolute left-0 top-10 z-30 w-52 rounded-lg border border-[#e1e2de] bg-white p-1 shadow-lg"><Button variant="tertiary" onClick={() => chooseShow(null)} className="flex h-auto w-full justify-between rounded-md px-3 py-2 text-left text-xs text-[#4f5753] hover:bg-[#f1f3f0]"><span>All shows</span>{!selectedShowId && <Check size={14} className="text-[#50786d]" />}</Button>{shows.map((show) => <Button key={show.id} variant="tertiary" onClick={() => chooseShow(show.id)} className="flex h-auto w-full justify-between rounded-md px-3 py-2 text-left text-xs text-[#4f5753] hover:bg-[#f1f3f0]"><span className="truncate">{show.title}</span>{selectedShowId === show.id && <Check size={14} className="text-[#50786d]" />}</Button>)}</div>}
          {showError && <p className="absolute left-0 top-10 z-40 mt-1 w-64 rounded-md border border-[#e7c5bd] bg-[#fff8f5] px-2.5 py-2 text-[11px] leading-4 text-[#a44e3b] shadow-sm" role="alert">{showError}</p>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {hasDebugControls && <div className="relative" ref={userRef}><Button variant="tertiary" onClick={() => setUserOpen((value) => !value)} aria-label="Switch debug user" className="flex h-8 w-[76px] min-w-0 max-w-[76px] gap-1.5 border border-[#e6c98a] bg-[#fff9ed] px-2 text-xs text-[#765720] hover:bg-[#fff2d6] sm:w-auto sm:max-w-[190px]"><UserRound size={14} className="shrink-0" /><span className="font-semibold sm:hidden">User</span><span className="hidden font-semibold uppercase tracking-[.08em] sm:inline">Debug</span><span className="hidden truncate sm:inline">{activeDebugUser.name}</span><ChevronDown size={13} className="shrink-0" /></Button>{userOpen && <div className="absolute right-0 top-10 z-30 w-60 overflow-hidden rounded-lg border border-[#e1c986] bg-[#fffdf8] p-1 shadow-lg"><p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[.08em] text-[#8b6721]">Debug user / role</p><p className="px-3 pb-2 text-[10px] leading-4 text-[#8a7a58]">Every user in this post house is available. Maya is the platform admin across tenants.</p><div className="max-h-[calc(100vh-9rem)] overflow-y-auto overscroll-contain">{tenantDebugUsers.map((user) => <Button key={user.id} variant="tertiary" onClick={() => chooseDebugUser(user)} className="flex h-auto w-full justify-between rounded-md px-3 py-2 text-left text-xs text-[#4f5753] hover:bg-[#fff3dc]"><span><span className="block font-medium">{user.name}</span><span className="block text-[10px] text-[#898e8a]">{user.label}</span></span>{activeDebugUser.userId === user.userId && <Check size={14} className="text-[#8a6727]" />}</Button>)}{!tenantDebugUsers.length && <p className="px-3 py-4 text-xs text-[#8a7a58]">No tenant users are available.</p>}</div></div>}</div>}
        <Button variant="tertiary" className="hidden h-8 w-[218px] justify-start gap-2 border border-[#e6e5e1] bg-white px-2.5 text-left text-xs text-[#969a97] shadow-sm lg:flex"><Search size={14} /> Search <kbd className="ml-auto rounded border border-[#e8e7e3] bg-[#fafaf9] px-1 py-0.5 text-[9px] text-[#9da09e]">⌘ K</kbd></Button>
        <Button isIconOnly variant="tertiary" aria-label="Notifications" className="relative h-8 min-w-0 w-8 text-[#747a77] hover:bg-[#f0f0ed]"><Bell size={17} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#c77c49] ring-2 ring-[#fbfbf9]" /></Button>
      </div>
    </header>
  );
}
