import { NextResponse } from "next/server";

import { DeliveryManifestError, addActiveDeliveryProfileItem } from "@/server/delivery-manifests";

/** Adds a reusable requirement to a profile in the active tenant only. */
export async function POST(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    const item = await addActiveDeliveryProfileItem(profileId, await request.json());
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not add the delivery requirement." }, { status: 500 });
  }
}
