import { NextResponse } from "next/server";

import { applyActiveDeliveryProfileToEpisode, DeliveryManifestError } from "@/server/delivery-manifests";

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    return NextResponse.json({ manifest: await applyActiveDeliveryProfileToEpisode(episodeId, await request.json()) });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not apply the delivery profile." }, { status: 500 });
  }
}
