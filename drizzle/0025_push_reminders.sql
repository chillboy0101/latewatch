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
);

CREATE INDEX IF NOT EXISTS push_subscription_staff_idx
  ON push_subscription(staff_id);

CREATE INDEX IF NOT EXISTS push_subscription_user_idx
  ON push_subscription(user_id);

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
);

CREATE INDEX IF NOT EXISTS push_reminder_delivery_date_type_idx
  ON push_reminder_delivery(date, reminder_type);
