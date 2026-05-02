CREATE TABLE IF NOT EXISTS attendance_permission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date date NOT NULL,
  permission_type text DEFAULT 'late_arrival' NOT NULL,
  reason text NOT NULL,
  status text DEFAULT 'approved' NOT NULL,
  approved_by_user_id text,
  approved_by_email text NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(staff_id, date)
);

CREATE INDEX IF NOT EXISTS attendance_permission_date_idx ON attendance_permission(date);
CREATE INDEX IF NOT EXISTS attendance_permission_staff_id_idx ON attendance_permission(staff_id);
