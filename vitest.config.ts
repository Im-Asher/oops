import { defineConfig } from "vitest/config";

// 根聚合配置：`pnpm exec vitest run` 于仓库根单进程跑全部包测试。
// 各包 `pnpm -r test` 仍走各自目录的 vitest run，互不影响。
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
  },
});
