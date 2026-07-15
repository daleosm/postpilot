import { NextResponse } from "next/server";

/**
 * Retained only so a previously bookmarked endpoint receives a clear response.
 * New actual time is confirmed immediately on the booking itself.
 */
export async function POST() {
  return NextResponse.json({ error: "Actual time no longer needs approval. Confirm it directly from the booking." }, { status: 410 });
}
