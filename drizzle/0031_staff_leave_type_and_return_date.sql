ALTER TABLE staff_leave_period
  ADD COLUMN IF NOT EXISTS leave_type text DEFAULT 'other' NOT NULL,
  ADD COLUMN IF NOT EXISTS returned_on date;

ALTER TABLE staff_leave_period
  ADD CONSTRAINT staff_leave_period_type_check
  CHECK (leave_type IN ('annual', 'sick', 'maternity_paternity', 'study', 'other'));

ALTER TABLE staff_leave_period
  ADD CONSTRAINT staff_leave_period_returned_on_check
  CHECK (returned_on IS NULL OR returned_on >= start_date);

ALTER TABLE staff_leave_period
  DROP CONSTRAINT IF EXISTS staff_leave_period_staff_id_start_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS staff_leave_period_approved_start_idx
  ON staff_leave_period (staff_id, start_date)
  WHERE source = 'approved_leave';

CREATE OR REPLACE FUNCTION prevent_overlapping_staff_leave_periods()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source <> 'approved_leave' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.staff_id::text, 0));

  IF TG_OP = 'UPDATE' THEN
    IF OLD.source = 'approved_leave'
      AND NEW.staff_id = OLD.staff_id
      AND NEW.start_date = OLD.start_date
      AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date
      AND OLD.returned_on IS NULL
      AND NEW.returned_on IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM staff_leave_period existing
    WHERE existing.staff_id = NEW.staff_id
      AND existing.id <> NEW.id
      AND existing.source <> 'staff_status'
      AND existing.start_date <= COALESCE(NEW.returned_on - 1, NEW.end_date, 'infinity'::date)
      AND COALESCE(existing.returned_on - 1, existing.end_date, 'infinity'::date) >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'Leave dates overlap an existing leave or approved absence period'
      USING ERRCODE = '23P01', CONSTRAINT = 'staff_leave_period_no_overlap';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_leave_period_no_overlap_trigger ON staff_leave_period;
CREATE TRIGGER staff_leave_period_no_overlap_trigger
  BEFORE INSERT OR UPDATE OF staff_id, start_date, end_date, returned_on, source
  ON staff_leave_period
  FOR EACH ROW
  EXECUTE FUNCTION prevent_overlapping_staff_leave_periods();