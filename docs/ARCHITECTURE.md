# oops 架构与技术栈

> 面向电商客户的文生图 Web 系统：用户在聊天框中描述需求并上传商品素材，选择设计 Agent，产出商品详情长图、海报、氛围图等电商图片。

## 1. 总体架构

一体化 Next.js 全栈应用（无独立后端），Route Handlers 承载 SSE 流与上传接口。

```
浏览器 (shadcn/ui：全屏画布工作台 + 左侧悬浮聊天面板；生图以缩略图上屏)
   │  SSE 流式消息 / 工具调用状态
   ▼
Route Handler /api/chat  ──桥接──►  pi-agent-core 运行时
                                      │  agentLoop + 声明式 Agent（提示词 + 工具子集）
                                      ├── tool: generate_image ──► 火山 Seedream / 通义万相
                                      ├── tool: render_html ──► Playwright 截图服务
                                      └── tool: save_asset ──► 图片存储
   │
   ▼
Drizzle ORM (PostgreSQL)  +  存储抽象（MinIO / S3 兼容，Docker Compose 部署）
```

核心决策（已确认）：

| 决策点 | 结论 |
| --- | --- |
| 生图路径 | **混合模式**：海报/详情长图 = agent 生成 HTML → 服务端截图；氛围/场景图 = 纯文生图 API |
| 产品形态 | MVP 单租户（口令/邀请码登录），schema 预留 userId 演进多租户 |
| LLM 接入 | 复用 pi 生态 `pi-ai` 多 Provider 统一协议，配置化切换 |
| Agent 扩展 | 声明式配置文件（prompt + tools），新增 Agent 零代码改动 |
| 任务执行 | 进程内 Worker + DB 任务表，限并发；未来可平滑换 BullMQ/Redis |

## 2. 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Next.js 16.3.5 (App Router) | 一体化全栈；`middleware.ts` 已更名为 `proxy.ts` |
| 语言 | TypeScript (strict) | 前后端同构类型 |
| 运行时 | Node.js 22+ / React 19 | |
| UI 组件 | shadcn/ui + **AI Elements** | AI Elements 为 Vercel 官方基于 shadcn/ui 的 AI 组件库（Conversation/Message/PromptInput/Tool/Attachments），原生理解消息分片、流式状态、工具调用 |
| 样式 | Tailwind CSS v4 | |
| Agent 运行时 | `@earendil-works/pi-agent-core` | agentLoop / Agent / AgentHarness 分层，事件流驱动，工具调用与状态管理 |
| LLM 协议 | `pi-ai` | 多 Provider 统一请求/响应协议，屏蔽底层模型差异 |
| 包管理 | pnpm 10 | |
| 数据库 | PostgreSQL + Drizzle ORM | Docker Compose 部署；`drizzle-kit` 管理 migrations（pg 方言） |
| 图像生成 Provider | DashScope 万相 `wan2.7-image`（经 pi-ai `createImagesProvider` 自定义接入，Token Plan China 同步端点，返回 base64） | 文本侧 LLM 走 `qwen-token-plan-cn`，共用 key `QWEN_TOKEN_PLAN_CN_API_KEY` |
| 图片渲染 | `playwright-core` + Chromium | HTML 沙箱渲染 → 截图，进程内限并发（`render_html` 工具延后） |
| 图片存储 | MinIO（S3 兼容）→ 存储抽象 | 本地开发走 Docker Compose；接口兼容 OSS/S3/R2 |
| 认证 | 口令/邀请码 + cookie session（**foundation 阶段延后**，当前以固定 OWNER_ID 作为唯一用户） | 自实现（HttpOnly/Secure/SameSite），不引入 next-auth |
| 测试 | Vitest | 服务层单测 + 路由 mock 测试 |
| 代码规范 | ESLint（`no-restricted-imports` 强制分层边界）+ tsc | |

## 3. Agent 层：声明式注册

**两张注册表解耦：ToolRegistry + AgentRegistry。**

- **ToolRegistry**：工具实现一次、集中注册，Agent 配置按名字引用（越权工具被拦截）。MVP 已落地工具：`generate_image`（生成→下载→落 MinIO→assets 的原子语义）；`render_html`/`save_asset` 属刻意延后项。
- **AgentRegistry**：启动时扫描 `src/server/agent/agents/` 自动加载，并导出轻量元数据（id/name/description/tools，不含 systemPrompt）给前端 `GET /api/agents`。

新增 Agent = 新增一个文件：

```ts
// src/server/agent/agents/atmosphere-designer.ts
export const atmosphereDesigner = defineAgent({
  id: "atmosphere-designer",
  name: "氛围图设计师",
  description: "专注氛围/场景图与产品图的文生图助手",
  tools: ["generate_image"],     // 按名引用已注册工具（越权工具被拦截）
  systemPrompt,                 // 外置到 prompts/atmosphere-designer.md
});
```

> 注：v1 的 Agent 定义为 `{ id, name, description, tools, systemPrompt }`；`icon` / `greeting` / `defaults` 属规划中的元数据扩展（前端选择器当前仅消费 id/name/description/tools），以代码为准。

- system prompt 外置到 `src/server/agent/prompts/*.md`，独立调优。
- 切换 Agent = 换 systemPrompt + tools 子集重新进入 `agentLoop`，无子 Agent 黑盒编排（符合 Pi 反黑盒理念）。
- 前端 Agent 选择器消费元数据列表，新增 Agent 前端零改动。

## 4. 图片生成：异步任务执行模型

**Service 层：所有生图/截图都是任务。**

```
generate_image({ prompt, size, aspectRatio })
  → 写 tasks 表 (pending)
  → 进程内 executor（单例，并发 2，单任务超时 90s；重启后 running 标记 failed）
  → 调 DashScope Token Plan 万相 wan2.7-image（POST multimodal-generation，同步返回 base64）
  → provider 内把返回图下载/转 base64 → 写入 MinIO → assets 表落库
  → task 流转 pending → running → succeeded/failed
```

- Playwright 截图同样任务化（CPU/内存密集，并发限 1~2）。
- 进程重启后 pending 任务标记失败（MVP 不做恢复队列）。
- 未来多实例：executor 替换为 BullMQ + Redis，Service 接口不变。

**Agent 工具层两种语义：**

| 工具 | 语义 | 场景 |
| --- | --- | --- |
| `generate_image` | 同步等待结果返回 agent | 组合工作流：先生成背景图，agent 拿 URL 再写 HTML 海报 |
| `schedule_batch`（后续） | 提交即返回 taskId | 批量出图/重生成，无需 agent 继续推理 |

SSE 上同步等待表现为 tool call 的 loading 状态（AI Elements Tool 组件），10~30s 可接受。

## 5. 端到端流程（用户发送一条消息）

```
① 前端：PromptInput 提交消息+附件 → POST /api/chat { sessionId, agentId, ... } → SSE 连接
② Route Handler：鉴权 → 用户消息落库 → AgentRegistry 取配置 → 加载历史 → agentLoop
③ agentLoop：LLM 流式推理 → 事件桥接 SSE（text-delta / tool-start / tool-result / finish），边推边落库
④ 工具执行：generate_image（出图 → 下载转 base64 → 落 MinIO → assets 落库）返回自有 `/files` URL
⑤ agent 拿到图片 URL 继续推理 → 输出总结 → finish
⑥ 收尾：assistant 消息（含 tool parts）落库，图片入 assets → 作品库可见
```

要点：

- **事件即持久化**：每个 SSE 事件边推边存，刷新页面从 DB 重建完整会话，无需重放 agent。
- **失败回喂**：工具失败返回结构化错误给 agent，由 agent 用自然语言解释并建议重试，会话不崩。

## 6. 不可控输入的分流

不引入独立意图分类器——**LLM 本身就是意图路由器**，三层分工：

```
① 入口检查（代码级）：长度限制/敏感词初筛 → 命中直接拒绝，不进 LLM
② agentLoop 推理（prompt 级行为准则）：
   A 生图/设计任务 → 信息缺失先追问澄清 → 足够后调工具出图
   B 咨询/闲聊 → 纯文字回答，不调工具
   C 超出能力 → 说明边界，引导到合适 agent/任务
③ 兜底（代码级）：
   未注册工具 → 注册表拦截，错误回喂 agent 自行纠正
   工具失败/API 审核拒绝 → 结构化错误回喂 → agent 转述 + 给替代方案
```

原则：代码不做语义判断，prompt 不做安全兜底；追问优先于猜测（省生图 API 费用）。

## 7. 数据模型（Drizzle + PostgreSQL）

> 以下为 **foundation 阶段**已落库的 MVP 表（已 `pnpm db:migrate` 应用）。所有表带
> `userId` 列（多租户演进预留，当前恒为 `OWNER_ID`）；时间列 `timestamp with time zone`；
> `meta`/`payload`/`result`/`tool_calls` 用 `jsonb`；`role`/`kind`/`type`/`status` 用 `pgEnum`。

```
chat_sessions  会话      id(uuid), user_id(text), title(text?), created_at, updated_at
messages       消息      id(uuid), session_id(uuid→sessions FK), user_id, role(enum),
                        content(text), tool_calls(jsonb?), created_at
assets         素材/作品 id(uuid), user_id, session_id?(→sessions, set null),
                        kind(enum image|json|other), storage_key(text), mime_type(text),
                        width(int?), height(int?), prompt(text?), model(text?),
                        source_url(text?), meta(jsonb, 默认 {}), created_at
tasks          生成任务  id(uuid), user_id, session_id?(→sessions), type(enum),
                        status(enum), payload(jsonb, 默认 {}), result(jsonb?),
                        error(text?), created_at, updated_at
```

枚举取值：

- `message_role`：`user` / `assistant` / `system`
- `asset_kind`：`image` / `json` / `other` / `edited`
- `task_type`：`generate_image` / `render_html` / `export`
- `task_status`：`pending` / `running` / `succeeded` / `failed` / `canceled`

> 注：`chat-image-gen` 已落地：① `chat_sessions` 新增 `agent_id` 列（迁移 `0001`）；
> ② 消息持久化采用 MVP 实际 schema（`content` 文本 + `tool_calls` jsonb），由
> `src/server/agent/transcript.ts` 确定性重建为可直接渲染的 UIMessage parts（零转换，前端不需字段映射）；
> ③ `assets` 记录生成来源（`prompt`/`model`/`meta` 含 provider/size/taskId）。
> `canvas-editing` 新增 `asset_kind=edited` 派生图：由画布导出得到，与原始生成图（`image`）区分，
> `meta` 记录 `sourceAssetId` 与编辑摘要（`crop`/`filters`），原始资产字节不被改动。
> `assets.resultAssetId` 等扩展属后续按需演进。

Schema 方言（pg）：`JSON` → `jsonb`；枚举列用 `pgEnum`；时间列用 `timestamp with time zone`。

## 8. 项目目录

> 以下为当前实际存在的文件；标注「（后续 change）」的为尚未落地项。

```
oops/
├── src/
│   ├── app/                        # 薄壳路由层（页面 + route.ts）
│   │   ├── page.tsx                # 默认首页
│   │   ├── files/[...path]/route.ts # 资产代理读取（安全响应头）
│   │   ├── upload/route.ts
│   │   ├── chat/page.tsx           # 画布工作台页（全屏画布 + 悬浮聊天面板，自定义 SSE）
│   │   └── api/
│   │       ├── agents/route.ts     # GET 已注册 Agent 元数据
│   │       ├── sessions/route.ts   # 会话 CRUD
│   │       ├── sessions/[id]/route.ts # GET 会话历史（UIMessage 重建）
│   │       └── chat/route.ts       # POST SSE 聊天（敏感词初筛 + 落库 + 流式）         # 图片上传（MIME 白名单 + 大小上限）
│   ├── server/                     # 服务端专属（ESLint 禁止客户端 import）
│   │   ├── db/                     # Drizzle client + schema + 仓储
│   │   │   ├── schema.ts           # 四表 + 枚举定义
│   │   │   ├── index.ts            # pg Pool 单例（惰性）
│   │   │   ├── session.repo.ts     # 会话 仓储（接口 + 实现）
│   │   │   ├── message.repo.ts     # 消息 仓储
│   │   │   ├── asset.repo.ts       # 资产 仓储
│   │   │   ├── task.repo.ts        # 任务 仓储
│   │   │   └── mock-db.ts          # 仓储单测用的 drizzle 查询 mock
│   │   ├── infra/
│   │       ├── storage/            # 存储抽象（MinIO / S3 兼容）
│   │           ├── s3.ts           # S3Client 封装 + key 生成
│   │           ├── serve.ts        # 资产响应构建（内联 vs 强制下载）
│   │           ├── upload.ts
│   │   │   └── providers/          # 外部 Provider 接入
│   │   │       ├── llm.ts          # qwen-token-plan-cn 文本模型装配
│   │   │       └── dashscope-images.ts # 万相 wan2.7-image 自定义 images provider
│   │   ├── domain/
│   │   │   └── tasks/task-executor.ts # 进程内任务执行器（并发 2 / 超时 90s / 重启清理）
│   │   └── agent/                  # 声明式 Agent 运行时
│   │       ├── registry.ts / runtime.ts / types.ts / transcript.ts / moderation.ts
│   │       ├── agents/             # 各 Agent 定义 + prompts/<id>.md
│   │       └── tools/              # ToolRegistry + 工具实现（generate-image 等）       # 上传校验 + 处理
│   ├── components/                 # shadcn/ui + AI Elements（仅 UI，无业务逻辑）
│   ├── lib/                        # 客户端安全共享：config / utils（+ 单测）
│   └── (types/ 规划)               # 共享类型，后续 change 引入
├── docker-compose.yaml             # postgres:16 + minio + minio-init（自动建桶）
├── drizzle.config.ts               # drizzle-kit 配置（加载 .env.local）
├── drizzle/                        # 生成的迁移 SQL（已提交）
├── vitest.config.ts / vitest.setup.ts
└── .env.example                    # 环境变量模板（.env* 均 gitignored）
```

**分层边界**：`src/app` 只做路由薄壳；`src/server` 服务端专属，禁止被客户端代码 import
（ESLint `no-restricted-imports` 强制，覆盖 `src/components`、`src/hooks`）；`src/lib` 前后端共享且不含服务端实现。
`src/server/db` 为领域仓储层（纯 Drizzle，不依赖具体 Provider / 框架），`src/server/infra/storage` 为基础设施实现。

> 后续 change 才落地（尚未实现）：`src/server/infra/render/`（HTML→Playwright 截图，对应 `render_html` 工具）；
> 领域聚合/任务状态机等按需演进（`task-executor` 已落地）。
> 图片浏览/编辑已在 `chat/page.tsx` 的**画布工作台**承载（缩略图上屏 + 裁剪/滤镜/导出），不再单独规划 `gallery` 作品库页。

## 9. 演进路径（超出 MVP 范围，按需启动）

- **多租户 SaaS**：userId 已预留，补注册/登录、配额/积分、团队隔离。
- **多实例部署**：存储已为 MinIO（S3 兼容）、DB 为 Postgres（无状态），应用可水平扩展；task executor 换 BullMQ + Redis 即可去单例限制（存储 / DB 不再是扩展瓶颈）。
- **Agent 市场**：AgentRegistry 已是配置驱动，可平移到 DB 存储开放自定义。
- **局部重绘/抠图**：作为新工具加入 ToolRegistry，Agent 按需引用。
