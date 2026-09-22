-- Base scaffolding, previously only created by infra/postgres/init.sql's
-- one-time docker-entrypoint-initdb.d hook against the local dev container.
-- Numbered ahead of the existing 0001+ migrations (which assume this shape
-- already exists) so `db-migrate.js users` can provision a database anywhere,
-- not just replay on top of a local Postgres volume.
CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  dead_lettered_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS inbox_events (
  id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response JSONB,
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
