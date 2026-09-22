-- Phase 2 of the tenancy rollout: real (if still interim) secret storage
-- for dedicated tenant databases, replacing the TENANT_DB_CONNECTIONS
-- env-var placeholder for anything Phase 1's provisioning worker creates.
--
-- connection_string_encrypted holds AES-256-GCM ciphertext (see
-- libs/tenancy/src/secret-store.ts), never a plaintext connection string.
-- This is still not a dedicated secrets manager (Vault / AWS Secrets
-- Manager / GCP Secret Manager) — that remains a real upgrade path, not
-- built here — but it is a genuine improvement over a static env var: it's
-- queryable, runtime-updatable without a redeploy, and encrypted at rest
-- with a key that never itself lives in this database.
CREATE TABLE IF NOT EXISTS tenant_database_secrets (
  database_key TEXT PRIMARY KEY,
  connection_string_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
