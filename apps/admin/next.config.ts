import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { loadAppEnv } from "@oops/config/load-env";

// pnpm workspace：lockfile 在仓库根而 app 在 apps/admin，root 推断有歧义；
// 显式声明为仓库根，跨包（packages/*）解析也依赖此声明。
const workspaceRoot = path.join(import.meta.dirname, "..", "..");

// 两层 env：补加载根共享层（app 层 Next 已 builtin 加载，保持优先）。
loadAppEnv(workspaceRoot, import.meta.dirname);

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  // workspace 内部包 TS 源码直出（无构建编排），由 Next 转译。
  // admin 不依赖 @oops/llm（web 专属），不列。
  transpilePackages: ["@oops/config", "@oops/db", "@oops/auth"],
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
