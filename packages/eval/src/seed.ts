#!/usr/bin/env tsx
/**
 * 评测专用账号播种（幂等）。
 *
 * 为什么不走注册路由：注册要消费邀请码（registerUser 在事务内 consumeByCode），
 * 评测不该被邀请码状态（用尽 / 过期 / 未配置）牵连。这里直接写 DB：
 * - 建号复用 user.repo.create + @oops/auth 的 hashPassword（与注册同一套哈希，
 *   登录走同一套 verifyPassword，不另起炉灶）；
 * - active / tokenVersion 取 schema 默认（0），满足 requireUser 的
 *   「存在 且 status === "active" 且 tokenVersion === 载荷 tv」三重校验；
 * - 初始积分复用 domain 的 creditsService.grantInitialCredits（grant 流水 +
 *   余额物化列同源写入），禁止裸 UPDATE users.credit_balance。
 *
 * 幂等：同名（不区分大小写，与 users_username_lower_idx 语义一致）用户已存在时
 * 只提示、不建号、不发积分——重复执行不会把余额刷成 N×初始额度。
 */
import type { UserRepo } from "@oops/db/user.repo";

const DEFAULT_USERNAME = "eval";
const DEFAULT_PASSWORD = "eval-password-123";

/**
 * 脚本类入口手动加载仓库根 env（与 drizzle.config.ts 同约定）：
 * @oops/db 在模块求值时就会读 DATABASE_URL 建连接池，加载必须在 import 之前生效，
 * 因此这里用动态 import 而不是顶层的静态 import。
 */
async function loadEnv(): Promise<void> {
  const { loadAppEnv } = await import("@oops/config/load-env");
  // 仓库根用模块自身位置推导（与 cwd 无关，根目录直跑也不会找错）
  loadAppEnv(new URL("../../..", import.meta.url).pathname);
}

/**
 * 业务模块一律动态 import：@oops/db 在模块求值时就 getDbConfig() 建池，
 * 静态 import 会跑到 loadEnv() 之前，导致 DATABASE_URL 尚未注入即抛 ZodError。
 */
async function loadDeps() {
  const [
    { createUserRepo },
    { generateUniqueOopsId },
    { hashPassword },
    { createCreditsService, INITIAL_GRANT_CREDITS },
  ] = await Promise.all([
    import("@oops/db/user.repo"),
    import("@oops/auth/oops-id"),
    import("@oops/auth/password"),
    import("@oops/domain/credits/service"),
  ]);
  return { createUserRepo, generateUniqueOopsId, hashPassword, createCreditsService, INITIAL_GRANT_CREDITS };
}

/** 把「连不上库」翻译成人话，避免甩一整段 pg 堆栈。 */
function describeDbError(err: unknown): string {
  // drizzle 会把驱动错误包进 DrizzleQueryError 并把原始错误挂在 cause 上：
  // 真实 pg 错误码（ECONNREFUSED / 42P01 …）必须沿 cause 链找，否则只能看到 SQL 文本。
  type ErrLike = { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown[] };
  const chain: ErrLike[] = [];
  const visit = (e: unknown): void => {
    if (!e || typeof e !== "object" || chain.includes(e as ErrLike)) return;
    chain.push(e as ErrLike);
    visit((e as ErrLike).cause);
    for (const inner of (e as ErrLike).errors ?? []) visit(inner);
  };
  visit(err);

  // 同时覆盖两类：pg 的 SQLSTATE（5 位，如 42P01）与 Node/libuv 的 errno 名（ECONNREFUSED）
  const code = chain
    .map((e) => e.code)
    .find(
      (c): c is string =>
        typeof c === "string" && (/^[0-9A-Z]{5}$/.test(c) || /^E[A-Z]+$/.test(c)),
    );
  switch (code) {
    case "ECONNREFUSED":
      return "数据库连接被拒绝：DATABASE_URL 指向的 Postgres 未启动或端口不对（检查 .env.local / docker compose）。";
    case "ENOTFOUND":
      return "数据库主机名解析失败：DATABASE_URL 里的主机名不存在。";
    case "42P01":
      return "表不存在：先跑 pnpm db:migrate 建表。";
    case "28P01":
    case "28000":
      return "数据库认证失败：DATABASE_URL 里的用户名/密码不对。";
    case "3D000":
      return "数据库不存在：DATABASE_URL 指向的库还没建。";
    case "ECONNRESET":
      return "数据库连接被重置：连接串指向的服务不稳定或被中间设备断开。";
    default: {
      // 取链条上最深一条 message（最内层最接近真相）
      const message = [...chain].reverse().find((e) => typeof e.message === "string")?.message;
      return String(message ?? err);
    }
  }
}

async function main(): Promise<number> {
  const username = process.env.EVAL_USERNAME ?? DEFAULT_USERNAME;
  const password = process.env.EVAL_PASSWORD ?? DEFAULT_PASSWORD;

  if (!process.env.DATABASE_URL) {
    console.error("✘ 缺 DATABASE_URL（仓库根 .env.local 或环境变量）。先跑 pnpm eval:doctor 看全貌。");
    return 1;
  }

  const { createUserRepo, generateUniqueOopsId, hashPassword, createCreditsService, INITIAL_GRANT_CREDITS } =
    await loadDeps();

  const userRepo: UserRepo = createUserRepo();
  const existing = await userRepo.findByUsername(username);
  if (existing) {
    console.log(`✔ 评测账号已存在：${existing.username}（oops_${existing.oopsId}，status=${existing.status}）`);
    console.log("  跳过建号与初始积分发放（幂等，不重复发）。");
    if (existing.status !== "active") {
      console.log(
        `  ⚠ 该账号当前为 ${existing.status}，登录会被 requireUser 拒绝；如确认要复用，请在管理端启用或删除后重跑本脚本。`,
      );
    }
    return 0;
  }

  // 与注册同城生成 oopsId：8 位去易混字符，查重重试上限 5 次
  const oopsId = await generateUniqueOopsId(
    async (id) => !(await userRepo.findByOopsId(id)),
  );
  const passwordHash = await hashPassword(password);

  const user = await userRepo.create({
    username,
    oopsId,
    passwordHash,
    displayName: "评测机器人",
  });

  await createCreditsService().grantInitialCredits(user.id);

  console.log(`✔ 已创建评测账号：${user.username}（oops_${user.oopsId}，id=${user.id}）`);
  console.log(`  初始积分 +${INITIAL_GRANT_CREDITS}（grant 流水），status=${user.status}，tokenVersion=${user.tokenVersion}`);
  console.log(`  登录密码：${password === DEFAULT_PASSWORD ? DEFAULT_PASSWORD : "（由 EVAL_PASSWORD 指定）"}`);
  return 0;
}

try {
  await loadEnv();
  process.exitCode = await main();
} catch (err) {
  console.error(`✘ seed 失败：${describeDbError(err)}`);
  process.exitCode = 1;
}
