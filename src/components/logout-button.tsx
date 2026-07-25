"use client";

import { LogOut } from "lucide-react";
import { Button } from "@heroui/react";

import { postpilotApiFetch } from "@/lib/postpilot-api-client";

export function LogoutButton() {
  async function logout() {
    await postpilotApiFetch<void>("/auth/sign-out", { method: "POST" }).catch(() => undefined);
    window.location.assign("/sign-in");
  }

  return <Button variant="tertiary" onPress={logout} className="mt-2 flex h-8 w-full justify-start gap-3 px-3 text-[12px] text-[#7b7f7d] hover:bg-[#f0f1ee] hover:text-[#353a39]"><LogOut size={15} /> Sign out</Button>;
}
