CREATE TABLE "mc_app_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"label" varchar(160),
	"json_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_app_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity" varchar(80) NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_app_user_id" uuid,
	"updated_by_app_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mc_app_entities" ADD CONSTRAINT "mc_app_entities_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_app_records" ADD CONSTRAINT "mc_app_records_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_app_records" ADD CONSTRAINT "mc_app_records_entity_id_mc_app_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."mc_app_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_app_records" ADD CONSTRAINT "mc_app_records_created_by_app_user_id_mc_app_users_id_fk" FOREIGN KEY ("created_by_app_user_id") REFERENCES "public"."mc_app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_app_records" ADD CONSTRAINT "mc_app_records_updated_by_app_user_id_mc_app_users_id_fk" FOREIGN KEY ("updated_by_app_user_id") REFERENCES "public"."mc_app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mc_app_entities_tenant_name_ux" ON "mc_app_entities" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "mc_app_entities_tenant_idx" ON "mc_app_entities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mc_app_records_tenant_entity_idx" ON "mc_app_records" USING btree ("tenant_id","entity");--> statement-breakpoint
CREATE INDEX "mc_app_records_entity_id_idx" ON "mc_app_records" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "mc_app_records_tenant_created_idx" ON "mc_app_records" USING btree ("tenant_id","created_at");