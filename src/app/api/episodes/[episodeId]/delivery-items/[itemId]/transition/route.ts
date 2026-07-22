import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { DeliveryManifestError, transitionActiveEpisodeDeliveryItem } from "@/server/delivery-manifests";

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string; itemId: string }> }) {
  try {
    const { episodeId, itemId } = await params;
    return NextResponse.json({ manifest: await transitionActiveEpisodeDeliveryItem(episodeId, itemId, await request.json()) });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "delivery_item_transition_failed", error, "Could not update the delivery item.");
  }
}
