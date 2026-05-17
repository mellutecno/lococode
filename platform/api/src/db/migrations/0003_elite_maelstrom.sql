CREATE TABLE "mc_app_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_app_user_id" uuid,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mc_app_files" ADD CONSTRAINT "mc_app_files_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_app_files" ADD CONSTRAINT "mc_app_files_owner_app_user_id_mc_app_users_id_fk" FOREIGN KEY ("owner_app_user_id") REFERENCES "public"."mc_app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mc_app_files_tenant_idx" ON "mc_app_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mc_app_files_owner_idx" ON "mc_app_files" USING btree ("owner_app_user_id");--> statement-breakpoint
CREATE INDEX "mc_app_files_tenant_created_idx" ON "mc_app_files" USING btree ("tenant_id","created_at");