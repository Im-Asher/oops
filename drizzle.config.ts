import { config } from "dotenv";
import type { Config } from "drizzle-kit";

// 优先加载 .env.local（gitignored），回退到 .env
config({ path: ".env.local" });
config({ path: ".env" });

export default {
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
