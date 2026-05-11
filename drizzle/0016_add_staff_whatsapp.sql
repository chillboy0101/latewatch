ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS whatsapp_phone text;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS whatsapp_notifications_enabled boolean DEFAULT false NOT NULL;
