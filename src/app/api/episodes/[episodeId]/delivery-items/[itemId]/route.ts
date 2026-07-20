import { NextResponse } from "next/server";

import { DeliveryManifestError, removeActiveEpisodeDeliveryItem, updateActiveEpisodeDeliveryItem } from "@/server/delivery-manifests";

/** Edits/removes only audited episode-level checklist overrides in the active tenant. */
export async function PATCH(request: Request, { params }: { params: Promise<{ episodeId: string; itemId: string }> }) {
  try {
    const { episodeId, itemId } = await params;
    await updateActiveEpisodeDeliveryItem(episodeId, itemId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Could not update episode delivery item", error);
    return NextResponse.json({ error: "Could not update the delivery item." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ episodeId: string; itemId: string }> }) {
  try {
    const { episodeId, itemId } = await params;
    await removeActiveEpisodeDeliveryItem(episodeId, itemId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not remove the delivery item." }, { status: 500 });
  }
}
