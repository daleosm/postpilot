import { NextResponse } from "next/server";

import { DeliveryManifestError, transitionActiveEpisodeDeliveryItem } from "@/server/delivery-manifests";

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string; itemId: string }> }) {
  try {
    const { episodeId, itemId } = await params;
    return NextResponse.json({ manifest: await transitionActiveEpisodeDeliveryItem(episodeId, itemId, await request.json()) });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not update the delivery item." }, { status: 500 });
  }
}
