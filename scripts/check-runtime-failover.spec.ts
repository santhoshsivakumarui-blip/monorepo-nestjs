describe("runtime failover validation", () => {
  it("passes when the clustered recovery checks succeed", async () => {
    const { validateRuntimeFailover } = require("./check-runtime-failover.js");

    const result = await validateRuntimeFailover(
      {
        NODE_ENV: "production",
        OUTBOX_MAX_ATTEMPTS: "5",
        KAFKA_BROKERS: "kafka-1:9092,kafka-2:9092",
        RABBITMQ_URL: "amqp://rabbitmq:5672",
        RABBITMQ_BACKLOG_THRESHOLD: "250",
        CONSUMER_LAG_THRESHOLD: "75",
        DR_RUNBOOK_URL: "https://runbooks.example.com/dr",
      },
      {
        kafkaBrokerRecovery: async () => ({
          ok: true,
          details: "Kafka broker outage recovered through automatic rebalance",
        }),
        rabbitMqReplay: async () => ({
          ok: true,
          details: "RabbitMQ backlog consumed and replay completed",
        }),
        consumerLagUnderSaturation: async () => ({
          ok: true,
          details: "Consumer lag remained below saturation threshold",
        }),
        deadLetterRecoveryDrill: async () => ({
          ok: true,
          details: "Dead-letter recovery drill executed successfully",
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.checks.map((check: { name: string }) => check.name)).toEqual([
      "outbox_retry_policy",
      "kafka_broker_outage_recovery",
      "rabbitmq_backlog_and_replay",
      "consumer_lag_under_saturation",
      "dead_letter_recovery_drill",
    ]);
  });

  it("fails if any clustered recovery scenario is not healthy", async () => {
    const { validateRuntimeFailover } = require("./check-runtime-failover.js");

    const result = await validateRuntimeFailover(
      {
        NODE_ENV: "production",
        OUTBOX_MAX_ATTEMPTS: "5",
        KAFKA_BROKERS: "kafka-1:9092",
        RABBITMQ_URL: "amqp://rabbitmq:5672",
        RABBITMQ_BACKLOG_THRESHOLD: "250",
        CONSUMER_LAG_THRESHOLD: "50",
        DR_RUNBOOK_URL: "https://runbooks.example.com/dr",
      },
      {
        kafkaBrokerRecovery: async () => ({ ok: true, details: "ok" }),
        rabbitMqReplay: async () => ({ ok: true, details: "ok" }),
        consumerLagUnderSaturation: async () => ({
          ok: false,
          details: "lag above threshold",
        }),
        deadLetterRecoveryDrill: async () => ({ ok: true, details: "ok" }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("consumer_lag_under_saturation");
  });
});
