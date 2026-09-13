describe("SLO and alert tuning gate", () => {
  const { validateSloAlertTuning } = require("./check-slo-alerts.js");

  it("fails when production latency, saturation, or alert ownership is unspecified", () => {
    const result = validateSloAlertTuning({
      NODE_ENV: "production",
      P95_LATENCY_MS: "",
      P99_LATENCY_MS: "",
      DB_SATURATION_THRESHOLD: "",
      KAFKA_LAG_THRESHOLD: "",
      RABBITMQ_LAG_THRESHOLD: "",
      DLQ_ALERT_SEVERITY: "",
      DLQ_ALERT_OWNER: "",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "P95_LATENCY_MS",
        "P99_LATENCY_MS",
        "DB_SATURATION_THRESHOLD",
        "KAFKA_LAG_THRESHOLD",
        "RABBITMQ_LAG_THRESHOLD",
        "DLQ_ALERT_SEVERITY",
        "DLQ_ALERT_OWNER",
      ]),
    );
  });

  it("accepts tuned production SLO and alert thresholds", () => {
    const result = validateSloAlertTuning({
      NODE_ENV: "production",
      P95_LATENCY_MS: "450",
      P99_LATENCY_MS: "900",
      DB_SATURATION_THRESHOLD: "85",
      KAFKA_LAG_THRESHOLD: "250",
      RABBITMQ_LAG_THRESHOLD: "200",
      DLQ_ALERT_SEVERITY: "page",
      DLQ_ALERT_OWNER: "platform-oncall",
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
