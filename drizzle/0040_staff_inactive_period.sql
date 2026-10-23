-- staff_inactive_period was created directly in the live database; this records it (and the overlap
-- triggers that use enforce_attendance_permission_non_overlap from 0039) so a database built from
-- migrations matches. Safe to run on the live database: everything is IF NOT EXISTS.
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
  CONSTRAINT staff_inactive_period_staff_id_start_date_key UNIQUE (staff_id, start_date),
  CONSTRAINT staff_inactive_period_valid_range CHECK (reactivated_on IS NULL OR reactivated_on >= start_date),
  CONSTRAINT staff_inactive_period_reason_check CHECK (reason_code = ANY (ARRAY['administrative_hold', 'suspension', 'temporarily_not_monitored', 'other'])),
  CONSTRAINT staff_inactive_period_other_note_check CHECK (reason_code <> 'other' OR (note IS NOT NULL AND btrim(note) <> ''))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS staff_inactive_period_staff_date_idx ON staff_inactive_period (staff_id, start_date, reactivated_on);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS staff_inactive_period_one_open_idx ON staff_inactive_period (staff_id) WHERE reactivated_on IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'staff_inactive_period_non_overlap') THEN
    CREATE TRIGGER staff_inactive_period_non_overlap BEFORE INSERT OR UPDATE OF staff_id, start_date, reactivated_on
      ON staff_inactive_period FOR EACH ROW EXECUTE FUNCTION enforce_attendance_permission_non_overlap();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_permission_leave_non_overlap') THEN
    CREATE TRIGGER attendance_permission_leave_non_overlap BEFORE INSERT OR UPDATE OF staff_id, date, status
      ON attendance_permission FOR EACH ROW EXECUTE FUNCTION enforce_attendance_permission_non_overlap();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'staff_leave_period_non_overlap') THEN
    CREATE TRIGGER staff_leave_period_non_overlap BEFORE INSERT OR UPDATE OF staff_id, start_date, end_date
      ON staff_leave_period FOR EACH ROW EXECUTE FUNCTION enforce_attendance_permission_non_overlap();
  END IF;
END $$;
