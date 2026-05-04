CREATE INDEX IF NOT EXISTS staff_active_archived_idx ON staff(active, archived);
CREATE INDEX IF NOT EXISTS staff_email_idx ON staff(email);

CREATE INDEX IF NOT EXISTS lateness_entry_date_idx ON lateness_entry(date);

CREATE INDEX IF NOT EXISTS attendance_record_date_idx ON attendance_record(date);

CREATE INDEX IF NOT EXISTS attendance_attempt_date_idx ON attendance_attempt(date);
CREATE INDEX IF NOT EXISTS attendance_attempt_staff_date_idx ON attendance_attempt(staff_id, date);

CREATE INDEX IF NOT EXISTS attendance_permission_date_idx ON attendance_permission(date);
CREATE INDEX IF NOT EXISTS attendance_permission_staff_id_idx ON attendance_permission(staff_id);

CREATE INDEX IF NOT EXISTS staff_device_user_id_idx ON staff_device(user_id);

CREATE INDEX IF NOT EXISTS emergency_contact_active_idx ON emergency_contact(active);
CREATE INDEX IF NOT EXISTS emergency_contact_staff_id_idx ON emergency_contact(staff_id);

CREATE INDEX IF NOT EXISTS audit_event_entity_idx ON audit_event(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_event_timestamp_idx ON audit_event(timestamp DESC);

CREATE INDEX IF NOT EXISTS notification_read_user_id_idx ON notification_read(user_id);
