import { NextResponse } from "next/server";

import { unexpectedApiError } from "@/lib/api-errors";
import {
  DeliveryManifestError,
  getActiveSharedDeliveryManifest,
  shareActiveEpisodeDeliveryManifest,
  unshareActiveEpisodeDeliveryManifest,
} from "@/server/delivery-manifests";

function errorResponse(request: Request, error: unknown) {
  if (error instanceof DeliveryManifestError) return NextResponse.json({ error: error.message }, { status: error.status });
  return unexpectedApiError(request, "delivery_manifest_sharing_failed", error, "Could not access the shared delivery manifest.");
}

export async function GET(_: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    return NextResponse.json(await getActiveSharedDeliveryManifest(episodeId));
  } catch (error) {
    return errorResponse(_, error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    return NextResponse.json({ ok: true, share: await shareActiveEpisodeDeliveryManifest(episodeId, await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(request, error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    await unshareActiveEpisodeDeliveryManifest(episodeId, await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(request, error);
  }
}
