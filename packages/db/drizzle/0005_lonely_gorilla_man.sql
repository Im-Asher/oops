CREATE TYPE "public"."user_gender" AS ENUM('male', 'female', 'secret');--> statement-breakpoint
-- oops_id 分三步：可空加列 → 存量行回填生成 → 补 NOT NULL（直接 NOT NULL 加列会因存量行失败）
ALTER TABLE "users" ADD COLUMN "oops_id" text;--> statement-breakpoint
UPDATE "users" u
SET "oops_id" = (
  -- 以 u.id 关联标量子查询，强制逐行求值（不关联会被 InitPlan 只算一次导致全部同值）
  SELECT string_agg(
    substring('23456789abcdefghjkmnpqrstuvwxyz' FROM ((ascii(md5(u.id::text || g::text)) % 31) + 1)::int FOR 1),
    ''
  )
  FROM generate_series(1, 8) g
)
WHERE u."oops_id" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "oops_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" "user_gender" DEFAULT 'secret' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_oops_id_idx" ON "users" USING btree ("oops_id");