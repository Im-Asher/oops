import path from "node:path";
import { config } from "dotenv";

/**
 * 两层 env 加载（design D3）：仓库根共享层 + app 目录专属层。
 *
 * 语义：app 层最优先。
 * - Next 在求值 next.config 前已自行加载 app 目录 .env*（builtin dotenv，
 *   不覆盖已有值）——随后在此补加载：根层 override:false 让位给已注入的
 *   app 层值；app 层 override:true 在「无 Next builtin 加载」的场景
 *   （drizzle-kit / vitest）下保证 app 值胜出。
 * - 文件缺失静默跳过（dotenv config() 对不存在路径不抛错）。
 * - 供 next.config.ts、drizzle.config.ts 等构建/脚本入口调用；
 *   运行时代码仍只经 index.ts 的域 getter 读取，禁止直接摸 process.env。
 */
export function loadAppEnv(workspaceRoot: string, appDir?: string): void {
  // 1) 根共享层（.env.local 优先于 .env，dotenv 后加载不覆盖已有）
  config({ path: path.join(workspaceRoot, ".env.local") });
  config({ path: path.join(workspaceRoot, ".env") });

  if (!appDir || appDir === workspaceRoot) return;

  // 2) app 专属层：显式覆盖（app 最优先）。层内先 .env 后 .env.local，
  //    与 Next 优先级一致（.env.local 胜出，override:true 后加载者赢）。
  config({ path: path.join(appDir, ".env"), override: true });
  config({ path: path.join(appDir, ".env.local"), override: true });
}
