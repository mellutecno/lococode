CREATE TABLE "mc_app_user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"app_user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"user_agent" text,
	"ip" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(120),
	"role" varchar(32) DEFAULT 'user' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"plan" varchar(32) DEFAULT 'trial' NOT NULL,
	"public_registration_enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mc_app_user_sessions" ADD CONSTRAINT "mc_app_user_sessions_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_app_user_sessions" ADD CONSTRAINT "mc_app_user_sessions_app_user_id_mc_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."mc_app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_app_users" ADD CONSTRAINT "mc_app_users_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_tenants" ADD CONSTRAINT "mc_tenants_owner_user_id_mc_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."mc_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mc_app_sessions_tenant_user_idx" ON "mc_app_user_sessions" USING btree ("tenant_id","app_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mc_app_sessions_token_hash_ux" ON "mc_app_user_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mc_app_users_tenant_email_ux" ON "mc_app_users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "mc_app_users_tenant_role_idx" ON "mc_app_users" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "mc_tenants_slug_ux" ON "mc_tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "mc_tenants_owner_idx" ON "mc_tenants" USING btree ("owner_user_id");