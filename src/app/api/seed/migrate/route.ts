// Idempotent local schema repair for legacy development databases.
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { tryWriteAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS display_order INTEGER`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS email TEXT`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS whatsapp_notifications_enabled BOOLEAN DEFAULT false NOT NULL`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_nss_personnel BOOLEAN DEFAULT false NOT NULL`);
    await db.execute(sql`UPDATE staff SET archived = false WHERE archived IS NULL`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS staff_email_unique_idx
      ON staff (lower(email))
      WHERE email IS NOT NULL
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS entry_submission (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        date date UNIQUE NOT NULL,
        submitted_by_user_id text,
        submitted_by_email text NOT NULL,
        entry_count integer DEFAULT 0 NOT NULL,
        deleted_count integer DEFAULT 0 NOT NULL,
        submitted_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS office_network (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        name text DEFAULT 'Office WiFi' NOT NULL,
        allowed_ip text NOT NULL,
        is_active boolean DEFAULT true,
        updated_by_user_id text,
        updated_by_email text NOT NULL,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS office_location (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        name text DEFAULT 'Office Location' NOT NULL,
        latitude numeric(10, 7) NOT NULL,
        longitude numeric(10, 7) NOT NULL,
        radius_meters integer DEFAULT 100 NOT NULL,
        max_accuracy_meters integer DEFAULT 75 NOT NULL,
        location_kind text DEFAULT 'default' NOT NULL,
        google_place_id text,
        formatted_address text,
        source text DEFAULT 'manual' NOT NULL,
        schedule_start_date date,
        schedule_end_date date,
        is_active boolean DEFAULT true,
        archived_at timestamp,
        updated_by_user_id text,
        updated_by_email text NOT NULL,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`ALTER TABLE office_location ADD COLUMN IF NOT EXISTS location_kind text DEFAULT 'default' NOT NULL`);
    await db.execute(sql`ALTER TABLE office_location ADD COLUMN IF NOT EXISTS google_place_id text`);
    await db.execute(sql`ALTER TABLE office_location ADD COLUMN IF NOT EXISTS formatted_address text`);
    await db.execute(sql`ALTER TABLE office_location ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual' NOT NULL`);
    await db.execute(sql`ALTER TABLE office_location ADD COLUMN IF NOT EXISTS schedule_start_date date`);
    await db.execute(sql`ALTER TABLE office_location ADD COLUMN IF NOT EXISTS schedule_end_date date`);
    await db.execute(sql`ALTER TABLE office_location ADD COLUMN IF NOT EXISTS archived_at timestamp`);
    await db.execute(sql`UPDATE office_location SET location_kind = 'default' WHERE location_kind IS NULL`);
    await db.execute(sql`UPDATE office_location SET source = 'manual' WHERE source IS NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS office_location_kind_active_idx ON office_location(location_kind, is_active)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS office_location_schedule_idx ON office_location(schedule_start_date, schedule_end_date)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_record (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        staff_id uuid NOT NULL REFERENCES staff(id),
        date date NOT NULL,
        check_in_at timestamp NOT NULL,
        check_in_time time NOT NULL,
        sign_out_at timestamp,
        sign_out_time time,
        sign_out_network_ip text,
        sign_out_user_agent text,
        status text NOT NULL,
        source text DEFAULT 'staff_portal' NOT NULL,
        network_ip text NOT NULL,
        user_agent text,
        computed_amount numeric(10, 2) DEFAULT '0' NOT NULL,
        reason text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        UNIQUE(staff_id, date)
      )
    `);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_at timestamp`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_time time`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_network_ip text`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_user_agent text`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS check_in_latitude numeric(10, 7)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS check_in_longitude numeric(10, 7)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS check_in_office_location_id uuid REFERENCES office_location(id)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS check_in_accuracy_meters numeric(10, 2)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS check_in_distance_meters numeric(10, 2)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS check_in_location_at timestamp`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS check_in_location_verified boolean DEFAULT false`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS check_in_verification_result text`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_latitude numeric(10, 7)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_longitude numeric(10, 7)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_office_location_id uuid REFERENCES office_location(id)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_accuracy_meters numeric(10, 2)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_distance_meters numeric(10, 2)`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_location_at timestamp`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_location_verified boolean DEFAULT false`);
    await db.execute(sql`ALTER TABLE attendance_record ADD COLUMN IF NOT EXISTS sign_out_verification_result text`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_attempt (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        staff_id uuid REFERENCES staff(id),
        user_id text,
        user_email text NOT NULL,
        date date NOT NULL,
        network_ip text NOT NULL,
        user_agent text,
        successful boolean DEFAULT false NOT NULL,
        result text NOT NULL,
        created_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_record_date_idx ON attendance_record(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_attempt_date_idx ON attendance_attempt(date)`);
    await db.execute(sql`ALTER TABLE attendance_attempt ADD COLUMN IF NOT EXISTS latitude numeric(10, 7)`);
    await db.execute(sql`ALTER TABLE attendance_attempt ADD COLUMN IF NOT EXISTS longitude numeric(10, 7)`);
    await db.execute(sql`ALTER TABLE attendance_attempt ADD COLUMN IF NOT EXISTS office_location_id uuid REFERENCES office_location(id)`);
    await db.execute(sql`ALTER TABLE attendance_attempt ADD COLUMN IF NOT EXISTS accuracy_meters numeric(10, 2)`);
    await db.execute(sql`ALTER TABLE attendance_attempt ADD COLUMN IF NOT EXISTS distance_meters numeric(10, 2)`);
    await db.execute(sql`ALTER TABLE attendance_attempt ADD COLUMN IF NOT EXISTS location_at timestamp`);
    await db.execute(sql`ALTER TABLE attendance_attempt ADD COLUMN IF NOT EXISTS verification_result text`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS emergency_contact (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
        contact_name text NOT NULL,
        relationship text,
        phone text NOT NULL,
        alternate_phone text,
        email text,
        address text,
        notes text,
        priority text DEFAULT 'primary' NOT NULL,
        active boolean DEFAULT true,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS emergency_contact_staff_id_idx ON emergency_contact(staff_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS emergency_contact_active_idx ON emergency_contact(active)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_permission (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        date date NOT NULL,
        permission_type text DEFAULT 'late_arrival' NOT NULL,
        arrival_window text DEFAULT 'any_time_today' NOT NULL,
        expected_start_time time,
        expected_end_time time,
        reason text NOT NULL,
        status text DEFAULT 'approved' NOT NULL,
        approved_by_user_id text,
        approved_by_email text NOT NULL,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        UNIQUE(staff_id, date)
      )
    `);
    await db.execute(sql`ALTER TABLE attendance_permission ADD COLUMN IF NOT EXISTS arrival_window text DEFAULT 'any_time_today' NOT NULL`);
    await db.execute(sql`ALTER TABLE attendance_permission ADD COLUMN IF NOT EXISTS expected_start_time time`);
    await db.execute(sql`ALTER TABLE attendance_permission ADD COLUMN IF NOT EXISTS expected_end_time time`);
    await db.execute(sql`UPDATE attendance_permission SET arrival_window = 'any_time_today' WHERE arrival_window IS NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_permission_date_idx ON attendance_permission(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_permission_staff_id_idx ON attendance_permission(staff_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS staff_device (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        user_id text NOT NULL,
        device_hash text NOT NULL,
        user_agent text,
        registered_ip text,
        last_seen_ip text,
        registered_at timestamp DEFAULT now(),
        last_seen_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        UNIQUE(staff_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_device_staff_id_idx ON staff_device(staff_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_device_user_id_idx ON staff_device(user_id)`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS device_label text`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS last_verified_at timestamp`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS last_verification_method text`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS last_distance_meters numeric(10, 2)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS device_transfer_request (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        user_id text NOT NULL,
        user_email text NOT NULL,
        device_hash text NOT NULL,
        device_label text,
        user_agent text,
        network_ip text,
        latitude numeric(10, 7),
        longitude numeric(10, 7),
        accuracy_meters numeric(10, 2),
        distance_meters numeric(10, 2),
        location_at timestamp,
        verification_result text,
        status text DEFAULT 'pending' NOT NULL,
        reviewed_by_user_id text,
        reviewed_by_email text,
        reviewed_at timestamp,
        requested_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS device_transfer_request_staff_status_idx ON device_transfer_request(staff_id, status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS device_transfer_request_status_idx ON device_transfer_request(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_active_archived_idx ON staff(active, archived)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_email_idx ON staff(email)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS lateness_entry_date_idx ON lateness_entry(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_record_date_idx ON attendance_record(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_attempt_date_idx ON attendance_attempt(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_attempt_staff_date_idx ON attendance_attempt(staff_id, date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_permission_date_idx ON attendance_permission(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_permission_staff_id_idx ON attendance_permission(staff_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS emergency_contact_active_idx ON emergency_contact(active)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS emergency_contact_staff_id_idx ON emergency_contact(staff_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_event_entity_idx ON audit_event(entity_type, entity_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_event_timestamp_idx ON audit_event(timestamp DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS notification_read_user_id_idx ON notification_read(user_id)`);

    await tryWriteAuditEvent({
      entityType: 'system',
      entityId: 'schema-maintenance',
      action: 'UPDATE',
      before: null,
      after: {
        operation: 'schema repair',
        result: 'schema is up to date',
        tables: [
          'staff',
          'entry_submission',
          'office_network',
          'office_location',
          'attendance_record',
          'attendance_attempt',
          'emergency_contact',
          'attendance_permission',
          'staff_device',
          'device_transfer_request',
        ],
      },
      reason: 'schema-maintenance',
    });

    return NextResponse.json({ message: 'schema is up to date' });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
