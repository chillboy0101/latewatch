ALTER TABLE attendance_record
  ADD COLUMN IF NOT EXISTS no_sign_out_waived boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS no_sign_out_waived_at timestamp,
  ADD COLUMN IF NOT EXISTS no_sign_out_waived_by_email text,
  ADD COLUMN IF NOT EXISTS no_sign_out_waived_by_user_id text,
  ADD COLUMN IF NOT EXISTS no_sign_out_waived_reason text;
