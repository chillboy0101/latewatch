CREATE TABLE IF NOT EXISTS lateness_debt_pardon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cutoff_at timestamptz NOT NULL,
  cutoff_date date NOT NULL,
  reason text NOT NULL,
  actor_user_id text,
  actor_email text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  snapshot_hash text NOT NULL,
  entry_count integer NOT NULL,
  staff_count integer NOT NULL,
  original_penalty_total numeric(12, 2) NOT NULL,
  paid_total numeric(12, 2) NOT NULL,
  pardoned_total numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lateness_debt_pardon_cutoff_idx
  ON lateness_debt_pardon (cutoff_date);

CREATE TABLE IF NOT EXISTS lateness_debt_pardon_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pardon_id uuid NOT NULL REFERENCES lateness_debt_pardon(id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL UNIQUE REFERENCES lateness_entry(id) ON DELETE RESTRICT,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  entry_date date NOT NULL,
  penalty_amount numeric(10, 2) NOT NULL,
  paid_amount numeric(10, 2) NOT NULL,
  forgiven_amount numeric(10, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lateness_debt_pardon_entry_staff_date_idx
  ON lateness_debt_pardon_entry (staff_id, entry_date);