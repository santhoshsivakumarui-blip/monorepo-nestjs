async function validateBackupRestoreDrill(env = process.env, results = {}) {
  if (env.NODE_ENV !== "production") {
    return { ok: true, issues: [], checks: [] };
  }

  const issues = [];
  const checks = [];

  const addCheck = (name, ok, details) => {
    checks.push({ name, ok, details });
    if (!ok) issues.push(name);
  };

  const required = [
    "BACKUP_RETENTION_DAYS",
    "PITR_ENABLED",
    "RESTORE_TEST_SCHEDULE",
    "RTO_MINUTES",
    "RPO_MINUTES",
    "DR_RUNBOOK_URL",
  ];

  for (const key of required) {
    if (!env[key]) {
      addCheck(`dr_policy_${key.toLowerCase()}`, false, `${key} is required`);
    }
  }

  const rtoMinutes = Number(env.RTO_MINUTES ?? "");
  const rpoMinutes = Number(env.RPO_MINUTES ?? "");
  if (!Number.isFinite(rtoMinutes) || rtoMinutes <= 0) {
    addCheck(
      "rto_rpo_measurement",
      false,
      "RTO_MINUTES must be a positive number",
    );
  }
  if (!Number.isFinite(rpoMinutes) || rpoMinutes <= 0) {
    addCheck(
      "rto_rpo_measurement",
      false,
      "RPO_MINUTES must be a positive number",
    );
  }

  const backup = results.fullRestoreFromBackup ?? {
    ok: false,
    durationMinutes: Infinity,
  };
  if (backup.ok && Number.isFinite(Number(backup.durationMinutes))) {
    const targetRto = Number(env.RTO_MINUTES ?? 0);
    const ok = Number(backup.durationMinutes) <= targetRto;
    addCheck(
      "full_restore_from_backup",
      ok,
      backup.details ?? `Restore duration ${backup.durationMinutes} minutes`,
    );
  } else {
    addCheck(
      "full_restore_from_backup",
      false,
      backup.details ?? "Full restore from backup did not complete",
    );
  }

  const pitr = results.pitrRestoreVerification ?? { ok: false };
  addCheck(
    "pitr_restore_verification",
    !!pitr.ok,
    pitr.details ?? "PITR restore verification did not complete",
  );

  const rtoRpo = results.rtoRpoMeasurement ?? { ok: false };
  const targetRto = Number(env.RTO_MINUTES ?? 0);
  const targetRpo = Number(env.RPO_MINUTES ?? 0);
  const rtoOk =
    !!rtoRpo.ok &&
    Number.isFinite(Number(rtoRpo.rtoMinutes)) &&
    Number(rtoRpo.rtoMinutes) <= targetRto;
  const rpoOk =
    !!rtoRpo.ok &&
    Number.isFinite(Number(rtoRpo.rpoMinutes)) &&
    Number(rtoRpo.rpoMinutes) <= targetRpo;

  addCheck(
    "rto_rpo_measurement",
    rtoOk && rpoOk,
    rtoRpo.details ??
      `RTO/RPO measured: ${rtoRpo.rtoMinutes ?? "n/a"}/${rtoRpo.rpoMinutes ?? "n/a"}`,
  );

  const outbox = results.outboxReconciliation ?? { ok: false };
  addCheck(
    "outbox_reconciliation",
    !!outbox.ok &&
      Number(outbox.pending ?? 0) === 0 &&
      Number(outbox.failed ?? 0) === 0 &&
      Number(outbox.deadLetter ?? 0) === 0,
    outbox.details ??
      `Outbox reconcile: pending=${outbox.pending ?? 0}, failed=${outbox.failed ?? 0}, deadLetter=${outbox.deadLetter ?? 0}`,
  );

  const idempotency = results.idempotencyReconciliation ?? { ok: false };
  addCheck(
    "idempotency_reconciliation",
    !!idempotency.ok && idempotency.matchedKeys !== false,
    idempotency.details ?? "Idempotency reconciliation failed",
  );

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
    checks,
  };
}

if (require.main === module) {
  validateBackupRestoreDrill().then((result) => {
    if (!result.ok) {
      console.error(
        `Backup and restore drill validation failed: ${result.issues.join(", ")}`,
      );
      process.exit(1);
    }
    console.log("Backup and restore drill validation: OK");
  });
}

module.exports = { validateBackupRestoreDrill };
