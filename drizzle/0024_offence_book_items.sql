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
);

CREATE INDEX IF NOT EXISTS offence_book_item_month_type_order_idx
  ON offence_book_item(month_key, item_type, display_order);
