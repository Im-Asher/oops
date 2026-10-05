/* eslint-disable @typescript-eslint/no-explicit-any -- 测试 mock 需动态链式，刻意为之 */
/**
 * 极简 drizzle 查询构造器 mock，仅用于仓储单元测试（不连真实数据库）。
 * 节点无限链式；遇到 return/limit/then/execute 等终止符返回 Promise。
 * 测试通过 state.selectResult / pendingValues 注入期望数据，并读取 calls 校验入参。
 */
export interface MockDbState {
  selectResult: unknown[];
  pendingValues: unknown;
  pendingSet: unknown;
  /** 最近一次 .set() 入参（returning 后不清空，供断言用） */
  lastSet: unknown;
  calls: { op: string; args: unknown[] }[];
}

const TERMINALS = new Set(["returning", "limit", "execute"]);

export function makeMockDb(
  initial?: Partial<MockDbState>,
): { db: any; state: MockDbState } {
  const state: MockDbState = {
    selectResult: initial?.selectResult ?? [],
    pendingValues: initial?.pendingValues,
    pendingSet: initial?.pendingSet,
    lastSet: undefined,
    calls: [],
  };

  const resolve = (op: string, args: unknown[]): unknown => {
    state.calls.push({ op, args });
    if (op.endsWith(".returning")) {
      const v = state.pendingValues ?? state.pendingSet ?? {};
      state.pendingValues = undefined;
      state.pendingSet = undefined;
      return [v];
    }
    if (op === "delete.where") return [];
    if (op.endsWith(".where")) return state.selectResult;
    if (op.endsWith(".limit")) return state.selectResult;
    return [];
  };

  const build = (op: string): any => {
    const handler: ProxyHandler<() => unknown> = {
      get(_t, prop: string | symbol) {
        const nextOp = op ? `${op}.${String(prop)}` : String(prop);
        if (prop === "then") {
          // await 直达链尾：按去掉 .then 后缀的真实 op 结算（否则绕过 where/limit 分支）
          return (cb?: (v: unknown) => void) =>
            Promise.resolve(resolve(op, [])).then(cb);
        }
        if (TERMINALS.has(String(prop))) {
          return (...args: unknown[]) => Promise.resolve(resolve(nextOp, args));
        }
        return build(nextOp);
      },
      apply(_t, _this, args: unknown[]) {
        if (op.endsWith(".values") || op.endsWith(".set")) {
          state.pendingValues = op.endsWith(".values") ? args[0] : state.pendingValues;
          if (op.endsWith(".set")) {
            state.pendingSet = args[0];
            state.lastSet = args[0];
          }
        }
        return build(op);
      },
    };
    return new Proxy(function () {}, handler);
  };

  return { db: build(""), state };
}
