CREATE TABLE IF NOT EXISTS contribution_section (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  title text NOT NULL,
  display_order integer DEFAULT 0 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contribution_section_display_order_idx
  ON contribution_section(display_order);

CREATE TABLE IF NOT EXISTS contribution_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  section_id uuid NOT NULL REFERENCES contribution_section(id) ON DELETE CASCADE,
  contributor_name text NOT NULL,
  amount numeric(10, 2) NOT NULL,
  note text,
  display_order integer DEFAULT 0 NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contribution_entry_section_order_idx
  ON contribution_entry(section_id, display_order);

-- The contribution sections and entries this migration first loaded are kept in the database
-- (Contributions page), not in the repository.
