CREATE TABLE IF NOT EXISTS staff_inactive_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  reactivated_on date,
  reason_code text NOT NULL,
  note text,
  created_by_email text NOT NULL DEFAULT 'system',
  reactivated_by_email text,
  created_at timestamp DEFAULT now(),
  reactivated_at timestamp,
  updated_at timestamp DEFAULT now(),
  CONSTRAINT staff_inactive_period_valid_range CHECK (reactivated_on IS NULL OR reactivated_on >= start_date),
  CONSTRAINT staff_inactive_period_reason_check CHECK (
    reason_code IN ('administrative_hold', 'suspension', 'temporarily_not_monitored', 'other')
  ),
  CONSTRAINT staff_inactive_period_other_note_check CHECK (
    reason_code <> 'other' OR (note IS NOT NULL AND btrim(note) <> '')
  ),
  UNIQUE (staff_id, start_date)
);

CREATE INDEX IF NOT EXISTS staff_inactive_period_staff_date_idx
  ON staff_inactive_period(staff_id, start_date, reactivated_on);

CREATE UNIQUE INDEX IF NOT EXISTS staff_inactive_period_one_open_idx
  ON staff_inactive_period(staff_id)
  WHERE reactivated_on IS NULL;

CREATE OR REPLACE FUNCTION enforce_attendance_permission_non_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_overlap boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.staff_id::text, 0));
  IF TG_TABLE_NAME = 'staff_leave_period' THEN
    SELECT EXISTS (
      SELECT 1 FROM staff_leave_period existing_leave
      WHERE existing_leave.staff_id = NEW.staff_id
        AND existing_leave.id <> NEW.id
        AND daterange(existing_leave.start_date, COALESCE(existing_leave.end_date, 'infinity'::date), '[]')
          && daterange(NEW.start_date, COALESCE(NEW.end_date, 'infinity'::date), '[]')
    ) OR EXISTS (
      SELECT 1 FROM attendance_permission existing_permission
      WHERE existing_permission.staff_id = NEW.staff_id
        AND existing_permission.status = 'approved'
        AND existing_permission.date BETWEEN NEW.start_date AND COALESCE(NEW.end_date, 'infinity'::date)
    ) OR EXISTS (
      SELECT 1 FROM staff_inactive_period inactive_period
      WHERE inactive_period.staff_id = NEW.staff_id
        AND daterange(inactive_period.start_date, COALESCE(inactive_period.reactivated_on, 'infinity'::date), '[)')
          && daterange(NEW.start_date, COALESCE(NEW.end_date, 'infinity'::date), '[]')
    ) INTO has_overlap;
  ELSIF TG_TABLE_NAME = 'attendance_permission' THEN
    SELECT EXISTS (
      SELECT 1 FROM staff_leave_period existing_leave
      WHERE existing_leave.staff_id = NEW.staff_id
        AND NEW.date BETWEEN existing_leave.start_date AND COALESCE(existing_leave.end_date, 'infinity'::date)
    ) OR EXISTS (
      SELECT 1 FROM staff_inactive_period inactive_period
      WHERE inactive_period.staff_id = NEW.staff_id
        AND NEW.date >= inactive_period.start_date
        AND (inactive_period.reactivated_on IS NULL OR NEW.date < inactive_period.reactivated_on)
    ) INTO has_overlap;
  ELSIF TG_TABLE_NAME = 'staff_inactive_period' THEN
    SELECT EXISTS (
      SELECT 1 FROM staff_inactive_period existing_period
      WHERE existing_period.staff_id = NEW.staff_id
        AND existing_period.id <> NEW.id
        AND daterange(existing_period.start_date, COALESCE(existing_period.reactivated_on, 'infinity'::date), '[)')
          && daterange(NEW.start_date, COALESCE(NEW.reactivated_on, 'infinity'::date), '[)')
    ) OR EXISTS (
      SELECT 1 FROM staff_leave_period existing_leave
      WHERE existing_leave.staff_id = NEW.staff_id
        AND daterange(existing_leave.start_date, COALESCE(existing_leave.end_date, 'infinity'::date), '[]')
          && daterange(NEW.start_date, COALESCE(NEW.reactivated_on, 'infinity'::date), '[)')
    ) OR EXISTS (
      SELECT 1 FROM attendance_permission existing_permission
      WHERE existing_permission.staff_id = NEW.staff_id
        AND existing_permission.status = 'approved'
        AND existing_permission.date >= NEW.start_date
        AND (NEW.reactivated_on IS NULL OR existing_permission.date < NEW.reactivated_on)
    ) INTO has_overlap;
  END IF;

  IF has_overlap THEN
    RAISE EXCEPTION 'attendance_permission_overlap' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_inactive_period_non_overlap ON staff_inactive_period;
CREATE TRIGGER staff_inactive_period_non_overlap
BEFORE INSERT OR UPDATE OF staff_id, start_date, reactivated_on
ON staff_inactive_period
FOR EACH ROW EXECUTE FUNCTION enforce_attendance_permission_non_overlap();
