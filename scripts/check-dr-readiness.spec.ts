describe("disaster recovery readiness gate", () => {
  const {
    validateDisasterRecoveryReadiness,
  } = require("./check-dr-readiness.js");

  it("fails when backup retention or restore testing is not configured", () => {
    const result = validateDisasterRecoveryReadiness({
      NODE_ENV: "production",
      BACKUP_RETENTION_DAYS: "7",
      PITR_ENABLED: "false",
      RESTORE_TEST_SCHEDULE: "",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("BACKUP_RETENTION_DAYS");
    expect(result.issues).toContain("RESTORE_TEST_SCHEDULE");
  });

  it("accepts a valid backup and DR policy", () => {
    const result = validateDisasterRecoveryReadiness({
      NODE_ENV: "production",
      BACKUP_RETENTION_DAYS: "30",
      PITR_ENABLED: "true",
      RESTORE_TEST_SCHEDULE: "0 2 * * 1",
      RTO_MINUTES: "60",
      RPO_MINUTES: "15",
      DR_RUNBOOK_URL: "https://runbooks.example.com/dr",
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
