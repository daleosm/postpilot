import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

/** Creates a temporary test hash accepted by FastAPI's password verifier. */
export async function hashTestPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await scrypt(password, Buffer.from(salt, "base64url"), keyLength) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("base64url")}`;
}

export async function verifyTestPassword(password: string, passwordHash: string | null | undefined) {
  if (!passwordHash) return false;
  const [algorithm, salt, storedKey] = passwordHash.split("$");
  if (algorithm !== "scrypt" || !salt || !storedKey) return false;
  const derivedKey = await scrypt(password, Buffer.from(salt, "base64url"), keyLength) as Buffer;
  const stored = Buffer.from(storedKey, "base64url");
  return stored.length === derivedKey.length && timingSafeEqual(stored, derivedKey);
}
