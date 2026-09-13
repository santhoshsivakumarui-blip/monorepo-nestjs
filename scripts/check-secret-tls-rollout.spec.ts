describe("secret and TLS rollout validation", () => {
  it("requires secret manager, ingress TLS, and certificate renewal inputs", () => {
    const {
      validateSecretTlsRollout,
    } = require("./check-secret-tls-rollout.js");

    const result = validateSecretTlsRollout({
      NODE_ENV: "production",
      SECRET_MANAGER: "",
      TLS_INGRESS: "",
      CERT_ISSUER: "",
      CERT_SECRET_NAME: "",
      CERT_RENEWAL_BEFORE_DAYS: "",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "SECRET_MANAGER",
        "TLS_INGRESS",
        "CERT_ISSUER",
        "CERT_SECRET_NAME",
        "CERT_RENEWAL_BEFORE_DAYS",
      ]),
    );
  });

  it("accepts a complete secret-manager and certificate rollout configuration", () => {
    const {
      validateSecretTlsRollout,
    } = require("./check-secret-tls-rollout.js");

    const result = validateSecretTlsRollout({
      NODE_ENV: "production",
      SECRET_MANAGER: "vault",
      TLS_INGRESS: "cert-manager",
      CERT_ISSUER: "letsencrypt-production",
      CERT_SECRET_NAME: "platform-tls",
      CERT_RENEWAL_BEFORE_DAYS: "21",
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
