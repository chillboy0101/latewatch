CREATE TABLE IF NOT EXISTS staff_leave_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date,
  source text DEFAULT 'staff_status' NOT NULL,
  created_by_email text DEFAULT 'system' NOT NULL,
  closed_by_email text,
  created_at timestamp DEFAULT now(),
  closed_at timestamp,
  updated_at timestamp DEFAULT now(),
  UNIQUE(staff_id, start_date)
);

CREATE INDEX IF NOT EXISTS staff_leave_period_staff_date_idx
  ON staff_leave_period(staff_id, start_date, end_date);
