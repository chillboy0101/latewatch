-- Add a reversible former-staff state while preserving historical entries.
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
UPDATE "staff" SET "archived" = false WHERE "archived" IS NULL;
