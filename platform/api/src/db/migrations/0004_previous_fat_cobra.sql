CREATE TABLE "mc_email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"app_user_id" uuid,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" varchar(200) NOT NULL,
	"status" varchar(32) DEFAULT 'sent' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mc_email_log" ADD CONSTRAINT "mc_email_log_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_email_log" ADD CONSTRAINT "mc_email_log_app_user_id_mc_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."mc_app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mc_email_log_tenant_created_idx" ON "mc_email_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "mc_email_log_app_user_idx" ON "mc_email_log" USING btree ("app_user_id");