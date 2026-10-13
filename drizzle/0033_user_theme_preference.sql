-- One theme colour per signed-in person, shared by every device they use.
CREATE TABLE IF NOT EXISTS user_theme_preference (
  user_id text PRIMARY KEY,
  accent text NOT NULL,
  custom_color text NOT NULL,
  updated_at bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
