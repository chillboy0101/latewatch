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
);

CREATE TABLE IF NOT EXISTS lateness_payment_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  payment_id uuid NOT NULL REFERENCES lateness_payment(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES lateness_entry(id) ON DELETE CASCADE,
  allocated_amount numeric(10, 2) NOT NULL,
  created_at timestamp DEFAULT now(),
  UNIQUE(payment_id, entry_id)
);

CREATE INDEX IF NOT EXISTS lateness_payment_staff_week_idx
  ON lateness_payment(staff_id, week_start, week_end);

CREATE INDEX IF NOT EXISTS lateness_payment_recorded_at_idx
  ON lateness_payment(recorded_at);

CREATE INDEX IF NOT EXISTS lateness_payment_allocation_payment_idx
  ON lateness_payment_allocation(payment_id);

CREATE INDEX IF NOT EXISTS lateness_payment_allocation_entry_idx
  ON lateness_payment_allocation(entry_id);
