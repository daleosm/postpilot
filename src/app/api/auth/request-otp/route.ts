import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { isDebugDemoMode } from "@/lib/runtime";
import { createOtp, hashOtp, OTP_TTL_MINUTES, sendOtpEmail } from "@/lib/otp";
import { users, verificationTokens } from "@/lib/db/schema";

const requestSchema = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid work email address." }, { status: 400 });

  const email = parsed.data.email.toLowerCase().trim();
  if (isDebugDemoMode) return NextResponse.json({ ok: true, debugCode: "000000" });

  const db = getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return NextResponse.json({ ok: true });

  const code = createOtp();
  const expires = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, email));
  await db.insert(verificationTokens).values({ identifier: email, token: hashOtp(email, code), expires });
  await sendOtpEmail(email, code);

  return NextResponse.json({ ok: true });
}
