import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { DeliveryManifestError, removeActiveEpisodeDeliveryItem, updateActiveEpisodeDeliveryItem } from "@/server/delivery-manifests";

/** Edits/removes only audited episode-level checklist overrides in the active tenant. */
export async function PATCH(request: Request, { params }: { params: Promise<{ episodeId: string; itemId: string }> }) {
  try {
    const { episodeId, itemId } = await params;
    await updateActiveEpisodeDeliveryItem(episodeId, itemId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "delivery_item_update_failed", error, "Could not update the delivery item.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ episodeId: string; itemId: string }> }) {
  try {
    const { episodeId, itemId } = await params;
    await removeActiveEpisodeDeliveryItem(episodeId, itemId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "delivery_item_remove_failed", error, "Could not remove the delivery item.");
  }
}
