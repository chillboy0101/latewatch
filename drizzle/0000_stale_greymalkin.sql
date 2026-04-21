CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"actor_user_id" uuid,
	"actor_email" text NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lateness_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"date" date NOT NULL,
	"arrival_time" time,
	"did_not_sign_out" boolean DEFAULT false,
	"reason" text,
	"computed_amount" numeric(10, 2) NOT NULL,
	"override_amount" numeric(10, 2),
	"override_reason" text,
	"overridden_by" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "lateness_entry_staff_id_date_unique" UNIQUE("staff_id","date")
);
--> statement-breakpoint
CREATE TABLE "notification_read" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp DEFAULT now(),
	CONSTRAINT "notification_read_notification_id_user_id_unique" UNIQUE("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"display_order" integer,
	"active" boolean DEFAULT true,
	"department" text,
	"unit" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "template_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"r2_key" text NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT true,
	"mapping_json" jsonb NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_calendar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"is_holiday" boolean DEFAULT false,
	"holiday_note" text,
	"source" text DEFAULT 'manual',
	"is_removed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "work_calendar_date_unique" UNIQUE("date")
);
--> statement-breakpoint
ALTER TABLE "lateness_entry" ADD CONSTRAINT "lateness_entry_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;