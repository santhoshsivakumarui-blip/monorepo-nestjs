describe("environment validation", () => {
  const { validateRequiredEnvironment } = require("./check-env.js");

  it("rejects placeholder secrets and empty values before startup", () => {
    const result = validateRequiredEnvironment({
      DATABASE_URL: "postgresql://platform:platform@localhost:5432/platform",
      JWT_SECRET: "change-me",
      KAFKA_BROKERS: "localhost:9092",
      RABBITMQ_URL: "amqp://platform:platform@localhost:5672",
      REDIS_URL: "redis://localhost:6379",
      ELASTICSEARCH_NODE: "http://localhost:9200",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("JWT_SECRET");
  });

  it("accepts production-like environment values", () => {
    const result = validateRequiredEnvironment({
      DATABASE_URL: "postgresql://platform:platform@db.internal:5432/platform",
      JWT_SECRET: "prod-secret-1234567890",
      KAFKA_BROKERS: "kafka-1.internal:9092,kafka-2.internal:9092",
      RABBITMQ_URL: "amqp://platform:platform@mq.internal:5672",
      REDIS_URL: "redis://cache.internal:6379",
      ELASTICSEARCH_NODE: "https://es.internal:9200",
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
