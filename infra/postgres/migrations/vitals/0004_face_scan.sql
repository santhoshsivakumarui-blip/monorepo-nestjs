CREATE TABLE IF NOT EXISTS face_scan_results (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  overall_score INT,
  final_vitals_score INT,
  activity_score INT,
  lifestyle_score INT,
  stress_index INT,
  cardiac_workload INT,
  parasympathetic_activity INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS face_scan_results_user_idx ON face_scan_results (user_id, created_at DESC);
