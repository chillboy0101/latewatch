ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS clerk_session_id text;
ALTER TABLE device_transfer_request ADD COLUMN IF NOT EXISTS clerk_session_id text;
