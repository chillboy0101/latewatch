ALTER TABLE attendance_permission
  ADD COLUMN IF NOT EXISTS general_pardon_type text;

ALTER TABLE attendance_permission
  ADD CONSTRAINT attendance_permission_general_pardon_type_check
  CHECK (general_pardon_type IS NULL OR general_pardon_type IN ('absence', 'late_arrival'));
