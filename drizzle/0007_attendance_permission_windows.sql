ALTER TABLE attendance_permission
  ADD COLUMN IF NOT EXISTS arrival_window text DEFAULT 'any_time_today' NOT NULL,
  ADD COLUMN IF NOT EXISTS expected_start_time time,
  ADD COLUMN IF NOT EXISTS expected_end_time time;

UPDATE attendance_permission
SET arrival_window = 'any_time_today'
WHERE arrival_window IS NULL;
