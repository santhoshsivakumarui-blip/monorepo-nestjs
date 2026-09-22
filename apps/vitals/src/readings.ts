import { PoolClient } from "pg";
import { randomUUID } from "crypto";
import { breaches, resolveEffectiveRule } from "./alert-evaluation";

export interface ReadingInput {
  metric: string;
  value: number;
  unit: string;
  recordedAt: string;
  source: string;
}

const VITAL_SPEC: Record<string, { unit: string; min: number; max: number }> = {
  heart_rate: { unit: "bpm", min: 20, max: 250 },
  spo2: { unit: "%", min: 70, max: 100 },
  blood_pressure_systolic: { unit: "mmHg", min: 50, max: 260 },
  blood_pressure_diastolic: { unit: "mmHg", min: 30, max: 180 },
  temperature: { unit: "C", min: 30, max: 45 },
  hrv: { unit: "ms", min: 1, max: 500 },
  steps: { unit: "steps", min: 0, max: 200_000 },
  sleep_minutes: { unit: "min", min: 0, max: 1_440 },
};

/** Reject unknown units and values outside safe ingest bounds before they can
 * influence a clinical alert. These are data-quality bounds, not diagnoses. */
export function validateVitalReading(reading: ReadingInput): void {
  const spec = VITAL_SPEC[reading.metric];
  if (!spec) throw new Error(`Unsupported vital metric: ${reading.metric}`);
  if (reading.unit !== spec.unit) throw new Error(`${reading.metric} must use ${spec.unit}.`);
  if (!Number.isFinite(reading.value) || reading.value < spec.min || reading.value > spec.max) {
    throw new Error(`${reading.metric} must be between ${spec.min} and ${spec.max} ${spec.unit}.`);
  }
  if (Number.isNaN(Date.parse(reading.recordedAt))) throw new Error("recordedAt must be a valid ISO timestamp.");
}

export async function resolveLinkedTenant(client: PoolClient, userId: string): Promise<string | undefined> {
  const link = await client.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM patient_hospital_link_cache WHERE user_id = $1", [userId],
  );
  return link.rows[0]?.tenant_id;
}

/**
 * Inserts one vitals_readings row and, if the patient is linked to a tenant,
 * evaluates it against that tenant's alert rules — unconditionally on link
 * status, never gated by vitals_consent (a safety escalation must not depend
 * on the sharing toggle). Shared by POST /vitals/ingest and POST
 * /face-scan/results so both go through the exact same triage logic.
 */
export async function insertReading(
  client: PoolClient,
  userId: string,
  linkedTenantId: string | undefined,
  reading: ReadingInput,
) : Promise<boolean> {
  validateVitalReading(reading);
  const inserted = await client.query(
    `INSERT INTO vitals_readings (id, user_id, metric, value, unit, recorded_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, source, metric, unit, value, recorded_at) DO NOTHING
     RETURNING id`,
    [randomUUID(), userId, reading.metric, reading.value, reading.unit, reading.recordedAt, reading.source],
  );

  if (inserted.rowCount === 0) return false;

  if (!linkedTenantId) return true;
  const rule = await resolveEffectiveRule(client, userId, linkedTenantId, reading.metric);
  if (rule && breaches(reading.value, rule.comparator, rule.threshold)) {
    await client.query(
      `INSERT INTO triage_events (id, user_id, tenant_id, metric, value, rule_source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), userId, linkedTenantId, reading.metric, reading.value, rule.source],
    );
  }
  return true;
}
