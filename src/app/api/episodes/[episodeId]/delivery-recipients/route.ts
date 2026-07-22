import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { DeliveryManifestError, listActiveDeliveryRecipientContacts } from "@/server/delivery-manifests";

export async function GET(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    return NextResponse.json({ contacts: await listActiveDeliveryRecipientContacts(episodeId) });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "delivery_recipients_load_failed", error, "Could not load delivery recipients.");
  }
}
