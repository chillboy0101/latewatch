ALTER TABLE office_location
  ALTER COLUMN radius_meters SET DEFAULT 80;

UPDATE office_location
SET radius_meters = 80,
    updated_at = NOW()
WHERE location_kind = 'default'
  AND is_active = true
  AND archived_at IS NULL
  AND radius_meters <> 80;
