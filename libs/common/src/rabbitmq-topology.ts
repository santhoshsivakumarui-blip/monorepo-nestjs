import { connect } from "amqplib";

export interface QueueTopology {
  queue: string;
  deadLetterQueue: string;
}

export function deadLetterQueueName(queue: string) {
  return `${queue}.dead-letter`;
}

export function deadLetterQueueArguments(deadLetterQueue: string) {
  return {
    "x-dead-letter-exchange": "",
    "x-dead-letter-routing-key": deadLetterQueue,
  };
}

/**
 * Declares a durable queue wired to a matching dead-letter queue via the
 * default exchange, so messages that are nacked without requeue land in the
 * dead-letter queue instead of being dropped. Safe to call repeatedly from
 * both producer and consumer processes — queue declaration is idempotent as
 * long as the arguments match.
 */
export async function ensureQueueWithDlq(
  url: string,
  { queue, deadLetterQueue }: QueueTopology,
) {
  const connection = await connect(url);
  const channel = await connection.createChannel();
  await channel.assertQueue(deadLetterQueue, { durable: true });
  await channel.assertQueue(queue, {
    durable: true,
    arguments: deadLetterQueueArguments(deadLetterQueue),
  });
  await channel.close();
  await connection.close();
}
