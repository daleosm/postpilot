import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { DeliveryManifestError, addActiveDeliveryProfileItem } from "@/server/delivery-manifests";

/** Adds a reusable requirement to a profile in the active tenant only. */
export async function POST(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    const item = await addActiveDeliveryProfileItem(profileId, await request.json());
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "delivery_profile_item_create_failed", error, "Could not add the delivery requirement.");
  }
}
