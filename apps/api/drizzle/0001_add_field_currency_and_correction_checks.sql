ALTER TABLE "correction" ADD COLUMN "changed_checks" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "field" ADD COLUMN "currency" text;