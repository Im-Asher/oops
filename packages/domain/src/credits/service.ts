import { db as defaultDb } from "@oops/db";
import {
  createCreditLedgerRepo,
  InsufficientCreditsError,
  type CreditLedgerRepo,
  type DbClient,
} from "@oops/db/credit-ledger.repo";
import { createTaskRepo, type TaskRepo } from "@oops/db/task.repo";
import { TaskError } from "../tasks/task-error";

/** 新用户初始积分（分）；0007 迁移的存量回填额须与此一致。 */
export const INITIAL_GRANT_CREDITS = 100;

/**
 * 任务类型 → 定价表 key。当前一一对应；未来按量/按尺寸定价时在此细分，
 * 结算状态机（冻结额 − 实际成本退差）无需改动。
 */
const PRICE_KEYS: Record<string, string> = {
  generate_image: "generate_image",
  render_html: "render_html",
};

export interface CreditGate {
  /**
   * 任务创建 + 按定价冻结（同一 DB 事务）：余额不足抛 TaskError(insufficient_credits)，
   * 任务行随事务回滚。成功返回已落库的任务 id。
   */
  freezeForTask(input: {
    userId: string;
    type: string;
    payload: unknown;
    sessionId?: string;
  }): Promise<{ taskId: string }>;
  /** 成功结算：实际成本缺省 = 冻结额（v0.1.0 一口价），差额退回，冻结条目转 settled。 */
  settle(taskId: string, actualCost?: number): Promise<void>;
  /** 失败 / 取消 / 重启清理：返还全部冻结，条目转 released。 */
  release(taskId: string): Promise<void>;
}

export interface CreditsService extends CreditGate {
  /** 生成闸门预检：余额 ≤ 0 返回 ok=false（/api/chat 402 整面板拒绝的唯一判据）。 */
  checkGate(userId: string): Promise<{ ok: boolean; balance: number }>;
  /** 注册初始积分（grant 流水）；后台调整（adjust）走 M2 运营路径。 */
  grantInitialCredits(userId: string): Promise<void>;
  /** 启动对账：释放「仍 frozen 但任务已终态/不存在」的泄漏冻结，返回处理条数。 */
  reconcileFrozen(): Promise<number>;
}

export interface CreditsServiceDeps {
  ledger?: CreditLedgerRepo;
  /** 事务执行器：缺省 defaultDb.transaction；单测注入直通以脱离真实库。 */
  runTx?: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
  /** 事务内仓储工厂：缺省真实 repo 绑定 tx；单测注入 mock 以断言调用序。 */
  makeTxRepos?: (tx: DbClient) => { tasks: TaskRepo; ledger: CreditLedgerRepo };
}

export function createCreditsService(deps: CreditsServiceDeps = {}): CreditsService {
  // 默认走全局连接池；deps 供单测注入内存替身
  const ledger = deps.ledger ?? createCreditLedgerRepo();
  const runTx = deps.runTx ?? ((fn) => defaultDb.transaction(fn));
  const makeTxRepos =
    deps.makeTxRepos ?? ((tx: DbClient) => ({ tasks: createTaskRepo(tx), ledger: createCreditLedgerRepo(tx) }));

  return {
    async freezeForTask(input) {
      const priceKey = PRICE_KEYS[input.type];
      if (!priceKey) {
        throw new TaskError(`任务类型未配置定价：${input.type}`, "pricing_missing");
      }
      const price = await ledger.getPrice(priceKey);
      if (price === null) {
        throw new TaskError(`任务定价缺失：${priceKey}`, "pricing_missing");
      }
      try {
        // 创建任务 + 冻结流水 + 余额扣减同事务：任一步失败整体回滚，
        // 消除「冻结成功但任务未建 / 免费任务」两类崩溃窗口
        const task = await runTx(async (tx) => {
          const { tasks, ledger: txLedger } = makeTxRepos(tx);
          const created = await tasks.create({
            type: input.type as "generate_image" | "render_html" | "export",
            payload: input.payload,
            sessionId: input.sessionId,
            userId: input.userId,
          });
          await txLedger.freeze({ userId: input.userId, taskId: created.id, price });
          return created;
        });
        return { taskId: task.id };
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          throw new TaskError("积分余额不足，无法发起该任务", "insufficient_credits");
        }
        throw err;
      }
    },

    // actualCost 缺省 = 冻结额（一口价），repo 内部定位冻结条目
    settle: (taskId, actualCost) => ledger.settle({ taskId, actualCost }),

    release: (taskId) => ledger.releaseByTask({ taskId }),

    checkGate: async (userId) => {
      const balance = await ledger.getBalance(userId);
      return { ok: balance > 0, balance };
    },

    grantInitialCredits: (userId) =>
      ledger.adjust({
        userId,
        amount: INITIAL_GRANT_CREDITS,
        type: "grant",
        note: "registration",
      }),

    reconcileFrozen: async () => {
      const leaks = await ledger.listLeakedFrozen();
      for (const leak of leaks) {
        await ledger.releaseEntry(leak.entryId);
      }
      return leaks.length;
    },
  };
}

/** 进程级单例：executor 缺省闸门与 web 路由共用同一实例。 */
export const creditsService: CreditsService = createCreditsService();

/** executor 缺省积分闸门。 */
export const defaultCreditGate: CreditGate = {
  freezeForTask: (input) => creditsService.freezeForTask(input),
  settle: (taskId, actualCost) => creditsService.settle(taskId, actualCost),
  release: (taskId) => creditsService.release(taskId),
};
