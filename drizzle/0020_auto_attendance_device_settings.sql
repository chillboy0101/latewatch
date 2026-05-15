ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS auto_check_in_enabled boolean DEFAULT false NOT NULL;
ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS auto_sign_out_enabled boolean DEFAULT false NOT NULL;
