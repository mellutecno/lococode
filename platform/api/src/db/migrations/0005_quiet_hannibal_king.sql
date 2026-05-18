CREATE TABLE "mc_ai_quotas" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"monthly_limit_micros" bigint DEFAULT 0 NOT NULL,
	"used_this_period_micros" bigint DEFAULT 0 NOT NULL,
	"period_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period_ends_at" timestamp with time zone,
	"hard_limit" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"app_user_id" uuid,
	"provider" varchar(40) DEFAULT 'openrouter' NOT NULL,
	"model" varchar(160) NOT NULL,
	"generation_id" text,
	"status" varchar(32) DEFAULT 'succeeded' NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"cost_estimated" boolean DEFAULT false NOT NULL,
	"error" text,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mc_ai_quotas" ADD CONSTRAINT "mc_ai_quotas_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_ai_usage" ADD CONSTRAINT "mc_ai_usage_tenant_id_mc_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."mc_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_ai_usage" ADD CONSTRAINT "mc_ai_usage_app_user_id_mc_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."mc_app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mc_ai_quotas_period_ends_idx" ON "mc_ai_quotas" USING btree ("period_ends_at");--> statement-breakpoint
CREATE INDEX "mc_ai_usage_tenant_created_idx" ON "mc_ai_usage" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "mc_ai_usage_app_user_idx" ON "mc_ai_usage" USING btree ("app_user_id");--> statement-breakpoint
CREATE INDEX "mc_ai_usage_generation_idx" ON "mc_ai_usage" USING btree ("generation_id");