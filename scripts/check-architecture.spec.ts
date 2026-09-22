describe("project structure validation", () => {
  const { validateProjectStructure } = require("./check-architecture.js");

  it("accepts the expected app and library folder layout", () => {
    const result = validateProjectStructure(process.cwd());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags misplaced source files outside the canonical folders", () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "project-structure-"),
    );
    fs.mkdirSync(path.join(tempRoot, "apps", "gateway", "src"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tempRoot, "libs", "common", "src"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempRoot, "apps", "gateway", "src", "main.ts"),
      "export const x = 1;\n",
    );
    fs.writeFileSync(
      path.join(tempRoot, "libs", "common", "src", "index.ts"),
      "export const y = 1;\n",
    );
    fs.writeFileSync(path.join(tempRoot, "bad.ts"), "export const z = 1;\n");

    const result = validateProjectStructure(tempRoot);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue: string) => issue.includes("bad.ts")),
    ).toBe(true);
  });
});
