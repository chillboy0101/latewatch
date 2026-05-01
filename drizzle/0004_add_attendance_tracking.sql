ALTER TABLE staff ADD COLUMN IF NOT EXISTS email text;

CREATE UNIQUE INDEX IF NOT EXISTS staff_email_unique_idx
  ON staff (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS office_network (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  name text DEFAULT 'Office WiFi' NOT NULL,
  allowed_ip text NOT NULL,
  is_active boolean DEFAULT true,
  updated_by_user_id text,
  updated_by_email text NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff(id),
  date date NOT NULL,
  check_in_at timestamp NOT NULL,
  check_in_time time NOT NULL,
  status text NOT NULL,
  source text DEFAULT 'staff_portal' NOT NULL,
  network_ip text NOT NULL,
  user_agent text,
  computed_amount numeric(10, 2) DEFAULT '0' NOT NULL,
  reason text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(staff_id, date)
);

CREATE TABLE IF NOT EXISTS attendance_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  staff_id uuid REFERENCES staff(id),
  user_id text,
  user_email text NOT NULL,
  date date NOT NULL,
  network_ip text NOT NULL,
  user_agent text,
  successful boolean DEFAULT false NOT NULL,
  result text NOT NULL,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_record_date_idx ON attendance_record(date);
CREATE INDEX IF NOT EXISTS attendance_attempt_date_idx ON attendance_attempt(date);
