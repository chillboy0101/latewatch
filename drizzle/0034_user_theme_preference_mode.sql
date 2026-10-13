-- Light / dark / system mode follows the person across devices, like their theme colour.
ALTER TABLE user_theme_preference ADD COLUMN IF NOT EXISTS mode text;
