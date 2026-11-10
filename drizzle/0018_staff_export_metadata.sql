ALTER TABLE staff ADD COLUMN IF NOT EXISTS staff_no text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS rank text;

-- The staff numbers, genders and ranks this migration first filled in are kept in the database
-- (Staff page), not in the repository.
