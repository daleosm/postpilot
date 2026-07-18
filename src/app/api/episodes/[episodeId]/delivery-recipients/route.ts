import { NextResponse } from "next/server";

import { DeliveryManifestError, listActiveDeliveryRecipientContacts } from "@/server/delivery-manifests";

export async function GET(_: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    return NextResponse.json({ contacts: await listActiveDeliveryRecipientContacts(episodeId) });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not load delivery recipients." }, { status: 500 });
  }
}
