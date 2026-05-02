// Idempotent local schema repair for legacy development databases.
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS display_order INTEGER`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS email TEXT`);
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

    return NextResponse.json({ message: 'schema is up to date' });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
