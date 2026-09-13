CREATE DATABASE users_db;
CREATE DATABASE orders_db;
CREATE DATABASE notifications_db;
\connect users_db
CREATE TABLE outbox_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, published_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, dead_lettered_at TIMESTAMPTZ);
CREATE TABLE inbox_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB, completed_at TIMESTAMPTZ);
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[], created_at TIMESTAMPTZ NOT NULL DEFAULT now());
\connect orders_db
CREATE TABLE outbox_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, published_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, dead_lettered_at TIMESTAMPTZ);
CREATE TABLE inbox_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB, completed_at TIMESTAMPTZ);
CREATE TABLE orders (id UUID PRIMARY KEY, user_id UUID NOT NULL, total NUMERIC(12,2) NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
\connect notifications_db
CREATE TABLE outbox_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, published_at TIMESTAMPTZ, attempts INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, dead_lettered_at TIMESTAMPTZ);
CREATE TABLE inbox_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB, completed_at TIMESTAMPTZ);
CREATE TABLE notification_preferences (user_id UUID PRIMARY KEY, email_enabled BOOLEAN NOT NULL DEFAULT true, sms_enabled BOOLEAN NOT NULL DEFAULT false);
