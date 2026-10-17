-- Live location shared by an admin while walking the office grounds (Location -> Measure grounds).
-- Retired: migration 0037 drops this table and all stored traces; no API cleanup runs.
CREATE TABLE IF NOT EXISTS location_trace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  latitude numeric(10, 7) NOT NULL,
  longitude numeric(10, 7) NOT NULL,
  accuracy_meters numeric(10, 2) NOT NULL,
  captured_at timestamp NOT NULL,
  note text,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS location_trace_user_captured_idx ON location_trace (user_id, captured_at);
