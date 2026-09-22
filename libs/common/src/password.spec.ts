import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("verifies a password against its own hash", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("encodes cost parameters in the stored value", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored).toMatch(/^scrypt:N=16384:r=8:p=1:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("produces a different salt (and therefore hash) for the same password each time", () => {
    expect(hashPassword("same password")).not.toBe(hashPassword("same password"));
  });

  it("never matches a real password against the dummy hash", () => {
    expect(verifyPassword("anything at all", DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it("rejects a malformed stored value without throwing", () => {
    expect(verifyPassword("password", "not-a-real-hash")).toBe(false);
  });
});
