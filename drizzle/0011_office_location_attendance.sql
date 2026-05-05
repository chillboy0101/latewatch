CREATE TABLE IF NOT EXISTS office_location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  name text DEFAULT 'Office Location' NOT NULL,
  latitude numeric(10, 7) NOT NULL,
  longitude numeric(10, 7) NOT NULL,
  radius_meters integer DEFAULT 100 NOT NULL,
  max_accuracy_meters integer DEFAULT 75 NOT NULL,
  is_active boolean DEFAULT true,
  updated_by_user_id text,
  updated_by_email text NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

ALTER TABLE attendance_record
  ADD COLUMN IF NOT EXISTS check_in_latitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS check_in_longitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS check_in_accuracy_meters numeric(10, 2),
  ADD COLUMN IF NOT EXISTS check_in_distance_meters numeric(10, 2),
  ADD COLUMN IF NOT EXISTS check_in_location_at timestamp,
  ADD COLUMN IF NOT EXISTS check_in_location_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS check_in_verification_result text,
  ADD COLUMN IF NOT EXISTS sign_out_latitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS sign_out_longitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS sign_out_accuracy_meters numeric(10, 2),
  ADD COLUMN IF NOT EXISTS sign_out_distance_meters numeric(10, 2),
  ADD COLUMN IF NOT EXISTS sign_out_location_at timestamp,
  ADD COLUMN IF NOT EXISTS sign_out_location_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sign_out_verification_result text;

ALTER TABLE attendance_attempt
  ADD COLUMN IF NOT EXISTS latitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS longitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS accuracy_meters numeric(10, 2),
  ADD COLUMN IF NOT EXISTS distance_meters numeric(10, 2),
  ADD COLUMN IF NOT EXISTS location_at timestamp,
  ADD COLUMN IF NOT EXISTS verification_result text;

ALTER TABLE staff_device
  ADD COLUMN IF NOT EXISTS device_label text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamp,
  ADD COLUMN IF NOT EXISTS last_verification_method text,
  ADD COLUMN IF NOT EXISTS last_distance_meters numeric(10, 2);

CREATE TABLE IF NOT EXISTS device_transfer_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  user_email text NOT NULL,
  device_hash text NOT NULL,
  device_label text,
  user_agent text,
  network_ip text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  accuracy_meters numeric(10, 2),
  distance_meters numeric(10, 2),
  location_at timestamp,
  verification_result text,
  status text DEFAULT 'pending' NOT NULL,
  reviewed_by_user_id text,
  reviewed_by_email text,
  reviewed_at timestamp,
  requested_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_transfer_request_staff_status_idx
  ON device_transfer_request(staff_id, status);

CREATE INDEX IF NOT EXISTS device_transfer_request_status_idx
  ON device_transfer_request(status);
