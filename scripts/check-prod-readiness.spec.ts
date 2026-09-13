describe("production deployment readiness gate", () => {
  const { validateProductionReadiness } = require("./check-prod-readiness.js");

  it("fails when production OIDC config is incomplete", () => {
    const result = validateProductionReadiness({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://platform:platform@db.internal:5432/platform",
      JWT_SECRET: "prod-secret-1234567890",
      KAFKA_BROKERS: "kafka.internal:9092",
      RABBITMQ_URL: "amqp://platform:platform@mq.internal:5672",
      REDIS_URL: "redis://cache.internal:6379",
      ELASTICSEARCH_NODE: "https://es.internal:9200",
      OAUTH_ISSUER: "https://id.example.com/realms/platform",
      OAUTH_AUDIENCE: "api-gateway",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("OAUTH_CLIENT_ID");
  });

  it("accepts a valid production configuration", () => {
    const result = validateProductionReadiness({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://platform:platform@db.internal:5432/platform",
      JWT_SECRET: "prod-secret-1234567890",
      KAFKA_BROKERS: "kafka.internal:9092",
      RABBITMQ_URL: "amqp://platform:platform@mq.internal:5672",
      REDIS_URL: "redis://cache.internal:6379",
      ELASTICSEARCH_NODE: "https://es.internal:9200",
      JWT_ISSUER: "platform-production",
      JWT_AUDIENCE: "platform-api",
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
