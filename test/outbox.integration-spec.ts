import { GenericContainer, StartedTestContainer } from "testcontainers";
import { Client } from "pg";
import {
  beginIdempotent,
  completeIdempotent,
  requestFingerprint,
} from "../libs/common/src/idempotency";
import { enqueueOutbox, getOutboxRetryStatus } from "../libs/common/src/outbox";
import { DomainEvent } from "../libs/contracts/src/events";

describe("event reliability integration", () => {
  let client: Client | undefined;
  let container: StartedTestContainer | undefined;
  let runtimeAvailable = true;

  beforeAll(async () => {
    try {
      container = await new GenericContainer("postgres:16-alpine")
        .withEnvironment({
          POSTGRES_DB: "platform",
          POSTGRES_USER: "platform",
          POSTGRES_PASSWORD: "platform",
        })
        .withExposedPorts(5432)
        .start();

      const connectionString = `postgresql://platform:platform@${container.getHost()}:${container.getMappedPort(5432)}/platform`;
      client = new Client({ connectionString });
      await client.connect();

      await client.query(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT PRIMARY KEY,
          fingerprint TEXT NOT NULL,
          response JSONB,
          completed_at TIMESTAMPTZ
        );
      `);

      await client.query(`
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
      `);
    } catch (error) {
      runtimeAvailable = false;
      console.warn(
        "Skipping event reliability integration tests: no working container runtime was found.",
      );
      console.warn(error instanceof Error ? error.message : String(error));
    }
  }, 120_000);

  afterAll(async () => {
    if (client) {
      await client.end();
    }
    if (container) {
      await container.stop();
    }
  });

  beforeEach(async () => {
    if (!runtimeAvailable || !client) return;
    await client.query("DELETE FROM idempotency_keys");
    await client.query("DELETE FROM outbox_events");
  });

  it("replays a request safely when the same key and payload fingerprint are reused", async () => {
    const key = "1234567890abcdef";
    const payload = { userId: "u-1", email: "user@example.com" };
    const fingerprint = requestFingerprint("POST", "/users", payload);

    const first = await beginIdempotent(client as any, key, fingerprint);
    expect(first).toBeUndefined();

    await completeIdempotent(client as any, key, payload);

    const second = await beginIdempotent(client as any, key, fingerprint);
    expect(second).toEqual(payload);
  });

  it("rejects a replay when the same key is reused with a different payload fingerprint", async () => {
    const key = "abcdef1234567890";
    const original = { userId: "u-1", email: "user@example.com" };
    const different = { userId: "u-1", email: "other@example.com" };

    await beginIdempotent(
      client as any,
      key,
      requestFingerprint("POST", "/users", original),
    );
    await completeIdempotent(client as any, key, original);

    await expect(
      beginIdempotent(
        client as any,
        key,
        requestFingerprint("POST", "/users", different),
      ),
    ).rejects.toThrow();
  });

  it("stores a published domain event in the outbox and tracks retry states with the real database", async () => {
    const event: DomainEvent<{ userId: string; email: string }> = {
      id: "evt-1",
      type: "users.user-created.v1",
      occurredAt: new Date().toISOString(),
      correlationId: "corr-1",
      payload: { userId: "u-1", email: "user@example.com" },
    };

    await enqueueOutbox(client as any, event);

    const inserted = await client.query(
      "SELECT id, status, attempts FROM outbox_events WHERE id = $1",
      [event.id],
    );

    expect(inserted.rows).toHaveLength(1);
    expect(inserted.rows[0].status).toBe("pending");
    expect(getOutboxRetryStatus(Number(inserted.rows[0].attempts), 5)).toBe(
      "pending",
    );

    await client.query(
      "UPDATE outbox_events SET attempts = 3, status = 'failed' WHERE id = $1",
      [event.id],
    );

    const failed = await client.query(
      "SELECT attempts, status FROM outbox_events WHERE id = $1",
      [event.id],
    );
    expect(getOutboxRetryStatus(Number(failed.rows[0].attempts), 5)).toBe(
      "failed",
    );

    await client.query(
      "UPDATE outbox_events SET attempts = 5, status = 'dead-letter', dead_lettered_at = NOW() WHERE id = $1",
      [event.id],
    );

    const deadLetter = await client.query(
      "SELECT attempts, status FROM outbox_events WHERE id = $1",
      [event.id],
    );
    expect(getOutboxRetryStatus(Number(deadLetter.rows[0].attempts), 5)).toBe(
      "dead-letter",
    );
  });
});
