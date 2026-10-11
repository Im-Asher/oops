import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { getConfig } from "@/lib/config";

const globalForDb = globalThis as unknown as { __oopsPool?: Pool };

const pool =
  globalForDb.__oopsPool ??
  new Pool({ connectionString: getConfig().DATABASE_URL });

// 开发热重载时复用连接池，避免耗尽连接
if (process.env.NODE_ENV !== "production") {
  globalForDb.__oopsPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };
