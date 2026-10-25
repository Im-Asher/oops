#!/usr/bin/env tsx
/**
 * 创作域进程入口（apps/creation）。
 *
 * 启动顺序有硬要求：`@oops/db` / `@oops/config` 在**模块求值**时就会读 env 并建连接池，
 * 所以 env 必须在任何业务模块被 import 之前加载——这里用动态 import 而不是顶层 import。
 */
import { fileURLToPath } from "node:url";
import { loadAppEnv } from "@oops/config/load-env";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function main(): Promise<void> {
  loadAppEnv(workspaceRoot, appDir);
  const { startCreationServer } = await import("./http/server");
  await startCreationServer();
}

main().catch((err) => {
  console.error("[creation] 启动失败:", err);
  process.exit(1);
});
