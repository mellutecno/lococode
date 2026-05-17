CREATE TABLE "mc_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event" varchar(64) NOT NULL,
	"ip" varchar(64),
	"user_agent" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"user_agent" text,
	"ip" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(120),
	"email_verified_at" timestamp with time zone,
	"role" varchar(32) DEFAULT 'user' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mc_audit_log" ADD CONSTRAINT "mc_audit_log_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_sessions" ADD CONSTRAINT "mc_sessions_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mc_audit_user_event_idx" ON "mc_audit_log" USING btree ("user_id","event");--> statement-breakpoint
CREATE INDEX "mc_audit_created_idx" ON "mc_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mc_sessions_user_id_idx" ON "mc_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mc_sessions_token_hash_ux" ON "mc_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mc_users_email_ux" ON "mc_users" USING btree ("email");