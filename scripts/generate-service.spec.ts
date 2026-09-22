describe("service generator", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { execFileSync } = require("child_process");

  it("creates a production-ready service folder structure with the standard app layout", () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "service-generator-"),
    );
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "generate-service.js",
    );

    try {
      execFileSync("node", [scriptPath, "billing"], {
        cwd: tempRoot,
        stdio: "pipe",
      });

      const expectedPaths = [
        path.join(tempRoot, "apps", "billing", "src", "main.ts"),
        path.join(
          tempRoot,
          "apps",
          "billing",
          "src",
          "config",
          "app.config.ts",
        ),
        path.join(tempRoot, "apps", "billing", "src", "common", "constants.ts"),
        path.join(
          tempRoot,
          "apps",
          "billing",
          "src",
          "modules",
          "billing",
          "billing.module.ts",
        ),
        path.join(
          tempRoot,
          "apps",
          "billing",
          "src",
          "guards",
          "jwt-auth.guard.ts",
        ),
        path.join(
          tempRoot,
          "apps",
          "billing",
          "src",
          "filters",
          "http-exception.filter.ts",
        ),
        path.join(
          tempRoot,
          "apps",
          "billing",
          "src",
          "interceptors",
          "logging.interceptor.ts",
        ),
        path.join(
          tempRoot,
          "apps",
          "billing",
          "test",
          "e2e",
          "billing.e2e-spec.ts",
        ),
      ];

      for (const expectedPath of expectedPaths) {
        expect(fs.existsSync(expectedPath)).toBe(true);
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
