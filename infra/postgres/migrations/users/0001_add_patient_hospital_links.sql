-- Single active hospital link per patient, matching the patient app's "only one
-- hospital at a time" rule. No server-side history is kept; the row is deleted on unlink.
CREATE TABLE IF NOT EXISTS patient_hospital_links (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  tenant_id UUID NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
