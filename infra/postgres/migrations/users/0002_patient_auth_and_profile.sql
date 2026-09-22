-- Phone-only patient signup must not require email.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS otp_challenges (
  id UUID PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_challenges_phone_idx ON otp_challenges (phone, created_at);

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  full_name TEXT,
  dob DATE,
  sex TEXT,
  height_cm NUMERIC,
  weight_kg NUMERIC,
  residency_status TEXT,
  passport_number TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relationship TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
