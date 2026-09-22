-- Opaque reference to admin_db.tenant_staff.id — no cross-database FK, per
-- docs/adr/0001-service-boundaries.md.
ALTER TABLE patient_hospital_links ADD COLUMN IF NOT EXISTS treating_clinician_id UUID;
