ALTER TABLE office_location
  ADD COLUMN IF NOT EXISTS location_kind text DEFAULT 'default' NOT NULL,
  ADD COLUMN IF NOT EXISTS google_place_id text,
  ADD COLUMN IF NOT EXISTS formatted_address text,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual' NOT NULL,
  ADD COLUMN IF NOT EXISTS schedule_start_date date,
  ADD COLUMN IF NOT EXISTS schedule_end_date date,
  ADD COLUMN IF NOT EXISTS archived_at timestamp;

UPDATE office_location
SET location_kind = 'default'
WHERE location_kind IS NULL;

UPDATE office_location
SET source = 'manual'
WHERE source IS NULL;

ALTER TABLE attendance_record
  ADD COLUMN IF NOT EXISTS check_in_office_location_id uuid REFERENCES office_location(id),
  ADD COLUMN IF NOT EXISTS sign_out_office_location_id uuid REFERENCES office_location(id);

ALTER TABLE attendance_attempt
  ADD COLUMN IF NOT EXISTS office_location_id uuid REFERENCES office_location(id);

CREATE INDEX IF NOT EXISTS office_location_kind_active_idx
  ON office_location(location_kind, is_active);

CREATE INDEX IF NOT EXISTS office_location_schedule_idx
  ON office_location(schedule_start_date, schedule_end_date);

