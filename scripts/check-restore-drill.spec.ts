describe("backup and restore drill validation", () => {
  it("accepts a successful backup restore exercise with PITR and reconciled state", async () => {
    const { validateBackupRestoreDrill } = require("./check-restore-drill.js");

    const result = await validateBackupRestoreDrill(
      {
        NODE_ENV: "production",
        BACKUP_RETENTION_DAYS: "30",
        PITR_ENABLED: "true",
        RESTORE_TEST_SCHEDULE: "0 2 * * 1",
        RTO_MINUTES: "60",
        RPO_MINUTES: "15",
        DR_RUNBOOK_URL: "https://runbooks.example.com/dr",
      },
      {
        fullRestoreFromBackup: {
          ok: true,
          durationMinutes: 28,
          details: "Fresh database restored from daily backup successfully",
        },
        pitrRestoreVerification: {
          ok: true,
          durationMinutes: 12,
          details: "PITR recovered to the latest valid snapshot",
        },
        rtoRpoMeasurement: {
          ok: true,
          rtoMinutes: 42,
          rpoMinutes: 8,
          details: "Restore completed within the production SLA",
        },
        outboxReconciliation: {
          ok: true,
          pending: 0,
          failed: 0,
          deadLetter: 0,
          details: "Outbox tables matched the post-restore state",
        },
        idempotencyReconciliation: {
          ok: true,
          matchedKeys: true,
          details: "Idempotency table reconciled without key conflicts",
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("fails when the restore run exceeds RTO/RPO or leaves reconciliation gaps", async () => {
    const { validateBackupRestoreDrill } = require("./check-restore-drill.js");

    const result = await validateBackupRestoreDrill(
      {
        NODE_ENV: "production",
        BACKUP_RETENTION_DAYS: "30",
        PITR_ENABLED: "true",
        RESTORE_TEST_SCHEDULE: "0 2 * * 1",
        RTO_MINUTES: "60",
        RPO_MINUTES: "15",
        DR_RUNBOOK_URL: "https://runbooks.example.com/dr",
      },
      {
        fullRestoreFromBackup: {
          ok: true,
          durationMinutes: 90,
          details: "Restore took longer than the target",
        },
        pitrRestoreVerification: {
          ok: true,
          durationMinutes: 20,
          details: "PITR restored with a small delay",
        },
        rtoRpoMeasurement: {
          ok: true,
          rtoMinutes: 80,
          rpoMinutes: 22,
          details: "Restore exceeded the objective",
        },
        outboxReconciliation: {
          ok: false,
          pending: 3,
          failed: 1,
          deadLetter: 0,
          details: "Outbox queue still has replay pending",
        },
        idempotencyReconciliation: {
          ok: false,
          matchedKeys: false,
          details: "One idempotency key conflict remains",
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "full_restore_from_backup",
        "rto_rpo_measurement",
        "outbox_reconciliation",
        "idempotency_reconciliation",
      ]),
    );
  });
});
