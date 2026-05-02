CREATE TABLE IF NOT EXISTS staff_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  device_hash text NOT NULL,
  user_agent text,
  registered_ip text,
  last_seen_ip text,
  registered_at timestamp DEFAULT now(),
  last_seen_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(staff_id)
);

CREATE INDEX IF NOT EXISTS staff_device_staff_id_idx ON staff_device(staff_id);
CREATE INDEX IF NOT EXISTS staff_device_user_id_idx ON staff_device(user_id);
