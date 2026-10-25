# 设计：拆分创作域为独立服务（apps/creation）+ 浏览器渲染回归 + 评测闭环

> 日期：2026-10-25
> 状态：P0（评测闭环）已落地；**P1（抽 creation 进程）已落地（2026-10-25）**；P2–P4 待做
> 关联：翻转 `docs/ARCHITECTURE.md` §8 的 satori 决策；重写 `docs/DEPLOYMENT.md`；本设计不进入 Vercel 部署路径

## 1. 背景与问题

图片生成进入「改了好几版仍然不行」的状态。逐条查证后，反复修补失效不是因为某一处写错，而是三个独立缺口叠加：

| 症状 | 实际原因 | 证据 |
| --- | --- | --- |
| 异常多 | executor 零重试；provider 已分类出 `retryable` 但无消费方；agent 循环无轮次上限 | `packages/domain/src/tasks/executor.ts:89-134`、`apps/web/src/server/infra/providers/dashscope-images.ts:44-58` |
| 版式偏差 | 渲染器只支持 flex 子集，模型盲写 CSS；限制在正则表 / prompt / 文档三处重复 | `apps/web/src/server/infra/render/assert-layout-support.ts:33-58`、`agent/definitions/prompts/poster-designer.md:26-35` |
| 缺字静默 | 字体子集仅 GB2312 6763 字，超出不报错、不出字形 | `infra/render/fonts.ts:17-28` |
| 质量不高 | 全仓无 eval / golden / 回归 / 评分；模型（主模型无 vision）看不见自己的产物 | `packages/llm/src/catalog.ts:40-65` |

**核心判断**：这不是调参问题，而是**反馈回路缺失**。每次改动只能靠「再生成一张看看」验证，所以每一版「修好」的都是上一轮碰巧看到的那个 case。因此优先级是：先建「谁来判断好坏」，再谈「怎么生成得好」。

**同时翻转一个历史决策**：satori + resvg 是为 Vercel 函数包体积限制所做的妥协（提交 `96a2a49`），不是画质选择。部署策略改为「本地运行、clone 即用」后，该限制消失，Chromium 回到链路中。

## 2. 范围决策

- **部署形态**：不部署 Vercel。目标是他人 `git clone` 后本地可用。
- **验收形态**：混合——Postgres + MinIO 走 `docker compose`，web / admin / creation 三个 Node 进程走 `pnpm dev`，Chromium 跑在宿主机。
- **服务边界**：保留创作域独立服务（`apps/creation`），但形态是「同仓库、独立进程、一条命令起」，不引入跨机器、独立 CI、服务发现。
- **语言**：在线路径与评测路径**都用 TypeScript**。评测的判定交给 VLM API，不引入 Python 运行时（每多一个运行时，clone 失败率就上升一截）。若将来需要 OpenCV 级精细版式检测，再补可选 Python 边车。
- **渲染引擎**：Playwright + Chromium。
- **字体**：完整思源黑体（Noto Sans SC），放弃 GB2312 子集裁剪。

## 3. 进程与目录

```
apps/
├── web/          产品域 BFF + UI      :3000
├── admin/        管理台                :3001
└── creation/     创作域（新增）        :3002
packages/
├── config/ db/ domain/ llm/ auth/     ← 保持
└── contracts/                          ← 新增：SSE 事件与 run 请求的 zod schema
```

`apps/creation/src/`：

```
http/        /v1/runs (SSE) · /v1/agents · /health
agent/       loop · definitions · prompts · tools      ← 从 web 迁入
render/      Playwright 渲染（重写，替换 satori）
providers/   dashscope 文本/图像（从 web 迁入）
eval/        评测：样本执行 + judge + 评分落库
store/       DB 访问（复用 @oops/db）+ 对象存储
```

`apps/web` 删除：`src/server/agent/`、`src/server/infra/render/`、`src/server/infra/providers/`、`src/server/domain/tasks/` 的执行逻辑。保留：认证、会话/消息读取、资产读取、余额预检、通知、任务查询。

**渲染不抽成 `packages/render`**：只有 creation 一个消费方，抽包等于凭空多一层版本管理。等出现第二个消费方再抽。

## 4. 接口与流式契约

三个端点，`/v1` 前缀，web → creation 走内网 + `x-internal-token`。

```
POST /v1/runs      → SSE 流（唯一热路径）
GET  /v1/agents    → agent 元数据列表
GET  /health       → 存活 + Chromium 可用性
```

请求体：

```jsonc
{
  "runId": "uuid",                 // web 生成，幂等键
  "userId": "uuid",
  "sessionId": "uuid",
  "agentId": "poster-designer",
  "message": "原文",
  "referenceAssetIds": ["uuid"],   // ≤5，归属校验仍在 web 做一遍
  "locale": "zh"
}
```

**事件契约写进 `packages/contracts` 的 zod schema，而不是只写在文档里**。事件（`text-delta` / `tool-start` / `tool-result` / `finish` / `error`）加 `v: 1` 版本标记，沿用 `transcript` 已有的版本化机制。契约在编译期锁死两个服务，前端消费的 parts 类型直接复用。

**流式与中断**：web 拿到 `ReadableStream` 后**原样 pipe**，不解析、不重组、不缓存。浏览器断开时 web 调 `AbortController.abort()`，creation 捕获 abort 后中断 loop 并结算未完成任务，语义与现有「用户中断」一致（`docs/ARCHITECTURE.md` §5）。

**错误分两层**：

| 层 | 形态 | 谁负责 |
| --- | --- | --- |
| 建连前 | HTTP 401 / 402 / 404 / 409 + JSON | web 直接返回前端，不转发 |
| 建连后 | SSE `error` 事件（带 `code`） | creation 发，web 透传，前端显示 |

**幂等**：`runId` 重复 → `409`，不重复扣费。**心跳**：每 15s 一条 SSE 注释行，防本地代理掐断长连接。

**代价**：前端不能再顺手读取服务端内部状态，任何新信息都得先进事件契约。这是边界的税，属于预期成本。

## 5. 单一写者与数据边界

规则：**按「行」归属写者，不按表归属。**

| 数据 | 写者 | 另一侧 |
| --- | --- | --- |
| `messages` 用户行 | web（已有鉴权与引用校验） | creation 只读 |
| `messages` assistant / tool 行 | creation | web 只读 |
| `sessions.title` / `agent_id` | web | creation 只读 |
| `tasks` 全生命周期 | creation | web 只读（重试 = 新 run） |
| `assets` 新建 | creation | web 只读 |
| `assets.savedAt`（收藏） | web | — |
| 积分 ledger（冻结/结算/释放） | creation | web 只读余额 |
| 通知内容行 | admin / web 发起；积分类由 creation 发 | 已读态 web 写 |

**积分划给 creation 的理由**：冻结—执行—结算是同一事务内的连续动作。若结算时跨服务调 web，失败会留下永久冻结的积分，是最坏的故障形态。两边共享 `@oops/db` 与同一份领域逻辑，直写是唯一不制造悬空状态的选择。要求：积分领域代码必须在 `packages/domain`，两个进程都 import，禁止复制。

**启动责任**：

- `pnpm db:migrate` 是唯一迁移入口，从根目录执行；creation 启动时**不迁移**（避免三个进程抢锁）。
- 重启对账 `reconcileFrozen` 从 web 的 `instrumentation.ts` **搬到 creation**（创作域职责，且当前单实例可安全执行）。
- 通知保留策略（read + >90d 清理）留在 web。

**已知退化**：用户消息先由 web 落库、再发 run，creation 建连失败会出现「有用户消息、无回复」的中间态。处理：web 在 run 建连失败时删除自己刚写的那一行，**仅当该会话无任何 assistant 行**时才允许删除。

**新增 env**：`CREATION_PORT=3002`、`INTERNAL_TOKEN`、`CREATION_BASE_URL`、`PLAYWRIGHT_HEADLESS=1`，全部进 `.env.example`。

## 6. 评测闭环

`apps/creation/eval/`：

```
cases/                  每例一个 yaml，入库版本化
  fixtures/             商品图/参考图（小体积可入库）
judges/                 dom.ts / pixels.ts / vlm.ts
runs/                   <ts>/<case>/：图 + HTML + report.json（gitignore）
report.md               汇总（生成，不入库）
```

case 形态（断言必须可判定，不能是形容词）：

```yaml
id: 001-poster-minimal
agent: poster-designer
message: "做一张极简海报，商品是这款保温杯，标题『恒温 12 小时』"
references: [fixtures/cup.jpg]
assert:
  size: [750, 1334]
  mustContainText: ["恒温 12 小时"]
  maxOverflowPx: 0
  denyCss: [grid, float]
```

四层判定：

| 层 | 判什么 | 手段 | 确定性 |
| --- | --- | --- | --- |
| L1 结构 | 渲染成功、尺寸、CSS 黑名单 | Playwright + DOM | 完全确定 |
| L2 几何 | 溢出、越界、重叠 | `scrollHeight/clientHeight` + boundingBox | 完全确定 |
| L3 文字 | 该出现的字真的画出来了（防缺字豆腐块） | DOM 文本 vs VLM 读图文本 | 较高 |
| L4 审美 | 层级/配色/留白/商品还原度 | VLM judge + 固定 rubric，1–5 分 | 中，看趋势 |

有浏览器之后，L1/L2 从「靠肉眼」变成可自动断言：`scrollHeight > clientHeight` 即溢出，不依赖任何模型。这是 Chromium 回归的第二份红利，比 CSS 表达力更硬。

**回归门**：与上次基线比，**L1/L2/L3 任何一项新增失败 = 非零退出**；L4 只报趋势不阻断（VLM 分数抖动不适合当闸门）。

**失败分类固化**（跨版本可比的前提）：

```
render_error | css_unsupported | overflow | missing_glyph
image_missing | no_tool_call | timeout | content_rejected | judge_low
```

`report.md` 按类聚合，让「三个月后的趋势」取代一堆截图。

**成本**：一个 case ≈ 1 次生成 + 2 次 VLM。默认 `--smoke` 跑 6 例，`full` 跑全量，支持 `--tag` 筛选。

## 7. 错误与重试

现状是零重试 + 分类无人消费 + 错误 `kind` 为裸 string。

**分类学**：

```ts
type Failure =
  | { c: "transient" }   // rate_limited / timeout / network / 5xx
  | { c: "permanent" }   // content_rejected / invalid_html / invalid_args
  | { c: "config" }      // capability_unmet / missing_key / model_not_found
```

| 类别 | 策略 |
| --- | --- |
| transient | 自动重试 2 次，1s / 3s 退避，仍失败才上抛 |
| permanent | 不重试，结构化回喂 agent（带 `code` + 可执行提示） |
| config | fail-fast，不重试不降级（`capability_unmet` 的 MUST NOT 静默降级不变） |

**agent 循环加两个上限**（当前完全没有轮次上限）：

- `maxTurns`（建议 12）——超限以「已尽力」收尾，不报错；
- 同工具同参数重复调用 ≤2——结构性阻止模型重交同一份 HTML。

**渲染侧自动修复边界**：

- 溢出、缺商品图 → 可修，回喂重排；
- CSS 不支持、HTML 超体积 → 可修，回喂具体属性；
- **字体缺字 → 不可修**，归类 `missing_glyph` 并明确告知模型「无此字形，换词或换写法」，不再静默。

**双并发池**（当前渲染与生图共用一个闸门，同步阻塞会互相拖累）：

```
生成池（IO）：并发 3，超时 90s
渲染池（CPU/浏览器）：并发 2，超时 30s，浏览器实例复用
```

**Playwright 安全基线**（不继承 satori 的「结构性不执行 JS」，需重做）：

```
javascriptEnabled: false         → 结构性禁脚本
请求拦截：只放行 /files/ 与白名单 host，其余 abort
禁止 file:// 及 data: 之外的本地路径
每页 newPage → 用完 close，context 复用
```

**可观测性**：`runId` 贯穿日志，每次工具调用记 `{tool, attempt, kind, duration}`。

**vision 自检回环暂不开启**：有真实价值但显著抬成本，且在 L4 能稳定比较「开/关」差异之前无法证明有效。等基线成熟再决策。

## 8. 启动编排与验收

```bash
cp .env.example .env.local     # 必填：DATABASE_URL 本地值 + DASHSCOPE_API_KEY
pnpm setup                     # 依赖 + playwright install chromium + db:migrate + doctor
pnpm dev                       # docker compose up -d (pg/minio) → 并发起 web/admin/creation
pnpm eval --smoke
```

`pnpm setup` 内含 `doctor`：启动前一次性报告「缺哪个 env / Chromium 未安装 / 数据库连不上」，让失败发生在第 1 秒并说人话。另提供 `pnpm dev:nodocker` 给已有本地 Postgres 的人。

**验收清单**：

1. 全新 `git clone` → 填 2 个 key → `pnpm setup && pnpm dev` → `localhost:3000` 登录 → 海报 agent 出一张图，全程无手工步骤；
2. `pnpm eval --smoke` 6 例跑完，`report.md` 出 L1–L4 分项与失败分类；
3. 杀掉 creation 进程：web 返回 503 + 明确文案，不白屏、不无限转圈；
4. 流中停止：无残留冻结积分（`reconcileFrozen` 可证明）；
5. `docker compose down && pnpm dev` 冷启动可用。

## 9. 实施阶段（先造尺子，再动手术）

| 阶段 | 内容 | 理由 |
| --- | --- | --- |
| P0 | **在现有 monolith 上建评测闭环**（cases + L1/L2 judge + report） | 没有基线就搬家，等于事后无法判断变好还是变坏 |
| P1 | 抽 `apps/creation` + `packages/contracts` + web 管道转发；**渲染先沿用 satori** | 只验证「搬家没坏」，不与渲染变更混在一起 |
| P2 | 换 Playwright（完整思源黑体），删 satori 与 `assert-layout-support.ts`，删 prompt 的能力缺失清单 | 有 P0 基线才能证明浏览器更强 |
| P3 | 错误分类 + 重试 + `maxTurns` + 双并发池 + 可观测性 | 失败已分类统计，可验证重试是否真的降异常率 |
| P4 | 重写 prompt 与版式规范，用 L4 驱动调优 | 调审美放最后，且每步可量化 |

P1 与 P2 必须分开：混在一起时无法区分「搬家搬坏了」与「渲染器换错了」。

## 10. 文档同步（同一变更内完成）

- `README.md:79-81`：删除「无浏览器渲染，无需 Chromium」与 Vercel 段落，改为本地运行说明。
- `docs/ARCHITECTURE.md` §8：satori 段落整段替换为 Playwright + 完整字体说明；§3/§4 的 agent 与任务链路改指 `apps/creation`。
- `docs/DEPLOYMENT.md`：整体重写为「本地运行 + 容器」，删除 Vercel 相关契约。
- `AGENTS.md`：部署段落、项目结构、命令表同步。
- `IMPROVEMENT.md`：关闭「请求 ID 日志」「渲染沙箱网络白名单」两项待办（本设计已覆盖）。

## 11. 风险

| 风险 | 缓解 |
| --- | --- |
| 迁移期双写 `messages` | 按阶段切换，两个写者不同时上线；P1 一次性切换写入权 |
| Chromium 内存/进程泄漏 | 渲染池固定并发 2 + context 复用 + 渲染后 close；`/health` 暴露可用性 |
| VLM judge 抖动导致误报 | L4 不进闸门，只报趋势；L1–L3 全为确定性判定 |
| 完整字体增大镜像 | 字体放对象存储/构建期下载，不塞进 git；体积对本地运行无影响 |
| 边界过度设计（两个服务却只有一个消费方） | 服务形态保持最薄：同仓库、一条命令起、无独立 CI；边界是真的，运维是零的 |

## 12. P1 实施记录（2026-10-25）

已落地的部分与设计有四处**刻意偏差**，原因记录在此，避免下次重新争论：

1. **HTTP 框架用原生 `node:http`**，未引入 hono/fastify。三个端点 + SSE，框架带来的是依赖与
   抽象成本；原生 `writeHead`/`write` 对「原样 pipe」这条链路更透明。路由表在
   `apps/creation/src/http/server.ts`，鉴权只认 `x-internal-token`。
2. **新增 `packages/storage`**（S3 客户端）。设计与 §3 只列了 contracts，但存储同时被 web
   （`/files`、上传、资产删除）与 creation（任务产物、render 内联、vision 取字节）消费，
   复制一份会分叉。按「两个消费方才抽包」的原则抽取，web 侧的 `serve.ts`/`upload.ts` 留在原地。
3. **`buildReferenceBlock` 落在 `@oops/domain/messages/reference.ts`**，不是各写一份。web 用它
   写 user 行 transcript，creation 用它拼 prompt 输入；两侧必须逐字一致。
4. **入口初筛（`screenInput`）留在 web**：命中必须在 user 行落库**之前**拒绝，creation 拿不到
   这个时机。它不是创作域逻辑，是 BFF 的输入闸门。

其它落地细节：

- 事件契约 `@oops/contracts/events`：`v: 1` 由 `encodeSseFrame` 在出线处附加，emit 点不手写；
  SSE 帧格式与拆分前逐字节一致（仅多一个 `v` 字段），前端零改动。
- Agent 元数据新增 `vision: boolean`：web 需要它决定 user 行 transcript 是否带图片块。
  查询失败（creation 不可达）时退化为纯文本口径，不阻断回合。
- `transcript` 的 LLM 视图（`sanitizeTranscript` / `buildReplayHistory`）搬到 `@oops/llm/transcript`：
  web 写 user 行、creation 写 assistant 行，共用一份实现；UI 视图重建留在 web。
- 渲染仍是 satori（P2 才换 Playwright）；`assets/fonts` 随代码迁到 `apps/creation/assets/fonts`，
  字体目录改为**模块相对定位**（原先按 cwd，只在 web 的启动方式下成立）。
- 启动对账（`recoverInterruptedTasks` + `reconcileFrozen`）从 web 的 `instrumentation.ts`
  搬到 creation 入口；web 的 `instrumentation.ts` 只保留通知保留期清理。
- web `/api/chat` 在建连失败（creation 不可达或非 2xx）时回滚刚写的 user 行，且**仅当会话内
  没有任何 assistant 行**；客户端已断开时不做回滚（creation 可能已开跑）。
- 根 `pnpm dev` = `pnpm -r --parallel` 起 web/admin/creation；`pnpm dev:web` / `dev:creation` 可单起。
