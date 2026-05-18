CREATE TABLE "mc_app_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"stage" varchar(16) DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"error_details" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mc_app_builds" ADD CONSTRAINT "mc_app_builds_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mc_app_builds_tenant_created_idx" ON "mc_app_builds" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "mc_app_builds_tenant_status_idx" ON "mc_app_builds" USING btree ("tenant_id","status");