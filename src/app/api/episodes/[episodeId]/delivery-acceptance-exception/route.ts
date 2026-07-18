import { NextResponse } from "next/server";

import { authorizeActiveDeliveryAcceptanceException, DeliveryManifestError } from "@/server/delivery-manifests";

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  try {
    const exception = await authorizeActiveDeliveryAcceptanceException(episodeId, await request.json());
    return NextResponse.json({ ok: true, exception });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not record the delivery acceptance exception." }, { status: 500 });
  }
}
