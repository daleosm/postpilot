import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import { DeliveryManifestError, updateActiveDeliveryProfile } from "@/server/delivery-manifests";

/** Updates only a profile belonging to the active tenant. */
export async function PATCH(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    const profile = await updateActiveDeliveryProfile(profileId, await request.json());
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return unexpectedApiError(request, "delivery_profile_update_failed", error, "Could not update the delivery profile.");
  }
}
