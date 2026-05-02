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
);

CREATE INDEX IF NOT EXISTS emergency_contact_staff_id_idx ON emergency_contact(staff_id);
CREATE INDEX IF NOT EXISTS emergency_contact_active_idx ON emergency_contact(active);
