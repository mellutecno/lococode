CREATE TABLE "mc_app_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"request_text" text NOT NULL,
	"interpretation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"patch_applied" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"build_id" uuid,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mc_app_revisions" ADD CONSTRAINT "mc_app_revisions_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_app_revisions" ADD CONSTRAINT "mc_app_revisions_created_by_user_id_mc_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."mc_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_app_revisions" ADD CONSTRAINT "mc_app_revisions_build_id_mc_app_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."mc_app_builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mc_app_revisions_tenant_created_idx" ON "mc_app_revisions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "mc_app_revisions_build_idx" ON "mc_app_revisions" USING btree ("build_id");