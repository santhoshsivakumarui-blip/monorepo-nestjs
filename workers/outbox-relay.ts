import { connect } from "amqplib";
import { Kafka } from "kafkajs";
import { Pool } from "pg";
import {
  deadLetterQueueName,
  ensureQueueWithDlq,
} from "../libs/common/src/rabbitmq-topology";
import { getOutboxRetryStatus } from "../libs/common/src/outbox";
import { withRetry } from "../libs/common/src/resilience";

const MAX_OUTBOX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);
const OUTBOX_TRANSPORT = process.env.OUTBOX_TRANSPORT ?? "kafka";

interface Publisher {
  publish(topic: string, id: string, payload: unknown): Promise<void>;
  close(): Promise<void>;
}

async function createKafkaPublisher(): Promise<Publisher> {
  const kafka = new Kafka({
    brokers: (process.env.KAFKA_BROKERS ?? "kafka:9092").split(","),
  });
  const producer = kafka.producer();
  await producer.connect();

  return {
    async publish(topic, id, payload) {
      await producer.send({
        topic,
        messages: [{ key: id, value: JSON.stringify(payload) }],
      });
    },
    close: () => producer.disconnect(),
  };
}

/** Publishes as {pattern, data} so @nestjs/microservices' RMQ server routes it to the matching @EventPattern handler. */
async function createRabbitMqPublisher(): Promise<Publisher> {
  const url =
    process.env.RABBITMQ_URL ?? "amqp://platform:platform@rabbitmq:5672";
  const connection = await connect(url);
  const channel = await connection.createChannel();
  const knownQueues = new Set<string>();

  return {
    async publish(topic, _id, payload) {
      if (!knownQueues.has(topic)) {
        await ensureQueueWithDlq(url, {
          queue: topic,
          deadLetterQueue: deadLetterQueueName(topic),
        });
        knownQueues.add(topic);
      }
      channel.sendToQueue(
        topic,
        Buffer.from(JSON.stringify({ pattern: topic, data: payload })),
        { persistent: true },
      );
    },
    async close() {
      await channel.close();
      await connection.close();
    },
  };
}

/** Run once per owning service; events are only marked published after the broker acknowledges. */
async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const publisher =
    OUTBOX_TRANSPORT === "rabbitmq"
      ? await createRabbitMqPublisher()
      : await createKafkaPublisher();

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
      await withRetry(() => publisher.publish(row.topic, row.id, row.payload));

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

  await publisher.close();
  await pool.end();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
