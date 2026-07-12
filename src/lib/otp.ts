import { createHash, randomInt } from "crypto";

export const OTP_TTL_MINUTES = 10;

export function createOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(email: string, code: string) {
  return createHash("sha256").update(`${email.toLowerCase().trim()}:${code}`).digest("hex");
}

export async function sendOtpEmail(email: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[PostPilot debug] OTP for ${email}: ${code}`);
      return;
    }
    throw new Error("Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: email,
      subject: "Your PostPilot sign-in code",
      text: `Your PostPilot sign-in code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
    }),
  });

  if (!response.ok) throw new Error("Unable to deliver the one-time passcode.");
}
