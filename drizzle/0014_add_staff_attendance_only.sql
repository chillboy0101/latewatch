ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS is_attendance_only boolean DEFAULT false NOT NULL;
