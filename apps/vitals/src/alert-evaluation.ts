import { Pool, PoolClient } from "pg";

export type Comparator = "gt" | "lt";

export interface EffectiveRule {
  comparator: Comparator;
  threshold: number;
  source: "hospital_wide" | "patient_override";
}

export function breaches(value: number, comparator: Comparator, threshold: number): boolean {
  return comparator === "gt" ? value > threshold : value < threshold;
}

/**
 * A per-patient override (if enabled) always wins over the hospital-wide rule for
 * that metric. Shared by the read endpoint (GET /alert-rules/patient) and the
 * ingest-time evaluator so the two can never disagree on which rule applies.
 */
export async function resolveEffectiveRule(
  runner: Pool | PoolClient,
  userId: string,
  tenantId: string,
  metric: string,
): Promise<EffectiveRule | null> {
  const override = await runner.query<{ comparator: Comparator; threshold: string }>(
    "SELECT comparator, threshold FROM patient_alert_overrides WHERE user_id = $1 AND tenant_id = $2 AND metric = $3 AND enabled = true",
    [userId, tenantId, metric],
  );
  if (override.rows[0]) {
    return { comparator: override.rows[0].comparator, threshold: Number(override.rows[0].threshold), source: "patient_override" };
  }

  const hospitalWide = await runner.query<{ comparator: Comparator; threshold: string }>(
    "SELECT comparator, threshold FROM alert_rules WHERE tenant_id = $1 AND metric = $2 AND enabled = true",
    [tenantId, metric],
  );
  if (hospitalWide.rows[0]) {
    return { comparator: hospitalWide.rows[0].comparator, threshold: Number(hospitalWide.rows[0].threshold), source: "hospital_wide" };
  }

  return null;
}
