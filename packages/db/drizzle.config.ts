import path from "node:path";
import type { Config } from "drizzle-kit";
import { loadAppEnv } from "@oops/config/load-env";

// 两层 env：脚本类入口只加载根共享层（db 只消费 DATABASE_URL 等共享键）。
// drizzle-kit 经 esbuild 转译后运行（import.meta.dirname 为 undefined），
// 且根脚本 db:* 经 `pnpm --filter @oops/db` 进入本目录执行——cwd 恒为包目录。
loadAppEnv(path.resolve(process.cwd(), "..", ".."));

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
