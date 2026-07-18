import { NextResponse } from "next/server";

import { DeliveryManifestError, updateActiveDeliveryProfileItem } from "@/server/delivery-manifests";

/** Updates a profile item only when both IDs belong to the active tenant. */
export async function PATCH(request: Request, { params }: { params: Promise<{ profileId: string; itemId: string }> }) {
  try {
    const { profileId, itemId } = await params;
    await updateActiveDeliveryProfileItem(profileId, itemId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not update the delivery requirement." }, { status: 500 });
  }
}
