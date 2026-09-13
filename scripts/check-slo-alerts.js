function validateSloAlertTuning(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return { ok: true, issues: [] };
  }

  const issues = [];
  const required = [
    "P95_LATENCY_MS",
    "P99_LATENCY_MS",
    "DB_SATURATION_THRESHOLD",
    "KAFKA_LAG_THRESHOLD",
    "RABBITMQ_LAG_THRESHOLD",
    "DLQ_ALERT_SEVERITY",
    "DLQ_ALERT_OWNER",
  ];

  for (const key of required) {
    if (!env[key]) issues.push(key);
  }

  const p95LatencyMs = Number(env.P95_LATENCY_MS ?? "");
  const p99LatencyMs = Number(env.P99_LATENCY_MS ?? "");
  const dbSaturation = Number(env.DB_SATURATION_THRESHOLD ?? "");
  const kafkaLag = Number(env.KAFKA_LAG_THRESHOLD ?? "");
  const rabbitLag = Number(env.RABBITMQ_LAG_THRESHOLD ?? "");

  if (
    env.P95_LATENCY_MS &&
    (!Number.isFinite(p95LatencyMs) || p95LatencyMs <= 0)
  ) {
    issues.push("P95_LATENCY_MS");
  }
  if (
    env.P99_LATENCY_MS &&
    (!Number.isFinite(p99LatencyMs) || p99LatencyMs <= 0)
  ) {
    issues.push("P99_LATENCY_MS");
  }
  if (p95LatencyMs && p99LatencyMs && p99LatencyMs <= p95LatencyMs) {
    issues.push("P99_LATENCY_MS");
  }

  if (
    env.DB_SATURATION_THRESHOLD &&
    (!Number.isFinite(dbSaturation) || dbSaturation <= 0)
  ) {
    issues.push("DB_SATURATION_THRESHOLD");
  }

  if (
    env.KAFKA_LAG_THRESHOLD &&
    (!Number.isFinite(kafkaLag) || kafkaLag <= 0)
  ) {
    issues.push("KAFKA_LAG_THRESHOLD");
  }

  if (
    env.RABBITMQ_LAG_THRESHOLD &&
    (!Number.isFinite(rabbitLag) || rabbitLag <= 0)
  ) {
    issues.push("RABBITMQ_LAG_THRESHOLD");
  }

  if (
    env.DLQ_ALERT_SEVERITY &&
    !["warning", "ticket", "page"].includes(
      String(env.DLQ_ALERT_SEVERITY).toLowerCase(),
    )
  ) {
    issues.push("DLQ_ALERT_SEVERITY");
  }

  if (env.DLQ_ALERT_OWNER && !String(env.DLQ_ALERT_OWNER).trim()) {
    issues.push("DLQ_ALERT_OWNER");
  }

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
  };
}

if (require.main === module) {
  const result = validateSloAlertTuning();
  if (!result.ok) {
    console.error(
      `SLO and alert tuning validation failed: ${result.issues.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("SLO and alert tuning validation: OK");
}

module.exports = { validateSloAlertTuning };
