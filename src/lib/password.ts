import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const ALGORITHM = "scrypt";

/**
 * Stores a salted password verifier, never the password itself. The temporary
 * demo password is assigned only by the seed script.
 */
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `${ALGORITHM}$${salt}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, passwordHash: string | null | undefined) {
  if (!passwordHash) return false;

  const [algorithm, salt, storedKey] = passwordHash.split("$");
  if (algorithm !== ALGORITHM || !salt || !storedKey) return false;

  try {
    const derivedKey = await scrypt(password, salt, KEY_LENGTH) as Buffer;
    const storedBuffer = Buffer.from(storedKey, "base64url");
    return storedBuffer.length === derivedKey.length && timingSafeEqual(storedBuffer, derivedKey);
  } catch {
    return false;
  }
}
