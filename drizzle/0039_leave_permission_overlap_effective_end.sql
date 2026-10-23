-- One excuse per day (leave, approved permission, or deactivation), but a leave only covers the
-- days it actually ran: up to the day before an early return. Status-only leave rows
-- ('staff_status') don't block, matching the app and prevent_overlapping_staff_leave_periods.
-- GREATEST stops a same-day return from building an invalid (end before start) range.
CREATE OR REPLACE FUNCTION enforce_attendance_permission_non_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_overlap boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.staff_id::text, 0));
  IF TG_TABLE_NAME = 'staff_leave_period' THEN
    IF NEW.source = 'staff_status' THEN
      RETURN NEW;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM staff_leave_period existing_leave
      WHERE existing_leave.staff_id = NEW.staff_id
        AND existing_leave.id <> NEW.id
        AND existing_leave.source <> 'staff_status'
        AND daterange(existing_leave.start_date, GREATEST(existing_leave.start_date, COALESCE(existing_leave.returned_on - 1, existing_leave.end_date, 'infinity'::date)), '[]')
          && daterange(NEW.start_date, GREATEST(NEW.start_date, COALESCE(NEW.returned_on - 1, NEW.end_date, 'infinity'::date)), '[]')
    ) OR EXISTS (
      SELECT 1 FROM attendance_permission existing_permission
      WHERE existing_permission.staff_id = NEW.staff_id
        AND existing_permission.status = 'approved'
        AND existing_permission.date BETWEEN NEW.start_date AND COALESCE(NEW.returned_on - 1, NEW.end_date, 'infinity'::date)
    ) OR EXISTS (
      SELECT 1 FROM staff_inactive_period inactive_period
      WHERE inactive_period.staff_id = NEW.staff_id
        AND daterange(inactive_period.start_date::date, COALESCE(inactive_period.reactivated_on::date, 'infinity'::date), '[)')
          && daterange(NEW.start_date, GREATEST(NEW.start_date, COALESCE(NEW.returned_on - 1, NEW.end_date, 'infinity'::date)), '[]')
    ) INTO has_overlap;
  ELSIF TG_TABLE_NAME = 'attendance_permission' THEN
    IF NEW.status <> 'approved' THEN
      RETURN NEW;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM staff_leave_period existing_leave
      WHERE existing_leave.staff_id = NEW.staff_id
        AND existing_leave.source <> 'staff_status'
        AND NEW.date BETWEEN existing_leave.start_date AND COALESCE(existing_leave.returned_on - 1, existing_leave.end_date, 'infinity'::date)
    ) OR EXISTS (
      SELECT 1 FROM staff_inactive_period inactive_period
      WHERE inactive_period.staff_id = NEW.staff_id
        AND NEW.date >= inactive_period.start_date::date
        AND (inactive_period.reactivated_on IS NULL OR NEW.date < inactive_period.reactivated_on::date)
    ) INTO has_overlap;
  ELSIF TG_TABLE_NAME = 'staff_inactive_period' THEN
    SELECT EXISTS (
      SELECT 1 FROM staff_inactive_period existing_period
      WHERE existing_period.staff_id = NEW.staff_id
        AND existing_period.id <> NEW.id
        AND daterange(existing_period.start_date::date, COALESCE(existing_period.reactivated_on::date, 'infinity'::date), '[)')
          && daterange(NEW.start_date::date, COALESCE(NEW.reactivated_on::date, 'infinity'::date), '[)')
    ) OR EXISTS (
      SELECT 1 FROM staff_leave_period existing_leave
      WHERE existing_leave.staff_id = NEW.staff_id
        AND existing_leave.source <> 'staff_status'
        AND daterange(existing_leave.start_date, GREATEST(existing_leave.start_date, COALESCE(existing_leave.returned_on - 1, existing_leave.end_date, 'infinity'::date)), '[]')
          && daterange(NEW.start_date::date, COALESCE(NEW.reactivated_on::date, 'infinity'::date), '[)')
    ) OR EXISTS (
      SELECT 1 FROM attendance_permission existing_permission
      WHERE existing_permission.staff_id = NEW.staff_id
        AND existing_permission.status = 'approved'
        AND existing_permission.date >= NEW.start_date::date
        AND (NEW.reactivated_on IS NULL OR existing_permission.date < NEW.reactivated_on::date)
    ) INTO has_overlap;
  END IF;

  IF has_overlap THEN
    RAISE EXCEPTION 'attendance_permission_overlap' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;
