import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// pnpm workspace：lockfile 在仓库根而 app 在 apps/web，root 推断有歧义；
// 显式声明为仓库根，M0.2 抽包后跨包（packages/*）解析也依赖此声明。
const workspaceRoot = path.join(import.meta.dirname, "..", "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
