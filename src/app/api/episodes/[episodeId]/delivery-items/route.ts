import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { addActiveEpisodeDeliveryItem, DeliveryManifestError } from "@/server/delivery-manifests";

/** Adds an audited, episode-specific checklist exception in the active tenant. */
export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    return NextResponse.json({ item: await addActiveEpisodeDeliveryItem(episodeId, await request.json()) }, { status: 201 });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "delivery_item_create_failed", error, "Could not add the delivery item.");
  }
}
