describe("platform operations readiness gate", () => {
  const {
    validatePlatformOperationsReadiness,
  } = require("./check-platform-ops.js");

  it("requires secret manager, ingress TLS, and alert routing in production", () => {
    const result = validatePlatformOperationsReadiness({
      NODE_ENV: "production",
      SECRET_MANAGER: "",
      TLS_INGRESS: "",
      IMAGE_TAG: "latest",
      ALERT_ROUTING: "",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "SECRET_MANAGER",
        "TLS_INGRESS",
        "IMAGE_TAG",
        "ALERT_ROUTING",
      ]),
    );
  });

  it("accepts a complete production platform configuration", () => {
    const result = validatePlatformOperationsReadiness({
      NODE_ENV: "production",
      SECRET_MANAGER: "vault",
      TLS_INGRESS: "cert-manager",
      IMAGE_TAG: "2026.09.14.1",
      ALERT_ROUTING: "pagerduty",
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
