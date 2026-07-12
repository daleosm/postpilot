"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@heroui/react";

export function DeliveryRequirementToggle({ requirement, isReadOnly = false }: { requirement: { id: string; label: string; isComplete: boolean }; isReadOnly?: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/delivery-requirements/${requirement.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isComplete: !requirement.isComplete }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(body?.error ?? "Could not update this requirement."); else router.refresh();
    } catch { setError("Could not update this requirement."); } finally { setSaving(false); }
  }
  const className = `h-auto min-h-0 justify-start rounded px-1.5 py-0.5 text-left text-[10px] font-medium ${requirement.isComplete ? "bg-[#e8f1eb] text-[#4d8068]" : "bg-[#f1f0ed] text-[#808581]"}`;
  if (isReadOnly) return <span className={className}>{requirement.isComplete ? "✓ " : ""}{requirement.label}</span>;
  return <span className="inline-flex flex-col"><Button type="button" variant="tertiary" isDisabled={saving} onPress={toggle} aria-label={requirement.isComplete ? `Mark ${requirement.label} incomplete` : `Mark ${requirement.label} complete`} className={className}>{requirement.isComplete ? "✓ " : ""}{requirement.label}</Button>{error && <span className="mt-1 text-[10px] text-[#a35e41]">{error}</span>}</span>;
}
