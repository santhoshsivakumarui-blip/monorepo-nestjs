describe("OIDC gateway configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("disables local token minting when OIDC configuration is present", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "production-secret-1234567890";
    process.env.OAUTH_ISSUER = "https://id.example.com/realms/platform";
    process.env.OAUTH_AUDIENCE = "api-gateway";
    process.env.OAUTH_CLIENT_ID = "api-gateway";
    delete process.env.JWT_ISSUER;
    delete process.env.JWT_AUDIENCE;

    expect(() => {
      jest.isolateModules(() => {
        require("./auth");
      });
    }).not.toThrow();
  });

  it("requires OIDC discovery metadata to be reachable and valid", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        issuer: "https://id.example.com/realms/platform",
        jwks_uri:
          "https://id.example.com/realms/platform/protocol/openid-connect/certs",
      }),
    } as Response);

    const { validateOidcConfiguration } = require("./auth");

    await expect(
      validateOidcConfiguration({
        OAUTH_ISSUER: "https://id.example.com/realms/platform",
        OAUTH_AUDIENCE: "api-gateway",
        OAUTH_CLIENT_ID: "api-gateway",
      }),
    ).resolves.toBeUndefined();

    fetchSpy.mockRestore();
  });
});
