ALTER TYPE "public"."run_step_name" ADD VALUE 'split' BEFORE 'extracted';--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "page_numbers" integer[];--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_source_id_document_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;