import { generateCode, hashCode, verifyCode } from "./otp";

describe("otp", () => {
  it("generates a 6-digit numeric code", () => {
    const code = generateCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("verifies a code against its own hash", () => {
    const code = "042917";
    expect(verifyCode(hashCode(code), code)).toBe(true);
  });

  it("rejects a mismatched code", () => {
    expect(verifyCode(hashCode("042917"), "000000")).toBe(false);
  });

  it("rejects a malformed stored hash without throwing", () => {
    expect(verifyCode("not-a-hex-hash", "042917")).toBe(false);
  });
});
