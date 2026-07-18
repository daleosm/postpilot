import { NextResponse } from "next/server";

import { DeliveryManifestError, createActiveDeliveryProfile } from "@/server/delivery-manifests";

/** Creates a reusable tenant-owned delivery checklist; tenant identity is resolved server-side. */
export async function POST(request: Request) {
  try {
    const profile = await createActiveDeliveryProfile(await request.json());
    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not create the delivery profile." }, { status: 500 });
  }
}
