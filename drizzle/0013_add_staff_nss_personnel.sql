ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS is_nss_personnel boolean DEFAULT false NOT NULL;
