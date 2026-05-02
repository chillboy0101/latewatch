ALTER TABLE attendance_record
  ADD COLUMN IF NOT EXISTS sign_out_at timestamp,
  ADD COLUMN IF NOT EXISTS sign_out_time time,
  ADD COLUMN IF NOT EXISTS sign_out_network_ip text,
  ADD COLUMN IF NOT EXISTS sign_out_user_agent text;
