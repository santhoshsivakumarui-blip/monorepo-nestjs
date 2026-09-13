import { Pool, PoolClient } from "pg";
import { DomainEvent } from "../../contracts/src/events";

export type OutboxRetryStatus = "pending" | "failed" | "dead-letter";

export function getOutboxRetryStatus(
  attempts: number,
  maxAttempts = 5,
): OutboxRetryStatus {
  if (attempts >= maxAttempts) return "dead-letter";
  if (attempts > 0) return "failed";
  return "pending";
}

/** Stores an event in the same database transaction as its domain mutation. */
export async function enqueueOutbox(
  pool: Pool | PoolClient,
  event: DomainEvent,
) {
  await pool.query(
    "INSERT INTO outbox_events (id, topic, payload, created_at, attempts, status) VALUES ($1, $2, $3, NOW(), 0, $4)",
    [event.id, event.type, event, "pending"],
  );
}
