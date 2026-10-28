import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { EvalCase } from "./case";
import type { EvalClient } from "./http";
import { collectFromEvents, type RunArtifacts } from "./run";
import { parseSseStream, type SseEvent } from "./sse";
import { judgeL1 } from "./judges/l1";
import { judgeL2, measureHtml } from "./judges/l2";
import { judgeL3 } from "./judges/l3";
import { judgeL4 } from "./judges/l4";
import type { VisionAsk } from "./vlm";
import type { CaseResult } from "./report";
import type { Failure, FailureCode } from "./taxonomy";

const KNOWN_CODES: ReadonlySet<string> = new Set<FailureCode>([
  "render_error",
  "css_unsupported",
  "overflow",
  "missing_glyph",
  "text_missing",
  "image_missing",
  "no_tool_call",
  "timeout",
  "content_rejected",
  "size_mismatch",
  "judge_low",
  "insufficient_credits",
]);

/** 服务端错误码是开放字符串，这里收敛到封闭分类，未知一律归 render_error。 */
export function toFailureCode(raw: string): FailureCode {
  return KNOWN_CODES.has(raw) ? (raw as FailureCode) : "render_error";
}

export interface ExecCtx {
  client: EvalClient;
  vlm: VisionAsk;
  fixturesDir: string;
  l4Threshold: number;
  /** 存在时把模型产出的 HTML 落盘，供事后诊断（report.json 不存大字段）。 */
  artifactDir?: string;
}

/** 跑单个 case 的完整流水线：上传参考图 → chat 读 SSE → L1/L2/L3/L4。 */
export async function executeCase(c: EvalCase, ctx: ExecCtx): Promise<CaseResult> {
  const started = Date.now();
  const sessionId = await ctx.client.createSession(c.agent, `eval-${c.id}`);

  // 参考图：上传进该会话，同时保留本地字节供测量浏览器回填
  const referenceAssetIds: string[] = [];
  const fileBytes = new Map<string, Uint8Array>();
  for (const rel of c.references) {
    const bytes = readFileSync(join(ctx.fixturesDir, rel));
    const blob = new Blob([bytes], { type: mimeOf(rel) });
    const { assetId, url } = await ctx.client.uploadReference(sessionId, blob, basename(rel));
    referenceAssetIds.push(assetId);
    fileBytes.set(new URL(url, "http://x").pathname, new Uint8Array(bytes));
  }

  const res = await ctx.client.chat({
    sessionId,
    agentId: c.agent,
    message: c.message,
    ...(referenceAssetIds.length > 0 ? { referenceAssetIds } : {}),
  });

  // 建连前就失败的请求（402 余额不足 / 500 / 400）不会产生任何事件流。
  // 不在这里拦下，就会退化成「没有调用工具 + 没有产物」这种误导性结论。
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200) || `HTTP ${res.status}`;
    return {
      id: c.id,
      agent: c.agent,
      durationMs: Date.now() - started,
      imageUrl: null,
      failures: [
        {
          code: res.status === 402 ? "insufficient_credits" : "render_error",
          detail: `chat 返回 ${res.status}：${detail}`,
        },
      ],
      l4: null,
      toolCalls: [],
      rawText: "",
    };
  }

  const events: SseEvent[] = [];
  if (res.body) {
    for await (const e of parseSseStream(res.body)) events.push(e);
  }
  const artifacts = collectFromEvents(events);

  const notes: string[] = [];
  const failures: Failure[] = collectFailures(artifacts, c);
  if (!artifacts.html && failures.length === 0 && c.assert.mustContainText.length > 0) {
    failures.push({ code: "no_tool_call", detail: "本轮没有调用 render_html" });
  }
  if (artifacts.fatal) failures.push({ code: "render_error", detail: artifacts.fatal });

  let imageBytes: Uint8Array | null = null;
  if (artifacts.assetUrl) {
    try {
      imageBytes = await ctx.client.getFile(artifacts.assetUrl);
    } catch {
      failures.push({ code: "image_missing", detail: "产物图片下载失败" });
    }
  }

  failures.push(
    ...judgeL1({
      expect: {
        size: c.assert.size,
        denyCss: c.assert.denyCss,
        allowedHeights: c.assert.allowedHeights,
        allowedSizes: c.assert.allowedSizes,
      },
      artifacts,
      bytes: imageBytes,
    }).failures,
  );

  if (artifacts.html) {
    // 修正 B：把 HTML 引用的 /files/* 全部取回，避免测量浏览器 abort 造成假 image_missing
    for (const path of extractFilePaths(artifacts.html)) {
      if (fileBytes.has(path)) continue;
      try {
        fileBytes.set(path, await ctx.client.getFile(path));
      } catch {
        // 取不到就不放进 map：测量时该 <img> 会自然失败，属真实缺陷
      }
    }
    const metrics = await measureHtml(artifacts.html, c.assert.size, { fileBytes });
    if (ctx.artifactDir) {
      // 落盘供事后诊断：溢出到底卡在哪个块、模型到底写了什么，只有原文能回答
      mkdirSync(ctx.artifactDir, { recursive: true });
      writeFileSync(join(ctx.artifactDir, `${c.id}.html`), artifacts.html);
      writeFileSync(
        join(ctx.artifactDir, `${c.id}.geometry.json`),
        JSON.stringify(metrics, null, 2),
      );
    }
    const l2Failures = judgeL2({ metrics, maxOverflowPx: c.assert.maxOverflowPx }).failures;
    failures.push(...l2Failures);

    // 溢出会裁掉文字：此时「图里读不到某段文案」是版式问题的后果，不是字形问题。
    // 先修版式再谈缺字，否则同一处缺陷会被记成两类失败，读报告的人会去查字体。
    const overflowed = l2Failures.some((f) => f.code === "overflow");
    if (overflowed) {
      notes.push("版式溢出会裁掉文字，本轮跳过 L3 字形判定");
    } else if (imageBytes) {
      failures.push(
        ...(
          await judgeL3({
            domText: metrics.text,
            mustContain: c.assert.mustContainText,
            image: imageBytes,
            vlm: ctx.vlm,
          })
        ).failures,
      );
    }
  }

  const l4 = imageBytes
    ? await judgeL4({
        image: imageBytes,
        mustContain: c.assert.mustContainText,
        vlm: ctx.vlm,
        threshold: ctx.l4Threshold,
      })
    : null;

  return {
    id: c.id,
    agent: c.agent,
    durationMs: Date.now() - started,
    imageUrl: artifacts.assetUrl,
    failures: dedupe(failures),
    l4: l4 ? { score: l4.score, reason: l4.reason } : null,
    toolCalls: artifacts.toolCalls.map((t) => t.name),
    rawText: artifacts.text,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/**
 * 工具错误只有在「本轮什么都没产出」时才算失败。
 * 模型先失败一次、再重试成功是常见路径，把中途的 tool_end 错误一律记成失败会污染基线（假阳性）。
 */
export function collectFailures(
  artifacts: Pick<RunArtifacts, "assetUrl" | "html" | "toolErrors">,
  _c: EvalCase,
): Failure[] {
  const produced = Boolean(artifacts.assetUrl || artifacts.html);
  if (produced) return [];
  return artifacts.toolErrors.map((e) => ({ code: toFailureCode(e.code), detail: e.message }));
}

/** 从 HTML 里抠出站内文件路径（/files/...）。 */
export function extractFilePaths(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/\/files\/[A-Za-z0-9._\-/]+/g)) out.add(m[0]);
  return [...out];
}

function dedupe(list: Failure[]): Failure[] {
  const seen = new Set<string>();
  return list.filter((f) => {
    const k = `${f.code}:${f.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function mimeOf(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
