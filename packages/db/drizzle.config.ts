import { config } from "dotenv";
import type { Config } from "drizzle-kit";

// env 文件仍归 apps/web 所有（Next.js 约定），从包目录显式指过去；
// 根脚本 db:generate/db:migrate 经 `pnpm --filter @oops/db` 进入本目录执行。
config({ path: "../../apps/web/.env.local" });
config({ path: "../../apps/web/.env" });

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
