import { createHash, randomInt, timingSafeEqual } from "crypto";

/** 6-digit numeric code, e.g. "042917". */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Proportionate for short-lived, attempt-limited codes — unlike passwords, sha256 alone is fine here. */
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function verifyCode(hash: string, code: string): boolean {
  const candidate = Buffer.from(hashCode(code), "hex");
  const stored = Buffer.from(hash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
