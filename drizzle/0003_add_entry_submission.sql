-- Track when a working day's lateness entries have been submitted,
-- even when there are no late arrivals to store in lateness_entry.
CREATE TABLE IF NOT EXISTS "entry_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"submitted_by_user_id" text,
	"submitted_by_email" text NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"deleted_count" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "entry_submission_date_unique" UNIQUE("date")
);
