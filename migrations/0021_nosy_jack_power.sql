CREATE TABLE "timeline_annotations" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"type" varchar(50) NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "timeline_annotation_type_check" CHECK (type IN ('injury', 'illness', 'travel', 'rest')),
	CONSTRAINT "timeline_annotation_range_check" CHECK (end_date >= start_date)
);
--> statement-breakpoint
ALTER TABLE "timeline_annotations" ADD CONSTRAINT "timeline_annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_timeline_annotations_user_id" ON "timeline_annotations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_timeline_annotations_user_range" ON "timeline_annotations" USING btree ("user_id","start_date","end_date");