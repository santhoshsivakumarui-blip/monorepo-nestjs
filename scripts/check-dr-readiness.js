function validateDisasterRecoveryReadiness(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return { ok: true, issues: [] };
  }

  const required = [
    "BACKUP_RETENTION_DAYS",
    "PITR_ENABLED",
    "RESTORE_TEST_SCHEDULE",
    "RTO_MINUTES",
    "RPO_MINUTES",
    "DR_RUNBOOK_URL",
  ];

  const issues = [];
  for (const key of required) {
    if (!env[key]) issues.push(key);
  }

  const backupRetentionDays = Number(env.BACKUP_RETENTION_DAYS ?? "");
  if (
    env.BACKUP_RETENTION_DAYS &&
    (!Number.isFinite(backupRetentionDays) || backupRetentionDays < 30)
  ) {
    issues.push("BACKUP_RETENTION_DAYS");
  }

  if (
    env.PITR_ENABLED &&
    env.PITR_ENABLED !== "true" &&
    env.PITR_ENABLED !== "false"
  ) {
    issues.push("PITR_ENABLED");
  }

  const rtoMinutes = Number(env.RTO_MINUTES ?? "");
  const rpoMinutes = Number(env.RPO_MINUTES ?? "");
  if (env.RTO_MINUTES && (!Number.isFinite(rtoMinutes) || rtoMinutes <= 0)) {
    issues.push("RTO_MINUTES");
  }
  if (env.RPO_MINUTES && (!Number.isFinite(rpoMinutes) || rpoMinutes <= 0)) {
    issues.push("RPO_MINUTES");
  }

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
  };
}

if (require.main === module) {
  const result = validateDisasterRecoveryReadiness();
  if (!result.ok) {
    console.error(
      `Disaster recovery readiness check failed: ${result.issues.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("Disaster recovery readiness: OK");
}

module.exports = { validateDisasterRecoveryReadiness };
