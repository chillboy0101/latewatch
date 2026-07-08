ALTER TABLE attendance_record
  ADD COLUMN IF NOT EXISTS no_show_sign_in_waived boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS no_show_sign_in_waived_at timestamp,
  ADD COLUMN IF NOT EXISTS no_show_sign_in_waived_by_email text,
  ADD COLUMN IF NOT EXISTS no_show_sign_in_waived_by_user_id text,
  ADD COLUMN IF NOT EXISTS no_show_sign_in_waived_reason text;

ALTER TABLE attendance_record
  ALTER COLUMN check_in_at DROP NOT NULL,
  ALTER COLUMN check_in_time DROP NOT NULL;