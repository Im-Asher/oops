import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import {
  COMPACT_TARGET_TOKENS,
  COMPACT_TRIGGER_TOKENS,
  compactSessionHistory,
  estimateTokens,
  selectCompactionRange,
  SUMMARY_PROMPT,
  type CompactDeps,
} from "./compact";

const userMsg = (text: string): Message => ({ role: "user", content: text, timestamp: 1 });

function row(id: string, text: string) {
  return { id, transcript: { v: 1, messages: [userMsg(text)] } };
}

/** 生成约 N token 的文本（按估算公式 1.5 字/token）；char 用于区分不同行的包含断言 */
const textOfTokens = (tokens: number, char = "字") => char.repeat(Math.ceil(tokens * 1.5));

describe("estimateTokens", () => {
  it("字符数 / 1.5 向上取整", () => {
    expect(estimateTokens("字".repeat(3))).toBe(2);
    expect(estimateTokens("字".repeat(30))).toBe(20);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("selectCompactionRange", () => {
  it("预算内全保留：无压缩行，水位线为 null", () => {
    const rows = [row("m1", "短"), row("m2", "短")];
    const out = selectCompactionRange(rows, undefined, 10_000);
    expect(out.compactedRows).toHaveLength(0);
    expect(out.watermark).toBeNull();
  });

  it("超预算：最新行保留，较老行进压缩范围，水位线 = 压缩范围最新行", () => {
    const rows = [
      row("m1", textOfTokens(400)),
      row("m2", textOfTokens(450)),
      row("m3", textOfTokens(100)), // 最新
    ];
    // 预算 500：m3(100) 收下，m2(450) 加入超 500 → 从 m2 起全部压缩
    const out = selectCompactionRange(rows, undefined, 500);
    expect(out.compactedRows.map((r) => r.id)).toEqual(["m1", "m2"]); // 升序（供摘要输入）
    expect(out.watermark).toBe("m2");
  });

  it("单行超预算仍收下（宁超不缺），其余全压缩", () => {
    const rows = [row("m1", textOfTokens(20_000)), row("m2", "短")];
    const out = selectCompactionRange(rows, undefined, COMPACT_TARGET_TOKENS);
    expect(out.compactedRows.map((r) => r.id)).toEqual(["m1"]);
    expect(out.watermark).toBe("m1");
  });

  it("坏行与本轮行跳过，不占预算、不进压缩范围", () => {
    const rows = [
      row("m1", textOfTokens(800)),
      { id: "mbad" }, // 无 transcript
      { id: "mfuture", transcript: { v: 99, messages: [] } }, // 未知版本
      { id: "mu1", transcript: { v: 1, messages: [userMsg("本轮")] } },
      row("m2", textOfTokens(800)),
    ];
    // 预算 500：m2(800) 作为最新行无条件收下，m1 超预算被压缩
    const out = selectCompactionRange(rows, "mu1", 500);
    expect(out.compactedRows.map((r) => r.id)).toEqual(["m1"]);
    expect(out.watermark).toBe("m1");
  });
});

describe("compactSessionHistory", () => {
  let deps: CompactDeps & { updateSummaryMock: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const updateSummaryMock = vi.fn(async () => ({}));
    deps = {
      summarize: vi.fn(async (_p: string, _i: string) => "摘要产物"),
      updateSummary: updateSummaryMock,
      updateSummaryMock,
    };
  });

  it("低于触发阈值：不调用摘要，返回现有摘要/水位线", async () => {
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows: [row("m1", "短对话")],
      currentSummary: "旧摘要",
      currentWatermark: null,
      deps,
    });
    expect(out).toEqual({ compacted: false, summary: "旧摘要", watermark: null });
    expect(deps.summarize).not.toHaveBeenCalled();
    expect(deps.updateSummaryMock).not.toHaveBeenCalled();
  });

  it("超过阈值：摘要输入含旧摘要与压缩行原文，落库并返回新水位线", async () => {
    const rows = [
      row("m1", textOfTokens(25_000)),
      row("m2", textOfTokens(8_000)),
      row("m3", "近期小轮"),
    ];
    // 回放总量 ~33003 token > 30000 触发；target 10000：m3+m2 收下(~8003)，m1 被压缩
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows,
      currentSummary: "旧摘要",
      currentWatermark: null,
      deps,
    });
    expect(out.compacted).toBe(true);
    expect(out.summary).toBe("摘要产物");
    expect(out.watermark).toBe("m1");
    expect(deps.updateSummaryMock).toHaveBeenCalledWith("s1", {
      summary: "摘要产物",
      summarizedUpTo: "m1",
    });
    const [prompt, summaryInput] = (deps.summarize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(prompt).toBe(SUMMARY_PROMPT);
    expect(summaryInput).toContain("<旧摘要>");
    // 压缩行原文进入输入（m1 的长文本），保留行（m2/m3）不进入
    expect(summaryInput).toContain(textOfTokens(25_000).slice(0, 50));
    expect(summaryInput).not.toContain("近期小轮");
  });

  it("水位线单调推进：有效旧摘要存在时，新水位线不比现水位线严格靠后则拒绝", async () => {
    const rows = [
      row("m1", textOfTokens(25_000)),
      row("m2", textOfTokens(8_000)),
    ];
    // 现水位线已到 m1，本轮压缩范围只有 m1 → 非严格靠后 → 拒绝
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows,
      currentSummary: "旧摘要",
      currentWatermark: "m1",
      deps,
    });
    expect(out.compacted).toBe(false);
    expect(deps.summarize).not.toHaveBeenCalled();
    expect(deps.updateSummaryMock).not.toHaveBeenCalled();
  });

  it("幂等重算：摘要清空但水位线仍在时，允许同水位线重建并落库", async () => {
    const rows = [
      row("m1", textOfTokens(25_000)),
      row("m2", textOfTokens(8_000)),
    ];
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows,
      currentSummary: null, // 摘要被清空
      currentWatermark: "m1", // 水位线不变
      deps,
    });
    expect(out.compacted).toBe(true);
    expect(out.summary).toBe("摘要产物");
    expect(deps.updateSummaryMock).toHaveBeenCalledWith("s1", {
      summary: "摘要产物",
      summarizedUpTo: "m1",
    });
  });

  it("空摘要拒绝落库（防水位线推进后上下文丢失）", async () => {
    deps.summarize = vi.fn(async () => "   "); // LLM 返回空白
    // 需存在可压缩范围（最新行永远保留）：m1 进范围、m2 保留
    const rows = [row("m1", textOfTokens(31_000)), row("m2", "近期短行")];
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows,
      currentSummary: null,
      currentWatermark: null,
      deps,
    });
    expect(out.compacted).toBe(false);
    expect(deps.summarize).toHaveBeenCalled();
    expect(deps.updateSummaryMock).not.toHaveBeenCalled();
  });

  it("summarize 抛错向上传播且不落库（降级由 runtime 负责）", async () => {
    deps.summarize = vi.fn(async () => {
      throw new Error("LLM down");
    });
    const rows = [row("m1", textOfTokens(31_000)), row("m2", "近期短行")];
    await expect(
      compactSessionHistory({
        sessionId: "s1",
        rows,
        currentSummary: null,
        currentWatermark: null,
        deps,
      }),
    ).rejects.toThrow("LLM down");
    expect(deps.updateSummaryMock).not.toHaveBeenCalled();
  });

  it("已压缩会话不重复触发：估算基于摘要+水位线后原文，而非全量历史", async () => {
    // 全量历史 ~31001 token（>30k），但有效上下文 = 摘要 + 水位线后 2k → 不触发
    const rows = [row("m1", textOfTokens(29_000)), row("m2", textOfTokens(2_000))];
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows,
      currentSummary: "旧摘要内容",
      currentWatermark: "m1",
      deps,
    });
    expect(out.compacted).toBe(false);
    expect(deps.summarize).not.toHaveBeenCalled();
    expect(deps.updateSummaryMock).not.toHaveBeenCalled();
  });

  it("水位线后原文再次增长超阈值：范围仅水位线后，旧摘要并入输入", async () => {
    const rows = [
      row("m1", textOfTokens(29_000, "甲")), // 水位线前，已由旧摘要承载
      row("m2", textOfTokens(29_000, "乙")),
      row("m3", textOfTokens(2_000, "丙")),
    ];
    // 有效上下文 = 摘要 + m2/m3 ~31004 token > 30k；target 10k：m3 保留，m2 进范围
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows,
      currentSummary: "旧摘要内容",
      currentWatermark: "m1",
      deps,
    });
    expect(out.compacted).toBe(true);
    expect(out.watermark).toBe("m2"); // 单调推进
    const [prompt, summaryInput] = (deps.summarize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(prompt).toBe(SUMMARY_PROMPT);
    expect(summaryInput).toContain("<旧摘要>");
    expect(summaryInput).toContain(textOfTokens(29_000, "乙").slice(0, 50));
    // 水位线前原文与预算内保留行都不进摘要输入
    expect(summaryInput).not.toContain("甲");
    expect(summaryInput).not.toContain("丙");
  });

  it("本轮超长消息计入触发估算（防漏触发），且本轮行不进压缩范围", async () => {
    // 历史 ~26k 低于触发线；本轮 user 23k 将被 prompt() 注入 LLM → 合计 ~49k 必须触发
    const rows = [
      row("m1", textOfTokens(16_000, "甲")),
      row("m2", textOfTokens(10_000, "乙")),
      row("mu1", textOfTokens(23_000, "丙")),
    ];
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows,
      currentSummary: null,
      currentWatermark: null,
      excludeMessageId: "mu1",
      deps,
    });
    expect(out.compacted).toBe(true);
    expect(out.watermark).toBe("m1"); // 预算收下 m2（原文保留），m1 进压缩范围
    const [, summaryInput] = (deps.summarize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(summaryInput).toContain("甲");
    expect(summaryInput).not.toContain("乙"); // 预算内保留行不进摘要
    expect(summaryInput).not.toContain("丙"); // 本轮行永不进摘要
  });

  it("水位线行已删除时按无水位线处理，放行重算", async () => {
    const rows = [row("m1", textOfTokens(31_000)), row("m2", textOfTokens(8_000))];
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows,
      currentSummary: null,
      currentWatermark: "mGone",
      deps,
    });
    expect(out.compacted).toBe(true);
    expect(out.watermark).toBe("m1");
  });

  it("本轮 user 行不被压缩范围越过（excludeMessageId 永远保留原样）", async () => {
    const rows = [
      row("m1", textOfTokens(25_000)),
      row("m2", textOfTokens(8_000)),
      { id: "mu1", transcript: { v: 1, messages: [userMsg("本轮输入")] } },
    ];
    const out = await compactSessionHistory({
      sessionId: "s1",
      rows,
      currentSummary: null,
      currentWatermark: null,
      excludeMessageId: "mu1",
      deps,
    });
    expect(out.compacted).toBe(true);
    expect(out.watermark).toBe("m1");
    const [, summaryInput] = (deps.summarize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    // 本轮行不进摘要输入
    expect(summaryInput).not.toContain("本轮输入");
  });

  it("阈值常量符合 spec：触发 30k / 目标 10k", () => {
    expect(COMPACT_TRIGGER_TOKENS).toBe(30_000);
    expect(COMPACT_TARGET_TOKENS).toBe(10_000);
  });
});
