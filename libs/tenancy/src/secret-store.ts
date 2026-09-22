import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { registryDatabase } from "./registry-database";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // standard GCM nonce size

function getKey(): Buffer {
  const raw = process.env.TENANT_SECRETS_KEY;
  if (!raw) {
    throw new Error(
      "TENANT_SECRETS_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`TENANT_SECRETS_KEY must decode to exactly 32 bytes (got ${key.length}).`);
  }
  return key;
}

/** iv:authTag:ciphertext, each base64 — self-contained, no key material stored alongside. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(":");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed stored secret (expected iv:authTag:ciphertext).");
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * Persists one tenant database's connection string, encrypted at rest, in
 * admin_db's tenant_database_secrets table.
 *
 * Uses registryDatabase() (see registry-database.ts), which always points at
 * admin_db via ADMIN_DATABASE_URL regardless of which service is calling — so
 * a dedicated database's secret is written to and read from the registry, not
 * from the calling service's own sharded database.
 */
export async function storeTenantDatabaseSecret(databaseKey: string, connectionString: string): Promise<void> {
  const encrypted = encryptSecret(connectionString);
  await registryDatabase().query(
    `INSERT INTO tenant_database_secrets (database_key, connection_string_encrypted, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (database_key) DO UPDATE SET
       connection_string_encrypted = EXCLUDED.connection_string_encrypted, updated_at = NOW()`,
    [databaseKey, encrypted],
  );
}

/** Returns null (not an error) when no secret is registered for this key — the caller decides the fallback. */
export async function fetchTenantDatabaseSecret(databaseKey: string): Promise<string | null> {
  const { rows } = await registryDatabase().query<{ connection_string_encrypted: string }>(
    "SELECT connection_string_encrypted FROM tenant_database_secrets WHERE database_key = $1",
    [databaseKey],
  );
  const row = rows[0];
  return row ? decryptSecret(row.connection_string_encrypted) : null;
}

export async function deleteTenantDatabaseSecret(databaseKey: string): Promise<void> {
  await registryDatabase().query("DELETE FROM tenant_database_secrets WHERE database_key = $1", [databaseKey]);
}
