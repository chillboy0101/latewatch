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
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS staff_no TEXT`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS gender TEXT`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS rank TEXT`);
    await db.execute(sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_nss_personnel BOOLEAN DEFAULT false NOT NULL`);
    await db.execute(sql`UPDATE staff SET archived = false WHERE archived IS NULL`);
    await db.execute(sql`
      WITH staff_export_metadata(normalized_name, staff_no, gender, rank) AS (
        VALUES
          ('georgekojolutterodt', 'GRA003825', 'MALE', 'PRO'),
          ('charlesdogbatse', 'GRA004026', 'MALE', 'SRO'),
          ('charlesdodgatse', 'GRA004026', 'MALE', 'SRO'),
          ('eyrammensahgbagbo', 'GRA005895', 'MALE', 'SRO'),
          ('annalisahammond', 'GRA007661', 'FEMALE', 'ARO'),
          ('annalisaeahammond', 'GRA007661', 'FEMALE', 'ARO'),
          ('claudekwasiboadi', 'GRA008351', 'MALE', 'ARO'),
          ('danielasarekwarteng', 'GRA009051', 'MALE', 'JRAIII'),
          ('raphaeladjeimensah', 'GRA008624', 'MALE', 'ARO'),
          ('dennisakuetteharyeetey', 'GRA002628', 'MALE', 'RA III'),
          ('estheradjorkoradjei', 'GRA008565', 'FEMALE', 'ARO'),
          ('estheradjokoradjei', 'GRA008565', 'FEMALE', 'ARO'),
          ('eunicetweneboaaadu', 'GRA008404', 'FEMALE', 'ARO')
      )
      UPDATE staff
      SET
        staff_no = staff_export_metadata.staff_no,
        gender = staff_export_metadata.gender,
        rank = staff_export_metadata.rank,
        updated_at = now()
      FROM staff_export_metadata
      WHERE regexp_replace(lower(staff.full_name), '[^a-z0-9]+', '', 'g') = staff_export_metadata.normalized_name
    `);
    await db.execute(sql`
      WITH staff_profile_restore AS (
        SELECT
          s.id,
          COALESCE(NULLIF(trim(s.staff_no), ''), (
            SELECT NULLIF(trim(COALESCE(a.before_json->>'staffNo', a.after_json->>'staffNo', '')), '')
            FROM audit_event a
            WHERE a.entity_type = 'staff'
              AND a.entity_id = s.id::text
              AND NULLIF(trim(COALESCE(a.before_json->>'staffNo', a.after_json->>'staffNo', '')), '') IS NOT NULL
            ORDER BY a.timestamp DESC
            LIMIT 1
          )) AS staff_no,
          COALESCE(NULLIF(trim(s.gender), ''), (
            SELECT NULLIF(trim(COALESCE(a.before_json->>'gender', a.after_json->>'gender', '')), '')
            FROM audit_event a
            WHERE a.entity_type = 'staff'
              AND a.entity_id = s.id::text
              AND NULLIF(trim(COALESCE(a.before_json->>'gender', a.after_json->>'gender', '')), '') IS NOT NULL
            ORDER BY a.timestamp DESC
            LIMIT 1
          )) AS gender,
          COALESCE(NULLIF(trim(s.rank), ''), (
            SELECT NULLIF(trim(COALESCE(a.before_json->>'rank', a.after_json->>'rank', '')), '')
            FROM audit_event a
            WHERE a.entity_type = 'staff'
              AND a.entity_id = s.id::text
              AND NULLIF(trim(COALESCE(a.before_json->>'rank', a.after_json->>'rank', '')), '') IS NOT NULL
            ORDER BY a.timestamp DESC
            LIMIT 1
          )) AS rank
        FROM staff s
      )
      UPDATE staff
      SET
        staff_no = staff_profile_restore.staff_no,
        gender = staff_profile_restore.gender,
        rank = staff_profile_restore.rank,
        updated_at = now()
      FROM staff_profile_restore
      WHERE staff.id = staff_profile_restore.id
        AND (
          (NULLIF(trim(COALESCE(staff.staff_no, '')), '') IS NULL AND staff_profile_restore.staff_no IS NOT NULL)
          OR (NULLIF(trim(COALESCE(staff.gender, '')), '') IS NULL AND staff_profile_restore.gender IS NOT NULL)
          OR (NULLIF(trim(COALESCE(staff.rank, '')), '') IS NULL AND staff_profile_restore.rank IS NOT NULL)
        )
    `);
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
      CREATE TABLE IF NOT EXISTS staff_leave_period (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        start_date date NOT NULL,
        end_date date,
        source text DEFAULT 'staff_status' NOT NULL,
        created_by_email text DEFAULT 'system' NOT NULL,
        closed_by_email text,
        created_at timestamp DEFAULT now(),
        closed_at timestamp,
        updated_at timestamp DEFAULT now(),
        UNIQUE(staff_id, start_date)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_leave_period_staff_date_idx ON staff_leave_period(staff_id, start_date, end_date)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS contribution_section (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        title text NOT NULL,
        display_order integer DEFAULT 0 NOT NULL,
        active boolean DEFAULT true NOT NULL,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS contribution_entry (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        section_id uuid NOT NULL REFERENCES contribution_section(id) ON DELETE CASCADE,
        contributor_name text NOT NULL,
        amount numeric(10, 2) NOT NULL,
        note text,
        display_order integer DEFAULT 0 NOT NULL,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS contribution_section_display_order_idx ON contribution_section(display_order)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS contribution_entry_section_order_idx ON contribution_entry(section_id, display_order)`);
    await db.execute(sql`
      INSERT INTO contribution_section (id, title, display_order, active)
      VALUES
        ('11111111-1111-4111-8111-111111111111', $contribution$WISDOM'S CONTRIBUTION$contribution$, 1, true),
        ('22222222-2222-4222-8222-222222222222', $contribution$RAPHAEL'S CONTRIBUTION$contribution$, 2, true),
        ('33333333-3333-4333-8333-333333333333', $contribution$MADAM SOPHIA'S CONTRIBUTION$contribution$, 3, true)
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO contribution_entry (id, section_id, contributor_name, amount, note, display_order)
      VALUES
        ('11111111-0001-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Charles Dogbatse', 200.00, NULL, 1),
        ('11111111-0002-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Eyram Mensah-Gbagbo', 200.00, NULL, 2),
        ('11111111-0003-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Anna-Lisa E. A. Hammond', 200.00, NULL, 3),
        ('11111111-0004-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Claude Kwasi Boadi', 200.00, NULL, 4),
        ('11111111-0005-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Eunice Tweneboaa Adu', 200.00, NULL, 5),
        ('11111111-0006-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Esther Adjorkor Adjei', 100.00, NULL, 6),
        ('11111111-0007-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Raphael Adjei Mensah', 200.00, NULL, 7),
        ('11111111-0008-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'Dennis Akuetteh Aryeetey', 100.00, NULL, 8),
        ('11111111-0009-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'Daniel Asare Kwarteng', 100.00, NULL, 9),
        ('22222222-0001-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Charles Dogbatse', 200.00, NULL, 1),
        ('22222222-0002-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Eyram Mensah-Gbagbo', 200.00, NULL, 2),
        ('22222222-0003-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Anna-Lisa E. A. Hammond', 200.00, NULL, 3),
        ('22222222-0004-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Claude Kwasi Boadi', 100.00, 'to be reimbursed', 4),
        ('22222222-0005-4000-8000-000000000005', '22222222-2222-4222-8222-222222222222', 'Eunice Tweneboaa Adu', 200.00, NULL, 5),
        ('22222222-0006-4000-8000-000000000006', '22222222-2222-4222-8222-222222222222', 'Esther Adjorkor Adjei', 200.00, NULL, 6),
        ('22222222-0007-4000-8000-000000000007', '22222222-2222-4222-8222-222222222222', 'Dennis Akuetteh Aryeetey', 150.00, NULL, 7),
        ('22222222-0008-4000-8000-000000000008', '22222222-2222-4222-8222-222222222222', 'Daniel Asare Kwarteng', 100.00, NULL, 8),
        ('33333333-0001-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Charles Dogbatse', 300.00, NULL, 1),
        ('33333333-0002-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Eyram Mensah-Gbagbo', 100.00, NULL, 2),
        ('33333333-0003-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'Anna-Lisa E. A. Hammond', 300.00, NULL, 3),
        ('33333333-0004-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'Claude Kwasi Boadi', 100.00, 'to be reimbursed', 4),
        ('33333333-0005-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333', 'Eunice Tweneboaa Adu', 100.00, NULL, 5),
        ('33333333-0006-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333', 'Esther Adjorkor Adjei', 100.00, NULL, 6),
        ('33333333-0007-4000-8000-000000000007', '33333333-3333-4333-8333-333333333333', 'Raphael Adjei Mensah', 200.00, 'to be reimbursed', 7),
        ('33333333-0008-4000-8000-000000000008', '33333333-3333-4333-8333-333333333333', 'Dennis Akuetteh Aryeetey', 150.00, NULL, 8),
        ('33333333-0009-4000-8000-000000000009', '33333333-3333-4333-8333-333333333333', 'Daniel Asare Kwarteng', 100.00, NULL, 9)
      ON CONFLICT (id) DO NOTHING
    `);
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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_device_device_hash_idx ON staff_device(device_hash)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_device_user_id_idx ON staff_device(user_id)`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS device_label text`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS last_verified_at timestamp`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS last_verification_method text`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS last_distance_meters numeric(10, 2)`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS auto_check_in_enabled boolean DEFAULT false NOT NULL`);
    await db.execute(sql`ALTER TABLE staff_device ADD COLUMN IF NOT EXISTS auto_sign_out_enabled boolean DEFAULT false NOT NULL`);
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
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS lateness_payment (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        amount numeric(10, 2) NOT NULL,
        week_start date NOT NULL,
        week_end date NOT NULL,
        note text,
        recorded_by_user_id text,
        recorded_by_email text NOT NULL,
        recorded_at timestamp DEFAULT now(),
        created_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS lateness_payment_allocation (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        payment_id uuid NOT NULL REFERENCES lateness_payment(id) ON DELETE CASCADE,
        entry_id uuid NOT NULL REFERENCES lateness_entry(id) ON DELETE CASCADE,
        allocated_amount numeric(10, 2) NOT NULL,
        created_at timestamp DEFAULT now(),
        UNIQUE(payment_id, entry_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS lateness_payment_staff_week_idx ON lateness_payment(staff_id, week_start, week_end)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS lateness_payment_recorded_at_idx ON lateness_payment(recorded_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS lateness_payment_allocation_payment_idx ON lateness_payment_allocation(payment_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS lateness_payment_allocation_entry_idx ON lateness_payment_allocation(entry_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS offence_book_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        month_key date NOT NULL,
        item_type text NOT NULL,
        label text NOT NULL,
        amount numeric(10, 2) NOT NULL,
        display_order integer DEFAULT 0 NOT NULL,
        created_by_email text DEFAULT 'system' NOT NULL,
        updated_by_email text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS offence_book_item_month_type_order_idx ON offence_book_item(month_key, item_type, display_order)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_subscription (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        user_id text NOT NULL,
        endpoint text NOT NULL,
        p256dh text NOT NULL,
        auth text NOT NULL,
        user_agent text,
        sign_in_enabled boolean DEFAULT true NOT NULL,
        sign_out_enabled boolean DEFAULT true NOT NULL,
        disabled_at timestamp,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        UNIQUE(endpoint)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS push_subscription_staff_idx ON push_subscription(staff_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS push_subscription_user_idx ON push_subscription(user_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_reminder_delivery (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        subscription_id uuid NOT NULL REFERENCES push_subscription(id) ON DELETE CASCADE,
        staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        date date NOT NULL,
        reminder_type text NOT NULL,
        status text NOT NULL,
        error text,
        sent_at timestamp,
        created_at timestamp DEFAULT now(),
        UNIQUE(subscription_id, date, reminder_type)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS push_reminder_delivery_date_type_idx ON push_reminder_delivery(date, reminder_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_record_date_idx ON attendance_record(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_attempt_date_idx ON attendance_attempt(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_attempt_staff_date_idx ON attendance_attempt(staff_id, date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_permission_date_idx ON attendance_permission(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_permission_staff_id_idx ON attendance_permission(staff_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_leave_period_staff_date_idx ON staff_leave_period(staff_id, start_date, end_date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS contribution_section_display_order_idx ON contribution_section(display_order)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS contribution_entry_section_order_idx ON contribution_entry(section_id, display_order)`);
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
          'staff_leave_period',
          'contribution_section',
          'contribution_entry',
          'staff_device',
          'device_transfer_request',
          'lateness_payment',
          'lateness_payment_allocation',
          'offence_book_item',
          'push_subscription',
          'push_reminder_delivery',
        ],
      },
      reason: 'schema-maintenance',
    });

    return NextResponse.json({ message: 'schema is up to date' });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
