import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";

/**
 * TypeScript port of scripts/db-migrate.js's core logic, so a NestJS process
 * (apps/admin, at request time) can provision and migrate a brand-new
 * database the same way the CLI script does at deploy time — same
 * migrations directory, same schema_migrations tracking table, so a
 * dedicated tenant database ends up byte-for-byte on the same schema
 * version as the pooled one.
 */

const MIGRATIONS_ROOT = path.join(__dirname, "..", "..", "..", "infra", "postgres", "migrations");

export async function ensureDatabaseExists(connectionString: string): Promise<void> {
  const target = new URL(connectionString);
  const databaseName = target.pathname.replace(/^\//, "");
  const maintenance = new URL(connectionString);
  maintenance.pathname = "/postgres";

  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (rowCount === 0) {
      // Database names come from this codebase (dedicatedDatabaseKey), never
      // end-user input, so string interpolation here is not an injection risk —
      // identifiers can't be parameterized in Postgres DDL either way.
      await client.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await client.end();
  }
}

/** Applies every infra/postgres/migrations/<migrationsKey>/*.sql file against connectionString, in order, tracked in schema_migrations — same behavior as scripts/db-migrate.js's applyMigrations. */
export async function applyMigrationsTo(migrationsKey: string, connectionString: string): Promise<string[]> {
  const dir = path.join(MIGRATIONS_ROOT, migrationsKey);
  if (!fs.existsSync(dir)) {
    throw new Error(`No migrations directory for target "${migrationsKey}": ${dir}`);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    for (const file of files) {
      const { rowCount } = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
      if (rowCount && rowCount > 0) continue;

      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

/** Swaps the database name in an existing service connection string, keeping the same host/role/credentials/params. */
export function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
