-- A health platform can return the same immutable measurement in more than one
-- read window.  The database, rather than a device-local cursor, is the final
-- duplicate boundary so reinstalls and retries remain safe.
CREATE UNIQUE INDEX IF NOT EXISTS vitals_readings_source_sample_unique
  ON vitals_readings (user_id, source, metric, unit, value, recorded_at);
