import { Kafka } from "kafkajs";
import { Pool } from "pg";
import { getOutboxRetryStatus } from "../libs/common/src/outbox";
import { withRetry } from "../libs/common/src/resilience";

const MAX_OUTBOX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);

/** Run once per owning service; events are only marked published after Kafka acknowledges. */
async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const kafka = new Kafka({
    brokers: (process.env.KAFKA_BROKERS ?? "kafka:9092").split(","),
  });
  const producer = kafka.producer();

  await producer.connect();

  const { rows } = await pool.query(
    `SELECT id, topic, payload, attempts, status
     FROM outbox_events
     WHERE published_at IS NULL AND status != 'dead-letter'
     ORDER BY created_at
     LIMIT 100
     FOR UPDATE SKIP LOCKED`,
  );

  for (const row of rows) {
    try {
      await withRetry(async () => {
        await producer.send({
          topic: row.topic,
          messages: [{ key: row.id, value: JSON.stringify(row.payload) }],
        });
      });

      await pool.query(
        "UPDATE outbox_events SET published_at = NOW(), status = $2, attempts = attempts + 1 WHERE id = $1",
        [row.id, "published"],
      );
    } catch (error) {
      const nextAttempts = Number(row.attempts ?? 0) + 1;
      const nextStatus = getOutboxRetryStatus(
        nextAttempts,
        MAX_OUTBOX_ATTEMPTS,
      );
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (nextStatus === "dead-letter") {
        await pool.query(
          "UPDATE outbox_events SET attempts = $2, status = $3, last_error = $4, dead_lettered_at = NOW() WHERE id = $1",
          [row.id, nextAttempts, "dead-letter", errorMessage],
        );
        continue;
      }

      await pool.query(
        "UPDATE outbox_events SET attempts = $2, status = $3, last_error = $4 WHERE id = $1",
        [row.id, nextAttempts, nextStatus, errorMessage],
      );
    }
  }

  await producer.disconnect();
  await pool.end();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
