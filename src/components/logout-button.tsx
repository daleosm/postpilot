"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@heroui/react";

export function LogoutButton() {
  async function logout() {
    // This is a no-op outside debug mode. In debug it prevents the implicit
    // demo actor from restoring access after Auth.js signs out.
    await fetch("/api/debug/user", { method: "DELETE" });
    await signOut({ callbackUrl: "/sign-in" });
  }

  return <Button variant="tertiary" onPress={logout} className="mt-2 flex h-8 w-full justify-start gap-3 px-3 text-[12px] text-[#7b7f7d] hover:bg-[#f0f1ee] hover:text-[#353a39]"><LogOut size={15} /> Sign out</Button>;
}
