-- One profile per person through every type (intern -> NSS -> special staff -> main staff).
-- staff_type is the current type; is_nss_personnel / is_attendance_only stay in step with it.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS staff_type text NOT NULL DEFAULT 'main';
UPDATE staff SET staff_type = CASE
  WHEN is_attendance_only THEN 'special'
  WHEN is_nss_personnel THEN 'nss'
  ELSE 'main'
END
WHERE staff_type = 'main' AND (is_attendance_only OR is_nss_personnel);
DO $$ BEGIN
  ALTER TABLE staff ADD CONSTRAINT staff_type_check CHECK (staff_type IN ('intern', 'nss', 'special', 'main'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The type from a date on ('away' while deactivated or archived). Charges for a day use the type
-- on that day, so a change never reaches back into days under an earlier type.
CREATE TABLE IF NOT EXISTS staff_type_change (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  staff_type text NOT NULL CHECK (staff_type IN ('intern', 'nss', 'special', 'main', 'away')),
  effective_from date NOT NULL,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_type_change_staff_date_idx ON staff_type_change (staff_id, effective_from);

-- People already deactivated or archived: their days since leaving are away (never charged), so a
-- later restore never back-charges them. Earlier days keep their type.
INSERT INTO staff_type_change (staff_id, staff_type, effective_from, created_by_email)
SELECT s.id, s.staff_type, DATE '2000-01-01', 'migration'
FROM staff s
WHERE (s.archived OR NOT s.active)
  AND NOT EXISTS (SELECT 1 FROM staff_type_change c WHERE c.staff_id = s.id);
INSERT INTO staff_type_change (staff_id, staff_type, effective_from, created_by_email)
SELECT s.id, 'away', COALESCE(s.archived_at, s.updated_at, now()::timestamp)::date + 1, 'migration'
FROM staff s
WHERE (s.archived OR NOT s.active)
  AND NOT EXISTS (SELECT 1 FROM staff_type_change c WHERE c.staff_id = s.id AND c.staff_type = 'away');
