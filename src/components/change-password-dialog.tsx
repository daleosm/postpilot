"use client";

import { Button } from "@heroui/react";
import { KeyRound, X } from "lucide-react";
import { useState } from "react";

import { postpilotUiFetch } from "@/lib/postpilot-api-client";

export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function close() {
    if (saving) return;
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setMessage("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (newPassword.length < 8) return setMessage("Use at least 8 characters for your new password.");
    if (newPassword !== confirmation) return setMessage("Passwords do not match.");
    setSaving(true);
    try {
      const response = await postpilotUiFetch("/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
        return setMessage(body?.error ?? "Could not change your password.");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setMessage("Password updated. Other sessions have been signed out.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <Button variant="tertiary" size="sm" onPress={() => setOpen(true)} className="hidden h-8 gap-1.5 px-2 text-xs text-[#626865] hover:bg-[#f0f0ed] sm:flex">
      <KeyRound size={14} /> Password
    </Button>
    {open && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#202725]/35 p-4" role="dialog" aria-modal="true" aria-label="Change password">
      <div className="w-full max-w-md rounded-xl border border-[#e2e3de] bg-[#fafbf9] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold text-[#2d3431]">Change password</h2><p className="mt-1 text-sm text-[#767c78]">Your other signed-in sessions will be ended.</p></div>
          <Button isIconOnly variant="tertiary" onPress={close} isDisabled={saving} aria-label="Close password form"><X size={18} /></Button>
        </div>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordField label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" hint="Use at least 8 characters." />
          <PasswordField label="Confirm new password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
          {message && <p role="alert" className={`text-xs ${message.startsWith("Password updated") ? "text-[#4d8068]" : "text-[#a35e41]"}`}>{message}</p>}
          <div className="flex justify-end gap-2 border-t border-[#ecebe7] pt-4"><Button type="button" variant="tertiary" onPress={close} isDisabled={saving}>Cancel</Button><Button type="submit" variant="primary" isDisabled={saving} className="bg-[#263130] text-white">{saving ? "Updating…" : "Update password"}</Button></div>
        </form>
      </div>
    </div>}
  </>;
}

function PasswordField({ label, value, onChange, autoComplete, hint }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; hint?: string }) {
  return <label className="block text-xs font-medium text-[#535b57]">{label}<input aria-label={label} required type="password" value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} className="mt-1.5 h-10 w-full rounded-md border border-[#dedfda] bg-[#fafbf9] px-3 text-sm outline-none focus:border-[#63877f] focus:ring-2 focus:ring-[#dce9e4]" />{hint && <span className="mt-1 block text-[11px] font-normal text-[#747e79]">{hint}</span>}</label>;
}
