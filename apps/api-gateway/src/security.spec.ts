import { buildCorsOrigins, buildSecurityHeaders } from "./security";

describe("gateway security headers", () => {
  it("sets secure defaults for browser-facing responses", () => {
    const headers = buildSecurityHeaders();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("accepts explicit CORS origins from the environment", () => {
    const origins = buildCorsOrigins(
      "https://app.example.com, https://admin.example.com",
    );

    expect(origins).toEqual([
      "https://app.example.com",
      "https://admin.example.com",
    ]);
  });
});
