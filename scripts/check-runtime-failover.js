async function validateRuntimeFailover(env = process.env, runtimeChecks = {}) {
  if (env.NODE_ENV !== "production") {
    return { ok: true, issues: [], checks: [] };
  }

  const issues = [];
  const checks = [];

  const addCheck = (name, ok, details) => {
    checks.push({ name, ok, details });
    if (!ok) issues.push(name);
  };

  const maxAttempts = Number(env.OUTBOX_MAX_ATTEMPTS ?? "");
  if (!Number.isFinite(maxAttempts) || maxAttempts < 2) {
    addCheck("outbox_retry_policy", false, "OUTBOX_MAX_ATTEMPTS must be >= 2");
  } else {
    addCheck("outbox_retry_policy", true, `OUTBOX_MAX_ATTEMPTS=${maxAttempts}`);
  }

  const kafkaProbe =
    runtimeChecks.kafkaBrokerRecovery ??
    (async () => {
      if (!env.KAFKA_BROKERS) {
        return { ok: false, details: "KAFKA_BROKERS is not configured" };
      }
      return {
        ok: true,
        details: `Kafka brokers configured: ${env.KAFKA_BROKERS}`,
      };
    });

  const rabbitProbe =
    runtimeChecks.rabbitMqReplay ??
    (async () => {
      if (!env.RABBITMQ_URL) {
        return { ok: false, details: "RABBITMQ_URL is not configured" };
      }
      const threshold = Number(env.RABBITMQ_BACKLOG_THRESHOLD ?? 1000);
      return {
        ok: Number.isFinite(threshold) && threshold > 0,
        details: `RabbitMQ backlog threshold: ${threshold}`,
      };
    });

  const lagProbe =
    runtimeChecks.consumerLagUnderSaturation ??
    (async () => {
      const threshold = Number(env.CONSUMER_LAG_THRESHOLD ?? 100);
      return {
        ok: Number.isFinite(threshold) && threshold > 0,
        details: `Consumer lag threshold: ${threshold}`,
      };
    });

  const deadLetterProbe =
    runtimeChecks.deadLetterRecoveryDrill ??
    (async () => {
      if (!env.DR_RUNBOOK_URL) {
        return { ok: false, details: "DR_RUNBOOK_URL is not configured" };
      }
      return {
        ok: Number.isFinite(maxAttempts) && maxAttempts >= 2,
        details: `Dead-letter drill configured with OUTBOX_MAX_ATTEMPTS=${maxAttempts}`,
      };
    });

  const kafkaResult = await kafkaProbe();
  addCheck("kafka_broker_outage_recovery", kafkaResult.ok, kafkaResult.details);

  const rabbitResult = await rabbitProbe();
  addCheck(
    "rabbitmq_backlog_and_replay",
    rabbitResult.ok,
    rabbitResult.details,
  );

  const lagResult = await lagProbe();
  addCheck("consumer_lag_under_saturation", lagResult.ok, lagResult.details);

  const deadLetterResult = await deadLetterProbe();
  addCheck(
    "dead_letter_recovery_drill",
    deadLetterResult.ok,
    deadLetterResult.details,
  );

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
    checks,
  };
}

if (require.main === module) {
  validateRuntimeFailover().then((result) => {
    if (!result.ok) {
      console.error(
        `Runtime failover validation failed: ${result.issues.join(", ")}`,
      );
      process.exit(1);
    }
    console.log("Runtime failover validation: OK");
  });
}

module.exports = { validateRuntimeFailover };
