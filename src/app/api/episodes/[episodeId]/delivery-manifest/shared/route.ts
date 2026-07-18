import { NextResponse } from "next/server";

import {
  DeliveryManifestError,
  getActiveSharedDeliveryManifest,
  shareActiveEpisodeDeliveryManifest,
  unshareActiveEpisodeDeliveryManifest,
} from "@/server/delivery-manifests";

function errorResponse(error: unknown) {
  if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Could not access the shared delivery manifest." }, { status: 500 });
}

export async function GET(_: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    return NextResponse.json(await getActiveSharedDeliveryManifest(episodeId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    return NextResponse.json({ ok: true, share: await shareActiveEpisodeDeliveryManifest(episodeId, await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    await unshareActiveEpisodeDeliveryManifest(episodeId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
