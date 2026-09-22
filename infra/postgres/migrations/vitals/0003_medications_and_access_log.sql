CREATE TABLE IF NOT EXISTS medication_schedules (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  dose TEXT NOT NULL,
  time_of_day TEXT NOT NULL,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medication_schedules_user_idx ON medication_schedules (user_id) WHERE active;

CREATE TABLE IF NOT EXISTS medication_doses (
  id UUID PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES medication_schedules(id),
  user_id UUID NOT NULL,
  scheduled_date DATE NOT NULL,
  taken BOOLEAN NOT NULL DEFAULT false,
  taken_at TIMESTAMPTZ,
  UNIQUE (schedule_id, scheduled_date)
);
CREATE INDEX IF NOT EXISTS medication_doses_user_date_idx ON medication_doses (user_id, scheduled_date);

-- Powers the patient app's Data-shared "who viewed my chart" audit view.
CREATE TABLE IF NOT EXISTS vitals_access_log (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  accessed_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vitals_access_log_user_idx ON vitals_access_log (user_id, created_at DESC);
