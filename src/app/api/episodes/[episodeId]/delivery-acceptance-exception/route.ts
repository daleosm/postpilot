import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { authorizeActiveDeliveryAcceptanceException, DeliveryManifestError } from "@/server/delivery-manifests";

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  try {
    const exception = await authorizeActiveDeliveryAcceptanceException(episodeId, await request.json());
    return NextResponse.json({ ok: true, exception });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "delivery_acceptance_exception_failed", error, "Could not record the delivery acceptance exception.");
  }
}
