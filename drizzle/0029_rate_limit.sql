CREATE TABLE IF NOT EXISTS rate_limit (
  key text PRIMARY KEY,
  count integer DEFAULT 0 NOT NULL,
  window_start timestamp DEFAULT now() NOT NULL
);
