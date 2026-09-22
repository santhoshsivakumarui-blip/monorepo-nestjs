const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

/**
 * Applies infra/postgres/migrations/<key>/*.sql to the database identified by
 * <KEY>_DATABASE_URL (or DATABASE_URL as a fallback), tracked in a
 * schema_migrations table. Unlike infra/postgres/init.sql (which only runs
 * once, on a fresh Postgres volume), this can be re-run against an
 * already-running dev database.
 *
 * Usage: node scripts/db-migrate.js <key> [<key> ...]
 */

const MIGRATIONS_ROOT = path.join(__dirname, "..", "infra", "postgres", "migrations");

function resolveConnectionString(key) {
  // "-" isn't valid in a shell/env var name (matters for "clinical-records").
  const envKey = `${key.toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;
  return process.env[envKey] || process.env.DATABASE_URL;
}

async function ensureDatabaseExists(connectionString) {
  const target = new URL(connectionString);
  const databaseName = target.pathname.replace(/^\//, "");
  const maintenance = new URL(connectionString);
  maintenance.pathname = "/postgres";

  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${databaseName}"`);
      console.log(`Created database ${databaseName}`);
    }
  } finally {
    await client.end();
  }
}

async function applyMigrations(key) {
  const connectionString = resolveConnectionString(key);
  if (!connectionString) {
    throw new Error(
      `No connection string for target "${key}". Set ${key.toUpperCase()}_DATABASE_URL or DATABASE_URL.`,
    );
  }

  await ensureDatabaseExists(connectionString);

  const dir = path.join(MIGRATIONS_ROOT, key);
  if (!fs.existsSync(dir)) {
    throw new Error(`No migrations directory for target "${key}": ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );

    for (const file of files) {
      const { rowCount } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [file],
      );
      if (rowCount > 0) {
        console.log(`[${key}] ${file} already applied, skipping`);
        continue;
      }

      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      console.log(`[${key}] applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("Usage: node scripts/db-migrate.js <target> [<target> ...]");
    process.exit(1);
  }

  for (const target of targets) {
    await applyMigrations(target);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { applyMigrations, resolveConnectionString };
