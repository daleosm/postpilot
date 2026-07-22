import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { applyActiveDeliveryProfileToEpisode, DeliveryManifestError } from "@/server/delivery-manifests";

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    return NextResponse.json({ manifest: await applyActiveDeliveryProfileToEpisode(episodeId, await request.json()) });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "delivery_profile_apply_failed", error, "Could not apply the delivery profile.");
  }
}
