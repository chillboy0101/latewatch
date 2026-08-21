ALTER TABLE staff_leave_period
  ADD COLUMN IF NOT EXISTS leave_type text DEFAULT 'other' NOT NULL,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS updated_by_email text;

UPDATE staff_leave_period
SET leave_type = 'other'
WHERE leave_type IS NULL OR btrim(leave_type) = '';

CREATE OR REPLACE FUNCTION enforce_attendance_permission_non_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  has_conflict boolean;
BEGIN
  -- Serializes permission writes for one staff member, including writes split
  -- across attendance_permission and staff_leave_period.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.staff_id::text, 0));

  IF TG_TABLE_NAME = 'staff_leave_period' THEN
    SELECT EXISTS (
      SELECT 1
      FROM staff_leave_period existing_leave
      WHERE existing_leave.staff_id = NEW.staff_id
        AND existing_leave.id <> NEW.id
        AND daterange(existing_leave.start_date, COALESCE(existing_leave.end_date, 'infinity'::date), '[]')
          && daterange(NEW.start_date, COALESCE(NEW.end_date, 'infinity'::date), '[]')
      UNION ALL
      SELECT 1
      FROM attendance_permission existing_permission
      WHERE existing_permission.staff_id = NEW.staff_id
        AND existing_permission.status = 'approved'
        AND existing_permission.date BETWEEN NEW.start_date AND COALESCE(NEW.end_date, 'infinity'::date)
    ) INTO has_conflict;
  ELSE
    IF NEW.status <> 'approved' THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM staff_leave_period existing_leave
      WHERE existing_leave.staff_id = NEW.staff_id
        AND NEW.date BETWEEN existing_leave.start_date AND COALESCE(existing_leave.end_date, 'infinity'::date)
    ) INTO has_conflict;
  END IF;

  IF has_conflict THEN
    RAISE EXCEPTION 'attendance_permission_overlap'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS staff_leave_period_non_overlap ON staff_leave_period;
CREATE TRIGGER staff_leave_period_non_overlap
BEFORE INSERT OR UPDATE OF staff_id, start_date, end_date
ON staff_leave_period
FOR EACH ROW EXECUTE FUNCTION enforce_attendance_permission_non_overlap();

DROP TRIGGER IF EXISTS attendance_permission_leave_non_overlap ON attendance_permission;
CREATE TRIGGER attendance_permission_leave_non_overlap
BEFORE INSERT OR UPDATE OF staff_id, date, status
ON attendance_permission
FOR EACH ROW EXECUTE FUNCTION enforce_attendance_permission_non_overlap();
