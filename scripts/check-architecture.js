const fs = require("fs");
const path = require("path");

const ROOT_ALLOWED_DIRS = new Set([
  ".devcontainer",
  ".githooks",
  ".github",
  "apps",
  "docs",
  "dist",
  "helm",
  "infra",
  "k8s",
  "libs",
  "load",
  "observability",
  "outputs",
  "platform",
  "prisma",
  "scripts",
  "test",
  "work",
  "workers",
]);

const ROOT_ALLOWED_FILES = new Set([
  ".env.example",
  ".gitignore",
  "Dockerfile",
  "Makefile",
  "README.md",
  "docker-compose.yml",
  "jest.config.js",
  "nest-cli.json",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules"].includes(entry.name)) return [];
      return walk(fullPath);
    }
    return [fullPath];
  });
}

function validateProjectStructure(rootDir = process.cwd()) {
  const issues = [];
  const relativePath = (target) =>
    path.relative(rootDir, target).split(path.sep).join("/");

  const ignoredRootEntries = new Set([".git", ".npm-cache", "node_modules"]);

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (ignoredRootEntries.has(entry.name)) continue;

    const name = entry.name;
    if (entry.isDirectory() && !ROOT_ALLOWED_DIRS.has(name)) {
      issues.push(`${name}/ is outside the canonical project layout`);
    }

    if (
      entry.isFile() &&
      !ROOT_ALLOWED_FILES.has(name) &&
      !name.startsWith(".")
    ) {
      const ext = path.extname(name);
      if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
        issues.push(
          `${name} is placed at the project root instead of a canonical folder`,
        );
      }
    }
  }

  const appsDir = path.join(rootDir, "apps");
  if (fs.existsSync(appsDir)) {
    for (const appDir of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!appDir.isDirectory()) continue;
      const appRoot = path.join(appsDir, appDir.name);
      const appFiles = walk(appRoot);
      const allowedAppFiles = new Set(["tsconfig.app.json"]);
      const hasSrc = appFiles.some((file) =>
        relativePath(file).startsWith(`apps/${appDir.name}/src/`),
      );

      if (!hasSrc) {
        issues.push(`apps/${appDir.name} is missing a src/ directory`);
      }

      for (const file of appFiles) {
        const rel = relativePath(file);
        if (
          rel.startsWith(`apps/${appDir.name}/`) &&
          !rel.startsWith(`apps/${appDir.name}/src/`) &&
          !allowedAppFiles.has(path.basename(rel))
        ) {
          issues.push(
            `${rel} is not in the expected app layout under apps/${appDir.name}/src`,
          );
        }
      }
    }
  }

  const libsDir = path.join(rootDir, "libs");
  if (fs.existsSync(libsDir)) {
    for (const libDir of fs.readdirSync(libsDir, { withFileTypes: true })) {
      if (!libDir.isDirectory()) continue;
      const libRoot = path.join(libsDir, libDir.name);
      const libFiles = walk(libRoot);
      const hasSrc = libFiles.some((file) =>
        relativePath(file).startsWith(`libs/${libDir.name}/src/`),
      );

      if (!hasSrc) {
        issues.push(`libs/${libDir.name} is missing a src/ directory`);
      }

      for (const file of libFiles) {
        const rel = relativePath(file);
        if (
          rel.startsWith(`libs/${libDir.name}/`) &&
          !rel.startsWith(`libs/${libDir.name}/src/`)
        ) {
          issues.push(
            `${rel} is not in the expected library layout under libs/${libDir.name}/src`,
          );
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function validateArchitecture(rootDir = process.cwd()) {
  const failures = [];
  const appsDir = path.join(rootDir, "apps");

  if (!fs.existsSync(appsDir)) {
    return { ok: false, issues: ["apps/ directory is missing"] };
  }

  for (const app of fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)) {
    const walkDir = (dir) =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory()
            ? walkDir(path.join(dir, entry.name))
            : [path.join(dir, entry.name)],
        );
    for (const file of walkDir(path.join(appsDir, app, "src")).filter((f) =>
      f.endsWith(".ts"),
    )) {
      const content = fs.readFileSync(file, "utf8");
      for (const other of fs.readdirSync(appsDir)) {
        if (
          other !== app &&
          new RegExp(`apps[\\/]${other}[\\/]`).test(content)
        ) {
          failures.push(`${file} imports implementation from ${other}`);
        }
      }
    }
  }

  const structureCheck = validateProjectStructure(rootDir);
  return {
    ok: failures.length === 0 && structureCheck.ok,
    issues: [...failureCheck(failures), ...structureCheck.issues],
  };
}

function failureCheck(value) {
  return Array.isArray(value) ? value : [];
}

if (require.main === module) {
  const structureResult = validateProjectStructure();
  if (!structureResult.ok) {
    console.error(structureResult.issues.join("\n"));
    process.exit(1);
  }

  const architectureResult = validateArchitecture();
  if (!architectureResult.ok) {
    console.error(architectureResult.issues.join("\n"));
    process.exit(1);
  }

  console.log("Architecture boundaries: OK");
  console.log("Project structure: OK");
}

module.exports = {
  validateProjectStructure,
  validateArchitecture,
};
