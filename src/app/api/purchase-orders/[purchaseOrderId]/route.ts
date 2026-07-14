import { NextResponse } from "next/server";

/** Retained endpoint path for legacy clients while purchase orders are dormant. */
export async function PATCH() {
  return NextResponse.json({ error: "Purchase orders are not active in this workflow." }, { status: 410 });
}
