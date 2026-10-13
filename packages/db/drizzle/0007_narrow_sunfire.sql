CREATE TYPE "public"."credit_ledger_status" AS ENUM('frozen', 'settled', 'released');--> statement-breakpoint
CREATE TYPE "public"."credit_ledger_type" AS ENUM('grant', 'freeze', 'settle', 'release', 'adjust');--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" "credit_ledger_type" NOT NULL,
	"amount" integer NOT NULL,
	"status" "credit_ledger_status",
	"task_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_prices" (
	"key" text PRIMARY KEY NOT NULL,
	"credits" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_task_idx" ON "credit_ledger" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_frozen_idx" ON "credit_ledger" USING btree ("user_id","status");--> statement-breakpoint
-- seed 占位定价（分）：生图 10 / 渲染 5，上线前可直接改库（后台编辑是 M2.3）
INSERT INTO "credit_prices" ("key", "credits") VALUES ('generate_image', 10), ('render_html', 5)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- 存量用户回填初始积分（100 分，须与 @oops/domain INITIAL_GRANT_CREDITS 一致）：
-- grant 流水以 note 为幂等键防重复发放；余额按流水全量重建，恒等式 balance == sum(amount) 在迁移后即成立
INSERT INTO "credit_ledger" ("user_id", "type", "amount", "note")
SELECT u."id"::text, 'grant', 100, 'initial_backfill' FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "credit_ledger" l
  WHERE l."user_id" = u."id"::text AND l."type" = 'grant' AND l."note" = 'initial_backfill'
);--> statement-breakpoint
UPDATE "users" u
SET "credit_balance" = COALESCE((
  SELECT SUM(l."amount") FROM "credit_ledger" l WHERE l."user_id" = u."id"::text
), 0);