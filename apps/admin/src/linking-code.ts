import { randomBytes } from "crypto";

export function generateLinkingCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}
