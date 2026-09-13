describe("auth production configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("requires explicit JWT issuer and audience in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "production-secret-1234567890";
    delete process.env.JWT_ISSUER;
    delete process.env.JWT_AUDIENCE;

    expect(() => {
      jest.isolateModules(() => {
        require("./auth");
      });
    }).toThrow("JWT_ISSUER and JWT_AUDIENCE must be set");
  });
});
