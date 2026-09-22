import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

/** Cost parameters are encoded in the stored value so N/r/p can change later without invalidating existing hashes. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:N=${SCRYPT_N}:r=${SCRYPT_R}:p=${SCRYPT_P}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1].slice(2));
  const r = Number(parts[2].slice(2));
  const p = Number(parts[3].slice(2));
  const salt = Buffer.from(parts[4], "hex");
  const storedHash = Buffer.from(parts[5], "hex");
  if (!n || !r || !p || salt.length === 0 || storedHash.length === 0) return false;

  const candidate = scryptSync(password, salt, storedHash.length, { N: n, r, p });
  return timingSafeEqual(candidate, storedHash);
}

/** A fixed, never-matching hash to run verifyPassword against when no account exists — keeps login timing/shape identical either way. */
export const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString("hex"));
