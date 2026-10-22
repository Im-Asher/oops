import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { loadAppEnv } from "@oops/config/load-env";

// pnpm workspace：lockfile 在仓库根而 app 在 apps/web，root 推断有歧义；
// 显式声明为仓库根，M0.2 抽包后跨包（packages/*）解析也依赖此声明。
const workspaceRoot = path.join(import.meta.dirname, "..", "..");

// 两层 env：补加载根共享层（app 层 Next 已 builtin 加载，保持优先）。
loadAppEnv(workspaceRoot, import.meta.dirname);

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  // workspace 内部包 TS 源码直出（无构建编排），由 Next 转译。
  transpilePackages: ["@oops/config", "@oops/db", "@oops/domain", "@oops/auth", "@oops/llm"],
  // resvg-js 内含平台相关的 .node native binding（经 js-binding.js 动态 require）。
  // Turbopack 会尝试打包它并报 "non-ecmascript placeable asset"，必须标记为
  // 外部依赖：运行时从 node_modules 解析，不进 chunk。
  serverExternalPackages: ["@resvg/resvg-js"],
  // 海报渲染无浏览器：字体产物运行时按 cwd 读盘（resolve(process.cwd(), "assets", "fonts")），
  // 不在 import 链上，打包器无法静态追踪——必须显式声明，否则函数包里缺字体，
  // 而缺字形是静默的（不出字也不报错），比构建失败更难排查。
  // glob 相对 app 根解析（实测 nft 中记为 ../../../../../assets/...，即从
  // .next/server/app/<route>/ 回退到 app 根）；resvg 的 native binding 由
  // serverExternalPackages 外部化后同样进 nft，无需在此声明。
  outputFileTracingIncludes: {
    "*": ["../../assets/fonts/*.ttf"],
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
