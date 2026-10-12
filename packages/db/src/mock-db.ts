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
  /** 最近一次 .values() 入参（returning 后不清空，供断言用） */
  lastValues: unknown;
  calls: { op: string; args: unknown[] }[];
}

const TERMINALS = new Set(["returning", "limit", "execute", "offset"]);

export function makeMockDb(
  initial?: Partial<MockDbState>,
): { db: any; state: MockDbState } {
  const state: MockDbState = {
    selectResult: initial?.selectResult ?? [],
    pendingValues: initial?.pendingValues,
    pendingSet: initial?.pendingSet,
    lastSet: undefined,
    lastValues: undefined,
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
    if (op === "select.from") return state.selectResult; // 裸 count 类查询（无 where）
    if (op.endsWith(".offset")) return state.selectResult;
    if (op.endsWith(".where")) return state.selectResult;
    if (op.endsWith(".limit")) return state.selectResult;
    return [];
  };

  /** terminal 结算值：既是 Promise（可 await），也允许在其上继续链式（.limit().offset() 双 builder 链）。 */
  const makeResolving = (op: string, args: unknown[]): any => {
    const promise = Promise.resolve(resolve(op, args));
    return new Proxy(promise, {
      get(target, prop: string | symbol) {
        if (prop === "then") {
          return (target as Promise<unknown>).then.bind(target);
        }
        const nextOp = `${op}.${String(prop)}`;
        if (TERMINALS.has(String(prop))) {
          return (...a: unknown[]) => makeResolving(nextOp, a);
        }
        return build(nextOp);
      },
    });
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
          return (...args: unknown[]) => makeResolving(nextOp, args);
        }
        return build(nextOp);
      },
      apply(_t, _this, args: unknown[]) {
        if (op.endsWith(".values") || op.endsWith(".set")) {
          state.pendingValues = op.endsWith(".values") ? args[0] : state.pendingValues;
          if (op.endsWith(".values")) {
            state.lastValues = args[0];
          }
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
