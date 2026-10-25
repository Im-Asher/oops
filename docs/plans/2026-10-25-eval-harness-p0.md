# P0 评测闭环 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 monolith 上建立可重复执行、可比较、可作回归门的图片生成评测闭环。

**Architecture:** 评测器是**黑盒 HTTP 驱动**（登录 → 建会话 → 上传参考图 → POST /api/chat 读 SSE → 下载产物），不 import 任何 `apps/web/src/server` 代码。因此它不受 P1 搬家影响，P2 换渲染器时也不用改——**它只依赖公开 HTTP 契约**。判定分四层：L1 结构（PNG 头 + CSS 黑名单，纯计算）、L2 几何（eval 侧用 Chromium 量 DOM，与被测渲染器无关）、L3 文字（DOM 文本 vs VLM 读图）、L4 审美（VLM rubric，只看趋势不进闸门）。

**Tech Stack:** TypeScript, vitest, zod, yaml, playwright (chromium), Node 22 内置 fetch/zlib。

**与设计文档的偏差（有意为之）：** `docs/plans/2026-10-25-creation-service-design.md` §6 把评测放在 `apps/creation/eval/`。本计划改放 `packages/eval/`，理由是评测是黑盒 HTTP 驱动、与进程边界无关，放包里 P1 搬家时**零改动**，放 app 里反而要跟着搬一次。

**实现期修正（落地时与本文的差异，以代码为准）：**

- **路径未变**：评测器落在 `packages/eval`，与上文偏差说明一致。
- **`uploadReference` 返回 `{ assetId, url }`**：原计划只返回 `assetId`。多返回 `url` 是因为 L2 需要参考图的 `/files/...` 地址，才能把字节喂给测量浏览器（否则测量浏览器会 abort 该请求）。
- **`execute.ts` 先预取全部 `/files/` 字节再测量**：原计划只回填最终产物。实际实现先从 HTML 里扫出所有 `/files/` 路径并逐个取回字节，再交给测量浏览器；否则测量浏览器会 abort 这些请求，`<img>` 自然尺寸为 0，产出**假的** `image_missing`。
- **`CaseResult.failures` 类型为 `Failure[]`**（`code: FailureCode`），不是 `{ code: string }`：目的是让 `compareToBaseline` 通过 typecheck。服务端错误码经 `toFailureCode()` 收敛到 `FailureCode` 枚举，未知一律归 `render_error`。

---

## 前置事实（实现者必读）

已核对的现行契约，不要靠猜：

| 用途 | 契约 |
| --- | --- |
| 登录 | `POST /api/auth/login` `{username,password}` → 200，`set-cookie` 带会话 |
| 建会话 | `POST /api/sessions` `{agentId,title?}` → `{id,agentId,title,updatedAt}` |
| 传参考图 | `POST /upload` multipart `{file, purpose:"reference", sessionId}` → `{url, assetId}` |
| 对话 | `POST /api/chat` `{sessionId,agentId,message,referenceAssetIds?}` → `text/event-stream` |
| 事件 | `event: <type>` + `data: <json>`，空行分隔。类型见 `apps/web/src/server/agent/types.ts:4-13`（**是 `message_delta`，不是 text-delta**） |
| 取图 | `GET /files/<key>`，**需要会话 cookie** |
| render 产物 | `tool_end` 的 `details` 含 `{assetId,url,width,height,taskId}`；失败时含 `{error,message}` |

`packages/eval` 的测试**一律不触网**：所有外部依赖通过参数注入（`fetchImpl` / `vlm` / `launch`），测试传假实现。

---

## Task 1: 包脚手架与根命令

**Files:**
- Create: `packages/eval/package.json`
- Create: `packages/eval/tsconfig.json`
- Create: `packages/eval/src/index.ts`
- Create: `packages/eval/.gitignore`
- Modify: `package.json:5-14`

**Step 1: 建包**

`packages/eval/package.json`：

```json
{
  "name": "@oops/eval",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "oops-eval": "./src/cli.ts" },
  "scripts": {
    "eval": "tsx src/cli.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint src"
  },
  "dependencies": {
    "yaml": "^2.6.1",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^20",
    "playwright": "^1.56.0",
    "tsx": "^4.20.6",
    "typescript": "^5",
    "vitest": "^5.0.2"
  }
}
```

`packages/eval/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/eval/src/index.ts`：`export {}`

`packages/eval/.gitignore`：

```
runs/
```

**Step 2: 根命令**

`package.json` 的 `scripts` 增加一行（放在 `test` 之后）：

```json
"eval": "pnpm --filter @oops/eval eval"
```

**Step 3: 安装依赖**

Run: `pnpm install`
Expected: 锁文件更新，`packages/eval/node_modules` 生成。

**Step 4: 安装 Chromium**

Run: `pnpm --filter @oops/eval exec playwright install chromium`
Expected: 下载完成，无报错。

**Step 5: 验证**

Run: `pnpm --filter @oops/eval typecheck`
Expected: 无输出、退出码 0。

**Step 6: Commit**

```bash
git add packages/eval package.json pnpm-lock.yaml
git commit -m "chore(eval): scaffold @oops/eval package"
```

---

## Task 2: case schema 与加载器

**Files:**
- Create: `packages/eval/src/case.ts`
- Test: `packages/eval/src/case.test.ts`

**Step 1: 写失败测试**

`packages/eval/src/case.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCases, parseCase } from "./case";

const valid = `
id: 001-poster-minimal
agent: poster-designer
message: "做一张极简海报"
references: [fixtures/product.png]
assert:
  size: [750, 1334]
  mustContainText: ["恒温 12 小时"]
  maxOverflowPx: 0
  denyCss: [grid]
`;

describe("parseCase", () => {
  it("解析合法 yaml 并填默认值", () => {
    const c = parseCase(valid);
    expect(c.id).toBe("001-poster-minimal");
    expect(c.assert.size).toEqual([750, 1334]);
    expect(c.assert.maxOverflowPx).toBe(0);
  });

  it("缺 id 时抛错", () => {
    expect(() => parseCase("message: hi\nassert:\n  size: [750, 1334]\n")).toThrow();
  });
});

describe("loadCases", () => {
  it("只加载 .yaml 且按 id 排序", () => {
    const dir = mkdtempSync(join(tmpdir(), "cases-"));
    writeFileSync(join(dir, "b.yaml"), valid.replace("001-poster-minimal", "002-b"));
    writeFileSync(join(dir, "a.yaml"), valid.replace("001-poster-minimal", "001-a"));
    writeFileSync(join(dir, "notes.txt"), "ignore me");
    const cases = loadCases(dir);
    expect(cases.map((c) => c.id)).toEqual(["001-a", "002-b"]);
  });
});
```

**Step 2: 跑测试确认失败**

Run: `pnpm --filter @oops/eval test`
Expected: FAIL — `Cannot find module './case'`.

**Step 3: 实现**

`packages/eval/src/case.ts`：

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const caseSchema = z.object({
  id: z.string().min(1),
  agent: z.string().min(1).default("poster-designer"),
  message: z.string().min(1),
  /** 相对 packages/eval 的 fixtures 路径。 */
  references: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string()).default([]),
  assert: z.object({
    size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    mustContainText: z.array(z.string()).default([]),
    maxOverflowPx: z.number().int().min(0).default(0),
    denyCss: z.array(z.string()).default([]),
  }),
});

export type EvalCase = z.infer<typeof caseSchema>;

export function parseCase(source: string): EvalCase {
  return caseSchema.parse(parseYaml(source));
}

export function loadCases(dir: string): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => parseCase(readFileSync(join(dir, f), "utf8")))
    .sort((a, b) => a.id.localeCompare(b.id));
}
```

**Step 4: 跑测试确认通过**

Run: `pnpm --filter @oops/eval test`
Expected: PASS（4 个断言）。

**Step 5: Commit**

```bash
git add packages/eval/src/case.ts packages/eval/src/case.test.ts
git commit -m "feat(eval): add case schema and loader"
```

---

## Task 3: HTTP 客户端（登录 / 建会话 / 传图 / 取图）

**Files:**
- Create: `packages/eval/src/http.ts`
- Test: `packages/eval/src/http.test.ts`

**Step 1: 写失败测试**

`packages/eval/src/http.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createClient } from "./http";

function fakeFetch(calls: { url: string; init?: RequestInit }[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/login")) {
      return new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "set-cookie": "oops_session=abc; Path=/; HttpOnly" },
      });
    }
    if (String(url).endsWith("/api/sessions")) {
      return new Response(JSON.stringify({ id: "s1" }), { status: 200 });
    }
    if (String(url).endsWith("/upload")) {
      return new Response(JSON.stringify({ url: "/files/x.png", assetId: "a1" }), { status: 201 });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("createClient", () => {
  it("登录后把 cookie 带到后续请求", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const c = createClient({ baseUrl: "http://x", fetchImpl: fakeFetch(calls) });
    await c.login("u", "p");
    await c.createSession("poster-designer");
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.cookie).toContain("oops_session=abc");
  });

  it("登录失败抛 LoginFailed", async () => {
    const c = createClient({
      baseUrl: "http://x",
      fetchImpl: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(c.login("u", "p")).rejects.toThrow(/登录失败/);
  });
});
```

**Step 2: 跑测试确认失败**

Run: `pnpm --filter @oops/eval test http`
Expected: FAIL — `Cannot find module './http'`.

**Step 3: 实现**

`packages/eval/src/http.ts`：

```ts
export interface ClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface EvalClient {
  login(username: string, password: string): Promise<void>;
  createSession(agentId: string, title?: string): Promise<string>;
  uploadReference(sessionId: string, file: Blob, name: string): Promise<string>;
  getFile(url: string): Promise<Uint8Array>;
  chat(body: {
    sessionId: string;
    agentId: string;
    message: string;
    referenceAssetIds?: string[];
  }): Promise<Response>;
}

/** 黑盒 HTTP 客户端：只依赖 apps/web 的公开路由，不 import 任何服务端代码。 */
export function createClient(opts: ClientOptions): EvalClient {
  const base = opts.baseUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  let cookie = "";

  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...(cookie ? { cookie } : {}),
    ...extra,
  });

  return {
    async login(username, password) {
      const res = await doFetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error(`登录失败（${res.status}）：请先运行 pnpm eval:seed`);
      const setCookie = res.headers.get("set-cookie") ?? "";
      cookie = setCookie.split(";")[0] ?? "";
      if (!cookie) throw new Error("登录响应未带 set-cookie");
    },

    async createSession(agentId, title) {
      const res = await doFetch(`${base}/api/sessions`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ agentId, ...(title ? { title } : {}) }),
      });
      if (!res.ok) throw new Error(`建会话失败（${res.status}）`);
      const json = (await res.json()) as { id: string };
      return json.id;
    },

    async uploadReference(sessionId, file, name) {
      const form = new FormData();
      form.append("file", file, name);
      form.append("purpose", "reference");
      form.append("sessionId", sessionId);
      const res = await doFetch(`${base}/upload`, { method: "POST", headers: headers(), body: form });
      if (!res.ok) throw new Error(`参考图上传失败（${res.status}）`);
      const json = (await res.json()) as { assetId: string };
      return json.assetId;
    },

    async getFile(url) {
      const res = await doFetch(`${base}${url}`, { headers: headers() });
      if (!res.ok) throw new Error(`取文件失败（${res.status}）：${url}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async chat(body) {
      return doFetch(`${base}/api/chat`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify(body),
      });
    },
  };
}
```

**Step 4: 跑测试确认通过**

Run: `pnpm --filter @oops/eval test http`
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/eval/src/http.ts packages/eval/src/http.test.ts
git commit -m "feat(eval): add black-box http client"
```

---

## Task 4: SSE 解析与 run 驱动

**Files:**
- Create: `packages/eval/src/sse.ts`
- Create: `packages/eval/src/run.ts`
- Test: `packages/eval/src/sse.test.ts`
- Test: `packages/eval/src/run.test.ts`

**Step 1: 写失败测试（SSE 解析）**

`packages/eval/src/sse.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseSseStream } from "./sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe("parseSseStream", () => {
  it("按空行切分事件并按 chunk 边界拼装", async () => {
    const s = streamOf([
      'event: message_delta\ndata: {"type":"message_delta","text":"你',
      '好"}\n\n',
      'event: finish\ndata: {"type":"finish","stopReason":"end"}\n\n',
    ]);
    const events = [];
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "message_delta", text: "你好" });
    expect(events[1]).toMatchObject({ type: "finish" });
  });

  it("忽略注释行（心跳）", async () => {
    const s = streamOf([": ping\n\n", 'event: finish\ndata: {"type":"finish"}\n\n']);
    const events = [];
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events).toHaveLength(1);
  });
});
```

**Step 2: 写失败测试（run 收集产物）**

`packages/eval/src/run.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { collectFromEvents } from "./run";

const events = [
  { type: "message_delta", text: "好的" },
  { type: "tool_start", id: "t1", name: "render_html", args: { html: "<html></html>", height: 1334 } },
  { type: "tool_end", id: "t1", name: "render_html", details: { assetId: "a1", url: "/files/p.png", width: 750, height: 1334 } },
  { type: "finish", stopReason: "end" },
];

describe("collectFromEvents", () => {
  it("提取 render_html 的 html 与产物", () => {
    const r = collectFromEvents(events as never);
    expect(r.html).toBe("<html></html>");
    expect(r.assetUrl).toBe("/files/p.png");
    expect(r.size).toEqual([750, 1334]);
    expect(r.toolErrors).toEqual([]);
  });

  it("工具失败进入 toolErrors", () => {
    const r = collectFromEvents([
      { type: "tool_end", id: "t1", name: "render_html", details: { error: "render_failed", message: "boom" } },
    ] as never);
    expect(r.toolErrors[0]).toMatchObject({ code: "render_failed" });
  });
});
```

**Step 3: 跑测试确认失败**

Run: `pnpm --filter @oops/eval test sse run`
Expected: FAIL — 模块不存在。

**Step 4: 实现 SSE**

`packages/eval/src/sse.ts`：

```ts
export interface SseEvent {
  type: string;
  [k: string]: unknown;
}

/** 解析 `event:`/`data:` 帧；心跳注释行与空帧直接跳过。 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          yield JSON.parse(data) as SseEvent;
        } catch {
          // 半帧/坏帧不致命：评测记录异常，不中断整轮
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
}
```

**Step 5: 实现 run 收集**

`packages/eval/src/run.ts`：

```ts
import type { SseEvent } from "./sse";

export interface ToolError {
  code: string;
  message: string;
}

export interface RunArtifacts {
  html: string | null;
  assetUrl: string | null;
  size: [number, number] | null;
  toolErrors: ToolError[];
  toolCalls: { name: string; args: unknown }[];
  stopReason: string | null;
  fatal: string | null;
  text: string;
}

/** 从事件流提取评测所需的一切；纯函数，便于单测。 */
export function collectFromEvents(events: SseEvent[]): RunArtifacts {
  const out: RunArtifacts = {
    html: null,
    assetUrl: null,
    size: null,
    toolErrors: [],
    toolCalls: [],
    stopReason: null,
    fatal: null,
    text: "",
  };
  for (const e of events) {
    if (e.type === "message_delta") out.text += String(e.text ?? "");
    else if (e.type === "tool_start") {
      out.toolCalls.push({ name: String(e.name), args: e.args });
      if (e.name === "render_html") {
        const args = e.args as { html?: string } | null;
        if (args?.html) out.html = args.html;
      }
    } else if (e.type === "tool_end") {
      const d = (e.details ?? null) as Record<string, unknown> | null;
      if (d && typeof d.error === "string") {
        out.toolErrors.push({ code: d.error, message: String(d.message ?? "") });
      } else if (e.name === "render_html" && d && typeof d.url === "string") {
        out.assetUrl = d.url;
        out.size = [Number(d.width), Number(d.height)];
      }
    } else if (e.type === "finish") out.stopReason = String(e.stopReason ?? "");
    else if (e.type === "error") out.fatal = String(e.message ?? "unknown");
  }
  return out;
}
```

**Step 6: 跑测试确认通过**

Run: `pnpm --filter @oops/eval test`
Expected: 全绿。

**Step 7: Commit**

```bash
git add packages/eval/src/sse.ts packages/eval/src/sse.test.ts packages/eval/src/run.ts packages/eval/src/run.test.ts
git commit -m "feat(eval): parse sse stream and collect run artifacts"
```

---

## Task 5: L1 判定（结构：尺寸 / CSS 黑名单 / 存在性）

**Files:**
- Create: `packages/eval/src/judges/l1.ts`
- Test: `packages/eval/src/judges/l1.test.ts`

**Step 1: 写失败测试**

`packages/eval/src/judges/l1.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { judgeL1, pngSize } from "./l1";

/** 最小 PNG 头：签名 + IHDR（宽高在 offset 16/20）。 */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

describe("pngSize", () => {
  it("读出 IHDR 宽高", () => {
    expect(pngSize(pngHeader(750, 1334))).toEqual([750, 1334]);
  });
  it("非 PNG 返回 null", () => {
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("judgeL1", () => {
  const base = {
    expect: { size: [750, 1334] as [number, number], denyCss: ["display:grid"] },
  };

  it("尺寸不符记 size_mismatch", () => {
    const r = judgeL1({ ...base, artifacts: { assetUrl: "/f", size: [750, 1000], html: "<html></html>" }, bytes: pngHeader(750, 1000) });
    expect(r.failures.map((f) => f.code)).toContain("size_mismatch");
  });

  it("命中 denyCss 记 css_unsupported", () => {
    const r = judgeL1({ ...base, artifacts: { assetUrl: "/f", size: [750, 1334], html: "<div style='display:grid'></div>" }, bytes: pngHeader(750, 1334) });
    expect(r.failures.map((f) => f.code)).toContain("css_unsupported");
  });

  it("无产物记 image_missing", () => {
    const r = judgeL1({ ...base, artifacts: { assetUrl: null, size: null, html: null }, bytes: null });
    expect(r.failures.map((f) => f.code)).toContain("image_missing");
  });

  it("全部满足时零失败", () => {
    const r = judgeL1({ ...base, artifacts: { assetUrl: "/f", size: [750, 1334], html: "<div style='display:flex'></div>" }, bytes: pngHeader(750, 1334) });
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
  });
});
```

**Step 2: 跑测试确认失败**

Run: `pnpm --filter @oops/eval test l1`
Expected: FAIL — 模块不存在。

**Step 3: 实现**

`packages/eval/src/judges/l1.ts`：

```ts
import type { Failure } from "../taxonomy";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

export interface L1Input {
  expect: { size: [number, number]; denyCss: string[] };
  artifacts: { assetUrl: string | null; size: [number, number] | null; html: string | null };
  bytes: Uint8Array | null;
}

export interface JudgeResult {
  pass: boolean;
  failures: Failure[];
}

/** L1 纯计算判定：不触网、不启浏览器。 */
export function judgeL1(input: L1Input): JudgeResult {
  const failures: Failure[] = [];
  const { artifacts, expect } = input;

  if (!artifacts.assetUrl || !input.bytes) {
    failures.push({ code: "image_missing", detail: "本轮没有产出图片" });
    return { pass: false, failures };
  }

  const actual = pngSize(input.bytes);
  if (!actual) {
    failures.push({ code: "render_error", detail: "产物不是合法 PNG" });
  } else if (actual[0] !== expect.size[0] || actual[1] !== expect.size[1]) {
    failures.push({
      code: "size_mismatch",
      detail: `期望 ${expect.size.join("×")}，实际 ${actual.join("×")}`,
    });
  }

  const html = artifacts.html ?? "";
  for (const needle of expect.denyCss) {
    if (html.includes(needle)) {
      failures.push({ code: "css_unsupported", detail: `HTML 命中禁用样式 ${needle}` });
    }
  }

  return { pass: failures.length === 0, failures };
}
```

**Step 4: 先建 taxonomy 占位（Task 9 会补全）**

`packages/eval/src/taxonomy.ts`：

```ts
export type FailureCode =
  | "render_error"
  | "css_unsupported"
  | "overflow"
  | "missing_glyph"
  | "text_missing"
  | "image_missing"
  | "no_tool_call"
  | "timeout"
  | "content_rejected"
  | "size_mismatch"
  | "judge_low";

export const FAILURE_LABELS: Record<FailureCode, string> = {
  render_error: "渲染失败",
  css_unsupported: "用了不支持的样式",
  overflow: "版式溢出",
  missing_glyph: "字形缺失",
  text_missing: "该出现的文案没出现",
  image_missing: "没有产出图片",
  no_tool_call: "模型没调用工具",
  timeout: "超时",
  content_rejected: "内容被拒",
  size_mismatch: "尺寸不符",
  judge_low: "审美评分过低",
};

export interface Failure {
  code: FailureCode;
  detail: string;
}
```

**Step 5: 跑测试确认通过**

Run: `pnpm --filter @oops/eval test l1`
Expected: PASS。

**Step 6: Commit**

```bash
git add packages/eval/src/taxonomy.ts packages/eval/src/judges/l1.ts packages/eval/src/judges/l1.test.ts
git commit -m "feat(eval): add L1 structural judge"
```

---

## Task 6: L2 几何判定（eval 侧 Chromium 量 DOM）

**Files:**
- Create: `packages/eval/src/judges/l2.ts`
- Test: `packages/eval/src/judges/l2.test.ts`

**要点**：L2 用 Chromium 量的是**模型写的 HTML**，与生产渲染器解耦——P2 换渲染器时这里不用改。图片引用要通过 `route` 注入本地字节（`/files/*` 需要 cookie，评测器已持有 cookie）。

**Step 1: 写失败测试（用真实 chromium，但只喂内联 HTML，不触网）**

`packages/eval/src/judges/l2.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { judgeL2, measureHtml } from "./l2";

const fit = `<html><body style="margin:0;width:750px;height:1334px;overflow:hidden">
  <div style="height:1334px;display:flex">ok</div></body></html>`;

const overflow = `<html><body style="margin:0;width:750px;height:1334px">
  <div style="height:2000px">too tall</div></body></html>`;

describe("measureHtml", () => {
  it("量出溢出像素", async () => {
    const m = await measureHtml(overflow, [750, 1334]);
    expect(m.overflowPx).toBeGreaterThan(600);
    expect(m.text).toContain("too tall");
  }, 60_000);

  it("不溢出时 overflowPx 为 0", async () => {
    const m = await measureHtml(fit, [750, 1334]);
    expect(m.overflowPx).toBe(0);
  }, 60_000);
});

describe("judgeL2", () => {
  it("超过 maxOverflowPx 记 overflow", async () => {
    const m = await measureHtml(overflow, [750, 1334]);
    const r = judgeL2({ metrics: m, maxOverflowPx: 0 });
    expect(r.failures.map((f) => f.code)).toContain("overflow");
  }, 60_000);
});
```

**Step 2: 跑测试确认失败**

Run: `pnpm --filter @oops/eval test l2`
Expected: FAIL — 模块不存在。

**Step 3: 实现**

`packages/eval/src/judges/l2.ts`：

```ts
import { chromium, type Browser } from "playwright";
import type { Failure } from "../taxonomy";

export interface Geometry {
  overflowPx: number;
  clientHeight: number;
  scrollHeight: number;
  text: string;
  images: { src: string; width: number; height: number }[];
}

let browserPromise: Promise<Browser> | null = null;

/** 浏览器实例复用：一批评测共用一个，进程退出前 close。 */
export async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}

/**
 * 在 Chromium 里量模型产出的 HTML。
 * js 关闭是结构性事实：测量靠 Playwright 的 CDP evaluate，不依赖页面脚本。
 */
export async function measureHtml(
  html: string,
  size: [number, number],
  options: { fileBytes?: Map<string, Uint8Array> } = {},
): Promise<Geometry> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: size[0], height: size[1] },
  });
  try {
    const page = await context.newPage();
    // 拦截所有出网：/files/* 用评测器取到的字节回填，其余一律 abort（与生产白名单一致）
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const bytes = options.fileBytes?.get(url.pathname);
      if (bytes) {
        return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(bytes) });
      }
      if (url.protocol === "data:") return route.continue();
      return route.abort();
    });
    await page.setContent(html, { waitUntil: "load" });
    return await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      return {
        overflowPx: Math.max(0, doc.scrollHeight - window.innerHeight, body.scrollWidth - window.innerWidth),
        clientHeight: window.innerHeight,
        scrollHeight: doc.scrollHeight,
        text: body.innerText,
        images: Array.from(document.images).map((i) => ({
          src: i.getAttribute("src") ?? "",
          width: i.naturalWidth,
          height: i.naturalHeight,
        })),
      };
    });
  } finally {
    await context.close();
  }
}

export function judgeL2(input: { metrics: Geometry; maxOverflowPx: number }): {
  pass: boolean;
  failures: Failure[];
} {
  const failures: Failure[] = [];
  const { metrics, maxOverflowPx } = input;
  if (metrics.overflowPx > maxOverflowPx) {
    failures.push({
      code: "overflow",
      detail: `内容超出画布 ${metrics.overflowPx}px（上限 ${maxOverflowPx}px）`,
    });
  }
  const broken = metrics.images.filter((i) => i.width === 0 || i.height === 0);
  if (broken.length > 0) {
    failures.push({ code: "image_missing", detail: `${broken.length} 个 <img> 未加载` });
  }
  return { pass: failures.length === 0, failures };
}
```

**Step 4: 跑测试确认通过**

Run: `pnpm --filter @oops/eval test l2`
Expected: PASS（首次会启 Chromium，较慢）。

**Step 5: Commit**

```bash
git add packages/eval/src/judges/l2.ts packages/eval/src/judges/l2.test.ts
git commit -m "feat(eval): add L2 geometry judge via chromium"
```

---

## Task 7: VLM 客户端与 L3 文字判定

**Files:**
- Create: `packages/eval/src/vlm.ts`
- Create: `packages/eval/src/judges/l3.ts`
- Test: `packages/eval/src/judges/l3.test.ts`

**Step 1: 写失败测试**

`packages/eval/src/judges/l3.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { judgeL3 } from "./l3";

const vlm = (text: string) => async () => text;

describe("judgeL3", () => {
  it("DOM 有、图里也能读到 → 通过", async () => {
    const r = await judgeL3({
      domText: "恒温 12 小时",
      mustContain: ["恒温 12 小时"],
      image: new Uint8Array([1]),
      vlm: vlm("海报文字：恒温 12 小时"),
    });
    expect(r.failures).toEqual([]);
  });

  it("DOM 有、图里读不到 → missing_glyph", async () => {
    const r = await judgeL3({
      domText: "桓台𠮷字",
      mustContain: ["𠮷"],
      image: new Uint8Array([1]),
      vlm: vlm("海报文字：桓台 字"),
    });
    expect(r.failures.map((f) => f.code)).toContain("missing_glyph");
  });

  it("DOM 里就没有 → text_missing", async () => {
    const r = await judgeL3({
      domText: "别的内容",
      mustContain: ["恒温 12 小时"],
      image: new Uint8Array([1]),
      vlm: vlm("别的内容"),
    });
    expect(r.failures.map((f) => f.code)).toContain("text_missing");
  });
});
```

**Step 2: 跑测试确认失败**

Run: `pnpm --filter @oops/eval test l3`
Expected: FAIL。

**Step 3: 实现 VLM 客户端**

`packages/eval/src/vlm.ts`：

```ts
export type VisionAsk = (args: {
  prompt: string;
  imageBase64: string;
  mimeType: string;
}) => Promise<string>;

/** OpenAI 兼容的视觉问答；模型来自 EVAL_VLM_MODEL（默认与生产 vision 模型一致）。 */
export function createVlm(opts: { baseUrl: string; apiKey: string; model: string }): VisionAsk {
  return async ({ prompt, imageBase64, mimeType }) => {
    const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`VLM 调用失败（${res.status}）`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  };
}

/** 归一化：去掉空白与标点差异，只比较字面字符是否都被画出来。 */
export function normalizeForGlyphCheck(s: string): string {
  return s.replace(/\s+/g, "");
}
```

**Step 4: 实现 L3**

`packages/eval/src/judges/l3.ts`：

```ts
import type { Failure } from "../taxonomy";
import { normalizeForGlyphCheck, type VisionAsk } from "../vlm";

export interface L3Input {
  domText: string;
  mustContain: string[];
  image: Uint8Array;
  vlm: VisionAsk;
  mimeType?: string;
}

/**
 * L3：该出现的文案是否真的被画出来了。
 * DOM 有而图里读不到 = 字形缺失（生产环境里汉字超出字体子集时正是这个表现）。
 */
export async function judgeL3(input: L3Input): Promise<{ pass: boolean; failures: Failure[] }> {
  const failures: Failure[] = [];
  if (input.mustContain.length === 0) return { pass: true, failures };

  const dom = normalizeForGlyphCheck(input.domText);
  const missingDom = input.mustContain.filter((t) => !dom.includes(normalizeForGlyphCheck(t)));
  for (const t of missingDom) {
    failures.push({ code: "text_missing", detail: `DOM 中找不到「${t}」` });
  }
  if (missingDom.length === input.mustContain.length) return { pass: false, failures };

  const readBack = normalizeForGlyphCheck(
    await input.vlm({
      prompt:
        "逐字读出这张图里的所有文字，按视觉顺序，用换行分隔。不要描述、不要补全、不要纠错，只抄你看到的字。",
      imageBase64: Buffer.from(input.image).toString("base64"),
      mimeType: input.mimeType ?? "image/png",
    }),
  );

  for (const t of input.mustContain) {
    if (missingDom.includes(t)) continue;
    if (!readBack.includes(normalizeForGlyphCheck(t))) {
      failures.push({
        code: "missing_glyph",
        detail: `「${t}」在 DOM 中存在但图中读不到（疑似缺字形）`,
      });
    }
  }
  return { pass: failures.length === 0, failures };
}
```

**Step 5: 跑测试确认通过**

Run: `pnpm --filter @oops/eval test l3`
Expected: PASS。

**Step 6: Commit**

```bash
git add packages/eval/src/vlm.ts packages/eval/src/judges/l3.ts packages/eval/src/judges/l3.test.ts
git commit -m "feat(eval): add vlm client and L3 text judge"
```

---

## Task 8: L4 审美判定（只看趋势）

**Files:**
- Create: `packages/eval/src/judges/l4.ts`
- Test: `packages/eval/src/judges/l4.test.ts`

**Step 1: 写失败测试**

`packages/eval/src/judges/l4.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { judgeL4, parseScore } from "./l4";

describe("parseScore", () => {
  it("从未知格式里抠出 1-5 分", () => {
    expect(parseScore("总分：4/5\n理由：层级清晰")).toBe(4);
    expect(parseScore("3")).toBe(3);
  });
  it("无法解析返回 null", () => {
    expect(parseScore("看不出")).toBeNull();
  });
});

describe("judgeL4", () => {
  it("低于阈值记 judge_low，但不阻断", async () => {
    const r = await judgeL4({
      image: new Uint8Array([1]),
      mustContain: [],
      vlm: async () => "总分：2/5\n理由：层级混乱",
      threshold: 3,
    });
    expect(r.score).toBe(2);
    expect(r.failures.map((f) => f.code)).toContain("judge_low");
    expect(r.blocking).toBe(false);
  });
});
```

**Step 2: 跑测试确认失败**

Run: `pnpm --filter @oops/eval test l4`
Expected: FAIL。

**Step 3: 实现**

`packages/eval/src/judges/l4.ts`：

```ts
import type { Failure } from "../taxonomy";
import type { VisionAsk } from "../vlm";

const RUBRIC = `你是电商海报评审。按四项各 1-5 分打分：视觉层级、配色克制、留白节奏、商品主体突出。
最后一行只输出 "总分：X/5"，X 为四项平均后四舍五入的整数。不要输出其它格式。`;

export function parseScore(text: string): number | null {
  const m = text.match(/(\d)\s*\/\s*5/) ?? text.match(/^\s*(\d)\s*$/m);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 5 ? n : null;
}

export interface L4Result {
  score: number | null;
  reason: string;
  failures: Failure[];
  /** L4 永不作为回归门，调用方据此只记录不阻断。 */
  blocking: false;
}

export async function judgeL4(input: {
  image: Uint8Array;
  mustContain: string[];
  vlm: VisionAsk;
  threshold: number;
  mimeType?: string;
}): Promise<L4Result> {
  const answer = await input.vlm({
    prompt: `${RUBRIC}\n图中应出现的关键文案：${input.mustContain.join("、") || "（无）"}`,
    imageBase64: Buffer.from(input.image).toString("base64"),
    mimeType: input.mimeType ?? "image/png",
  });
  const score = parseScore(answer);
  const failures: Failure[] =
    score !== null && score < input.threshold
      ? [{ code: "judge_low", detail: `审美评分 ${score}/5（阈值 ${input.threshold}）` }]
      : [];
  return { score, reason: answer.trim(), failures, blocking: false };
}
```

**Step 4: 跑测试确认通过**

Run: `pnpm --filter @oops/eval test l4`
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/eval/src/judges/l4.ts packages/eval/src/judges/l4.test.ts
git commit -m "feat(eval): add L4 aesthetic judge"
```

---

## Task 9: 报告生成与基线比较

**Files:**
- Create: `packages/eval/src/report.ts`
- Create: `packages/eval/src/baseline.ts`
- Test: `packages/eval/src/baseline.test.ts`

**Step 1: 写失败测试**

`packages/eval/src/baseline.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { compareToBaseline } from "./baseline";

const run = (id: string, codes: string[]) => ({
  id,
  failures: codes.map((code) => ({ code, detail: "" })),
});

describe("compareToBaseline", () => {
  it("新增 L1-L3 失败 → 阻断", () => {
    const r = compareToBaseline({
      baseline: { results: [run("a", [])] },
      current: { results: [run("a", ["overflow"])] },
    });
    expect(r.blocking).toBe(true);
    expect(r.regressions).toHaveLength(1);
  });

  it("只有 judge_low 新增 → 不阻断", () => {
    const r = compareToBaseline({
      baseline: { results: [run("a", [])] },
      current: { results: [run("a", ["judge_low"])] },
    });
    expect(r.blocking).toBe(false);
  });

  it("修复了失败 → 不算回归", () => {
    const r = compareToBaseline({
      baseline: { results: [run("a", ["overflow"])] },
      current: { results: [run("a", [])] },
    });
    expect(r.blocking).toBe(false);
    expect(r.fixed).toHaveLength(1);
  });

  it("新增 case 无基线 → 记录但不阻断", () => {
    const r = compareToBaseline({
      baseline: { results: [] },
      current: { results: [run("new", ["overflow"])] },
    });
    expect(r.blocking).toBe(false);
  });
});
```

**Step 2: 跑测试确认失败**

Run: `pnpm --filter @oops/eval test baseline`
Expected: FAIL。

**Step 3: 实现基线比较**

`packages/eval/src/baseline.ts`：

```ts
import type { Failure } from "./taxonomy";

export interface CaseResultLike {
  id: string;
  failures: Failure[];
}
export interface ReportLike {
  results: CaseResultLike[];
}

/** L4 不进闸门：评分抖动不适合当回归门。 */
const NON_BLOCKING: ReadonlySet<string> = new Set(["judge_low"]);

export interface CompareResult {
  blocking: boolean;
  regressions: { id: string; code: string }[];
  fixed: { id: string; code: string }[];
}

export function compareToBaseline(input: { baseline: ReportLike; current: ReportLike }): CompareResult {
  const before = new Map(input.baseline.results.map((r) => [r.id, new Set(r.failures.map((f) => f.code))]));
  const regressions: { id: string; code: string }[] = [];
  const fixed: { id: string; code: string }[] = [];

  for (const r of input.current.results) {
    const prev = before.get(r.id);
    const now = new Set(r.failures.map((f) => f.code));
    if (!prev) continue; // 新 case：无基线可比较，只记录
    for (const code of now) if (!prev.has(code)) regressions.push({ id: r.id, code });
    for (const code of prev) if (!now.has(code)) fixed.push({ id: r.id, code });
  }

  return {
    blocking: regressions.some((r) => !NON_BLOCKING.has(r.code)),
    regressions,
    fixed,
  };
}
```

**Step 4: 实现报告写出**

`packages/eval/src/report.ts`：

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FAILURE_LABELS, type FailureCode } from "./taxonomy";

export interface CaseResult {
  id: string;
  agent: string;
  durationMs: number;
  imageUrl: string | null;
  failures: { code: string; detail: string }[];
  l4: { score: number | null; reason: string } | null;
  toolCalls: string[];
  rawText: string;
}

export interface Report {
  runAt: string;
  total: number;
  passed: number;
  results: CaseResult[];
}

export function summarize(report: Report): Record<string, number> {
  const byCode: Record<string, number> = {};
  for (const r of report.results) {
    for (const f of r.failures) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
  }
  return byCode;
}

export function writeReport(dir: string, report: Report): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));

  const byCode = summarize(report);
  const lines = [
    `# 评测报告 ${report.runAt}`,
    "",
    `通过 ${report.passed}/${report.total}`,
    "",
    "## 失败分布",
    "",
    "| 分类 | 次数 |",
    "| --- | --- |",
    ...Object.entries(byCode)
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `| ${FAILURE_LABELS[code as FailureCode] ?? code} (\`${code}\`) | ${n} |`),
    "",
    "## 明细",
    "",
    "| case | 结果 | L4 | 耗时 | 产物 |",
    "| --- | --- | --- | --- | --- |",
    ...report.results.map((r) => {
      const status = r.failures.length === 0 ? "PASS" : r.failures.map((f) => f.code).join(", ");
      return `| ${r.id} | ${status} | ${r.l4?.score ?? "-"} | ${r.durationMs}ms | ${r.imageUrl ?? "-"} |`;
    }),
  ];
  const md = join(dir, "report.md");
  writeFileSync(md, `${lines.join("\n")}\n`);
  return md;
}
```

**Step 5: 跑测试确认通过**

Run: `pnpm --filter @oops/eval test baseline`
Expected: PASS。

**Step 6: Commit**

```bash
git add packages/eval/src/report.ts packages/eval/src/baseline.ts packages/eval/src/baseline.test.ts
git commit -m "feat(eval): add report writer and baseline comparison"
```

---

## Task 10: CLI 编排

**Files:**
- Create: `packages/eval/src/cli.ts`
- Create: `packages/eval/src/execute.ts`

**Step 1: 实现单 case 执行**

`packages/eval/src/execute.ts`：

```ts
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { EvalCase } from "./case";
import { createClient, type EvalClient } from "./http";
import { parseSseStream } from "./sse";
import { collectFromEvents } from "./run";
import { judgeL1 } from "./judges/l1";
import { judgeL2, measureHtml } from "./judges/l2";
import { judgeL3 } from "./judges/l3";
import { judgeL4 } from "./judges/l4";
import type { VisionAsk } from "./vlm";
import type { CaseResult } from "./report";

const ROOT = new URL("..", import.meta.url).pathname;

export interface ExecCtx {
  client: EvalClient;
  vlm: VisionAsk;
  fixturesDir: string;
  l4Threshold: number;
}

export async function executeCase(c: EvalCase, ctx: ExecCtx): Promise<CaseResult> {
  const started = Date.now();
  const sessionId = await ctx.client.createSession(c.agent, `eval-${c.id}`);

  const referenceAssetIds: string[] = [];
  for (const rel of c.references) {
    const path = join(ctx.fixturesDir, rel);
    const bytes = readFileSync(path);
    const blob = new Blob([bytes], { type: mimeOf(rel) });
    referenceAssetIds.push(await ctx.client.uploadReference(sessionId, blob, basename(rel)));
  }

  const res = await ctx.client.chat({
    sessionId,
    agentId: c.agent,
    message: c.message,
    ...(referenceAssetIds.length > 0 ? { referenceAssetIds } : {}),
  });

  const events = [];
  if (res.body) {
    for await (const e of parseSseStream(res.body)) events.push(e);
  }
  const artifacts = collectFromEvents(events);

  const failures = [...artifacts.toolErrors.map((e) => ({ code: e.code, detail: e.message }))];
  if (!artifacts.html && failures.length === 0) {
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
      expect: { size: c.assert.size, denyCss: c.assert.denyCss },
      artifacts,
      bytes: imageBytes,
    }).failures,
  );

  if (artifacts.html) {
    const fileBytes = new Map<string, Uint8Array>();
    if (artifacts.assetUrl) fileBytes.set(artifacts.assetUrl, imageBytes ?? new Uint8Array());
    const metrics = await measureHtml(artifacts.html, c.assert.size, { fileBytes });
    failures.push(...judgeL2({ metrics, maxOverflowPx: c.assert.maxOverflowPx }).failures);

    if (imageBytes) {
      failures.push(
        ...(
          await judgeL3({
            domText: metrics.text,
            mustContain: c.assert.mustContain,
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
        mustContain: c.assert.mustContain,
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
  };
}

function dedupe<T extends { code: string; detail: string }>(list: T[]): T[] {
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

export { ROOT };
```

**Step 2: 实现 CLI**

`packages/eval/src/cli.ts`：

```ts
#!/usr/bin/env tsx
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "./case";
import { createClient } from "./http";
import { createVlm } from "./vlm";
import { executeCase } from "./execute";
import { writeReport, type Report } from "./report";
import { compareToBaseline } from "./baseline";
import { closeBrowser } from "./judges/l2";

const PKG = new URL("..", import.meta.url).pathname;
const args = new Set(process.argv.slice(2));
const tagArg = process.argv.find((a) => a.startsWith("--tag="))?.split("=")[1];

async function main(): Promise<number> {
  const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
  const username = process.env.EVAL_USERNAME ?? "eval";
  const password = process.env.EVAL_PASSWORD ?? "eval-password-123";
  const vlmBaseUrl = process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const apiKey = process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? "";
  if (!apiKey) throw new Error("缺 QWEN_API_KEY / DASHSCOPE_API_KEY");

  const client = createClient({ baseUrl });
  await client.login(username, password);

  let cases = loadCases(join(PKG, "cases"));
  if (args.has("--smoke")) cases = cases.slice(0, 6);
  if (tagArg) cases = cases.filter((c) => c.tags.includes(tagArg));
  if (cases.length === 0) throw new Error("没有匹配的 case");

  const vlm = createVlm({
    baseUrl: vlmBaseUrl,
    apiKey,
    model: process.env.EVAL_VLM_MODEL ?? "qwen3.7-plus",
  });

  const results = [];
  for (const c of cases) {
    process.stdout.write(`▶ ${c.id} ... `);
    try {
      const r = await executeCase(c, {
        client,
        vlm,
        fixturesDir: join(PKG, "fixtures"),
        l4Threshold: Number(process.env.EVAL_L4_THRESHOLD ?? 3),
      });
      results.push(r);
      process.stdout.write(r.failures.length === 0 ? "PASS\n" : `FAIL ${r.failures.map((f) => f.code).join(",")}\n`);
    } catch (err) {
      results.push({
        id: c.id,
        agent: c.agent,
        durationMs: 0,
        imageUrl: null,
        failures: [{ code: "render_error", detail: (err as Error).message }],
        l4: null,
        toolCalls: [],
        rawText: "",
      });
      process.stdout.write(`ERROR ${(err as Error).message}\n`);
    }
  }

  const report: Report = {
    runAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.failures.length === 0).length,
    results,
  };
  const stamp = report.runAt.replace(/[:.]/g, "-");
  const md = writeReport(join(PKG, "runs", stamp), report);
  console.log(`\n报告：${md}`);

  const baselinePath = join(PKG, "baseline.json");
  if (args.has("--update-baseline")) {
    writeFileSync(baselinePath, JSON.stringify({ results }, null, 2));
    console.log(`基线已更新：${baselinePath}`);
    return 0;
  }
  if (!existsSync(baselinePath)) {
    console.log("无基线文件，本次不阻断。跑通后用 --update-baseline 记录基线。");
    return 0;
  }

  const cmp = compareToBaseline({
    baseline: JSON.parse(readFileSync(baselinePath, "utf8")),
    current: report,
  });
  for (const r of cmp.regressions) console.log(`回归：${r.id} → ${r.code}`);
  for (const r of cmp.fixed) console.log(`修复：${r.id} → ${r.code}`);
  return cmp.blocking ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeBrowser();
    process.exit(code);
  })
  .catch(async (err) => {
    await closeBrowser();
    console.error(err);
    process.exit(2);
  });
```

**Step 3: 手测 CLI 帮助路径**

Run: `pnpm --filter @oops/eval typecheck`
Expected: 无错误。

**Step 4: Commit**

```bash
git add packages/eval/src/cli.ts packages/eval/src/execute.ts
git commit -m "feat(eval): orchestrate cases via cli"
```

---

## Task 11: 评测用户准备 + doctor

**Files:**
- Create: `packages/eval/src/seed.ts`
- Create: `packages/eval/src/doctor.ts`
- Modify: `packages/eval/package.json`（新增 `seed` / `doctor` script）

**Step 1: 实现 seed**

`packages/eval/src/seed.ts`：

```ts
import { hashPassword } from "@oops/auth/password";
import { createUser } from "@oops/db/user.repo";
import { creditsService } from "@oops/domain/credits/service";

/**
 * 幂等创建一个专用评测账号并灌入积分。
 * 直接走 DB 而不是注册路由：注册需要邀请码，评测不该依赖邀请码状态。
 */
async function main(): Promise<void> {
  const username = process.env.EVAL_USERNAME ?? "eval";
  const password = process.env.EVAL_PASSWORD ?? "eval-password-123";
  const passwordHash = await hashPassword(password);

  const existing = await createUser.findByUsername?.(username);
  if (existing) {
    console.log(`评测账号已存在：${username}`);
  } else {
    const user = await createUser.create({ username, passwordHash, displayName: "评测" });
    await creditsService.grantInitialCredits(user.id);
    console.log(`已创建评测账号：${username}（密码见 EVAL_PASSWORD）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

> 实现提示：`@oops/db/user.repo` 的导出名以实现为准（`createUserRepo()` 风格更可能与仓库一致）。写代码前先 `grep -n "export function" packages/db/src/user.repo.ts` 对齐，别照抄本段。

**Step 2: 实现 doctor**

`packages/eval/src/doctor.ts`：

```ts
import { execFileSync } from "node:child_process";

interface Check {
  name: string;
  ok: boolean;
  hint: string;
}

async function main(): Promise<void> {
  const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
  const checks: Check[] = [];

  checks.push({
    name: "QWEN_API_KEY",
    ok: Boolean(process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY),
    hint: "在 .env.local 里填 DASHSCOPE_API_KEY",
  });

  try {
    const res = await fetch(`${baseUrl}/api/agents`);
    checks.push({ name: `web ${baseUrl}`, ok: res.ok, hint: "先 pnpm dev" });
  } catch {
    checks.push({ name: `web ${baseUrl}`, ok: false, hint: "先 pnpm dev" });
  }

  try {
    execFileSync("pnpm", ["exec", "playwright", "install", "--dry-run"], { stdio: "ignore" });
    checks.push({ name: "chromium", ok: true, hint: "" });
  } catch {
    checks.push({ name: "chromium", ok: false, hint: "pnpm --filter @oops/eval exec playwright install chromium" });
  }

  for (const c of checks) console.log(`${c.ok ? "✔" : "✘"} ${c.name}${c.ok ? "" : `  → ${c.hint}`}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main();
```

**Step 3: 加脚本**

`packages/eval/package.json` 的 `scripts` 增加：

```json
"seed": "tsx src/seed.ts",
"doctor": "tsx src/doctor.ts"
```

根 `package.json` 增加：

```json
"eval:seed": "pnpm --filter @oops/eval seed",
"eval:doctor": "pnpm --filter @oops/eval doctor"
```

**Step 4: 手测**

Run: `pnpm eval:doctor`
Expected: 至少 web 一项为 ✘（若没起服务），并给出 `先 pnpm dev` 提示。

**Step 5: Commit**

```bash
git add packages/eval/src/seed.ts packages/eval/src/doctor.ts packages/eval/package.json package.json
git commit -m "feat(eval): add eval user seeding and doctor preflight"
```

---

## Task 12: 6 个 smoke case、fixtures 与首个基线

**Files:**
- Create: `packages/eval/fixtures/gen.ts`
- Create: `packages/eval/fixtures/product.png`（生成物，入库）
- Create: `packages/eval/cases/001-poster-minimal.yaml` … `006-*.yaml`
- Create: `packages/eval/baseline.json`（首次跑完写入，入库）

**Step 1: 生成一张纯色测试商品图（不引外部素材）**

`packages/eval/fixtures/gen.ts`：

```ts
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

/** 生成 900×900 的纯色 PNG：只为了让 agent 有图可排，不追求画面。 */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const W = 900;
const H = 900;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // truecolor

const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  const row = y * (W * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < W; x += 1) {
    const p = row + 1 + x * 3;
    raw[p] = 214;
    raw[p + 1] = 226;
    raw[p + 2] = 214;
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(join(import.meta.dirname, "product.png"), png);
console.log("fixtures/product.png 已生成");
```

Run: `pnpm --filter @oops/eval exec tsx fixtures/gen.ts`
Expected: `fixtures/product.png 已生成`，文件约 30KB。

**Step 2: 写 6 个 case**

`cases/001-poster-minimal.yaml`：

```yaml
id: 001-poster-minimal
agent: poster-designer
message: 做一张极简风格海报，商品是这款保温杯，主标题「恒温 12 小时」，不要促销元素
references: [product.png]
tags: [poster, smoke]
assert:
  size: [750, 1334]
  mustContainText: ["恒温 12 小时"]
  maxOverflowPx: 0
  denyCss: ["display:grid", "float:"]
```

`cases/002-poster-promo.yaml`：

```yaml
id: 002-poster-promo
agent: poster-designer
message: 做一张促销海报，主题「秋季新款直降」，突出价格 129 元，要有明显的价格块
references: [product.png]
tags: [poster, smoke]
assert:
  size: [750, 1334]
  mustContainText: ["129"]
  maxOverflowPx: 0
  denyCss: ["display:grid", "float:"]
```

`cases/003-poster-tall.yaml`：

```yaml
id: 003-poster-tall
agent: poster-designer
message: 做一张信息较多的长版海报，讲清这款保温杯的 3 个卖点：316 内胆、24 小时保温、一键开盖
references: [product.png]
tags: [poster, smoke]
assert:
  size: [750, 1654]
  mustContainText: ["316", "24 小时"]
  maxOverflowPx: 0
  denyCss: ["display:grid", "float:"]
```

`cases/004-poster-square.yaml`：

```yaml
id: 004-poster-square
agent: poster-designer
message: 做一张适合电商主图的方形海报，突出「新品上市」
references: [product.png]
tags: [poster, smoke]
assert:
  size: [750, 1000]
  mustContainText: ["新品上市"]
  maxOverflowPx: 0
  denyCss: ["display:grid", "float:"]
```

`cases/005-atmosphere.yaml`：

```yaml
id: 005-atmosphere
agent: atmosphere-designer
message: 生成一张清晨阳光下的木质桌面场景图，画面里放一只陶瓷保温杯
tags: [image, smoke]
assert:
  size: [768, 1344]
  mustContainText: []
  maxOverflowPx: 0
  denyCss: []
```

> `005` 走的是文生图链路，不会有 `render_html`。实现时把 `execute.generate` 的判定放宽：case 未要求 `render_html` 时（`denyCss` 与 `mustContainText` 都为空），允许 `generate_image` 产物作为 `assetUrl`。

**Step 3: 让 005 走通**

在 `collectFromEvents` 中补一条：`tool_end` 且 `name === "generate_image"` 且 `details.url` 存在时同样写 `assetUrl`。补一条测试：

```ts
it("generate_image 也产出 assetUrl", () => {
  const r = collectFromEvents([
    { type: "tool_end", id: "t", name: "generate_image", details: { url: "/files/g.png", width: 768, height: 1344 } },
  ] as never);
  expect(r.assetUrl).toBe("/files/g.png");
});
```

**Step 4: 首次跑出基线**

```bash
pnpm eval:seed
pnpm dev                      # 另开一个终端
pnpm eval:doctor              # 应全 ✔
pnpm eval --smoke             # 看 6 例结果
pnpm eval --smoke --update-baseline
```

Expected: `runs/<ts>/report.md` 生成；`baseline.json` 写入。**第一批结果大概率不是全绿——这是正常的，它就是你的起点。**

**Step 5: 入库基线**

`packages/eval/.gitignore` 只忽略 `runs/`，`baseline.json` 与 `fixtures/product.png` 要入库：

```bash
git add packages/eval/cases packages/eval/fixtures packages/eval/baseline.json
git commit -m "feat(eval): add smoke cases, fixture generator and first baseline"
```

---

## Task 13: 文档

**Files:**
- Modify: `docs/ARCHITECTURE.md`（新增「评测」小节，指到 `packages/eval`）
- Modify: `AGENTS.md`（命令表加 `pnpm eval` / `pnpm eval:doctor`）
- Modify: `IMPROVEMENT.md`（登记「L4 阈值需用真实数据校准」）

**Step 1: 写文档**

`ARCHITECTURE.md` 新增小节内容要点：

- 评测是**黑盒 HTTP 驱动**，不 import 服务端代码，因此不受后续服务拆分影响；
- 四层判定与「只有 L1–L3 进闸门」的理由；
- 失败分类表（与 `taxonomy.ts` 一致）；
- 基线 `baseline.json` 入库，`runs/` 不入库。

**Step 2: 验证文档一致**

Run: `grep -n "pnpm eval" AGENTS.md`
Expected: 命中 2 行。

**Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md AGENTS.md IMPROVEMENT.md
git commit -m "docs: document the eval harness"
```

---

## 完成标准（P0 验收）

1. `pnpm --filter @oops/eval test` 全绿，且**不触网**；
2. `pnpm eval:doctor` 全 ✔；
3. `pnpm eval --smoke` 跑完 6 例，输出 `report.md`，失败按 `taxonomy.ts` 分类聚合；
4. 故意把某条 case 的 `assert.size` 改错，`pnpm eval --smoke` **退出码 1**；
5. `baseline.json` 已入库，`runs/` 未入库。

## 下一步（不在本计划范围）

P1：抽 `apps/creation` + `packages/contracts`。评测器此时**一行不用改**——它只依赖 HTTP 契约，除了 `EVAL_BASE_URL` 可能要指向新服务。
