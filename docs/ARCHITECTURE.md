# doops 架构与技术栈

> 面向电商客户的文生图 Web 系统：用户在聊天框中描述需求并上传商品素材，选择设计 Agent，产出商品详情长图、海报、氛围图等电商图片。

## 1. 总体架构

一体化 Next.js 全栈应用（无独立后端），Route Handlers 承载 SSE 流与上传接口。

```
浏览器 (shadcn/ui + AI Elements 聊天界面)
   │  SSE 流式消息 / 工具调用状态
   ▼
Route Handler /api/chat  ──桥接──►  pi-agent-core 运行时
                                      │  agentLoop + 声明式 Agent（提示词 + 工具子集）
                                      ├── tool: generate_image ──► 火山 Seedream / 通义万相
                                      ├── tool: render_html ──► Playwright 截图服务
                                      └── tool: save_asset ──► 图片存储
   │
   ▼
Drizzle ORM (SQLite)  +  存储抽象（本地磁盘，兼容 OSS/S3）
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
| 包管理 | pnpm 11 | |
| 数据库 | SQLite + Drizzle ORM | MVP 零运维；`drizzle-kit` 管理 migrations |
| 图片渲染 | `playwright-core` + Chromium | HTML 沙箱渲染 → 截图，进程内限并发 |
| 图片存储 | 本地磁盘（`data/assets/`）→ 存储抽象 | 接口兼容 OSS/S3/R2 |
| 认证 | 口令/邀请码 + cookie session | 自实现（HttpOnly/Secure/SameSite），不引入 next-auth |
| 测试 | Vitest | 服务层单测 + 路由 mock 测试 |
| 代码规范 | ESLint（`no-restricted-imports` 强制分层边界）+ tsc | |

## 3. Agent 层：声明式注册

**两张注册表解耦：ToolRegistry + AgentRegistry。**

- **ToolRegistry**：工具实现一次、集中注册（`generate_image`、`render_html`、`save_asset`），Agent 配置按名字引用。
- **AgentRegistry**：启动时扫描 `src/server/agent/agents/` 自动加载，并导出轻量元数据（id/name/description/icon/greeting）给前端 `/api/agents`。

新增 Agent = 新增一个文件：

```ts
// src/server/agent/agents/poster-designer.ts
export default defineAgent({
  id: 'poster-designer',
  name: '海报设计师',
  description: '电商促销海报、大促主视觉',
  icon: 'palette',
  systemPrompt: loadPrompt('poster-designer'),   // prompts/poster-designer.md
  tools: ['render_html', 'generate_image', 'save_asset'],
  defaults: { imageSize: '1080x1440', llm: 'doubao-seed-1.6' },
  greeting: '告诉我活动主题、利益点和尺寸，我来出海报。',
})
```

- system prompt 外置到 `src/server/agent/prompts/*.md`，独立调优。
- 切换 Agent = 换 systemPrompt + tools 子集重新进入 `agentLoop`，无子 Agent 黑盒编排（符合 Pi 反黑盒理念）。
- 前端 Agent 选择器消费元数据列表，新增 Agent 前端零改动。

## 4. 图片生成：异步任务执行模型

**Service 层：所有生图/截图都是任务。**

```
generateImage({ prompt, size, provider })
  → 写 tasks 表 (pending)
  → 进程内 executor（单例，并发 2~3，超时/重试）
  → 调生图 API（Seedream/万相为提交+轮询的异步任务协议，封装在 service 内）
  → 完成 → assets 表落库，task 流转 pending → running → done/failed
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
④ 工具执行：generate_image（出背景图）→ render_html（HTML+素材 → 截图）→ 返回 asset
⑤ agent 拿到工具结果继续推理 → 输出总结 → finish
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

## 7. 数据模型（Drizzle + SQLite）

所有表带 `userId` 列（多租户演进预留，MVP 恒为 owner）。

```
sessions   会话        id, userId, agentId, title, createdAt, updatedAt
messages   消息        id, sessionId, role, parts(JSON)①, createdAt
assets     素材/作品   id, sessionId?, kind(upload|generated), storagePath,
                       mimeType, width, height, meta(JSON), createdAt
tasks      生成任务    id, type(image_gen|html_render), status, payload(JSON),
                       resultAssetId, error, createdAt
```

① `parts` 直接存 AI Elements 兼容的 UIMessage 结构（text / tool-* / image），会话重建零转换。

## 8. 项目目录

```
doops/
├── src/
│   ├── app/                        # 薄壳路由层（页面 + route.ts）
│   │   ├── page.tsx                # 新会话
│   │   ├── chat/[id]/page.tsx
│   │   ├── gallery/page.tsx        # 作品库
│   │   ├── login/page.tsx
│   │   └── api/
│   │       ├── chat/route.ts           # SSE agent 流
│   │       ├── agents/route.ts         # agent 元数据
│   │       ├── upload/route.ts
│   │       └── files/[...path]/route.ts
│   ├── server/                     # 服务端专属（ESLint 禁止客户端 import）
│   │   ├── agent/
│   │   │   ├── registry.ts         # Agent 扫描加载
│   │   │   ├── runtime.ts          # agentLoop ↔ SSE 桥接 + 持久化
│   │   │   ├── agents/             # 声明式 Agent 定义（一文件一 Agent）
│   │   │   ├── prompts/            # system prompt（md）
│   │   │   └── tools/              # ToolRegistry + 工具实现
│   │   ├── services/
│   │   │   ├── image-generation.ts # 生图 Provider 封装
│   │   │   ├── render.ts           # Playwright HTML 截图
│   │   │   ├── task-executor.ts    # 进程内 Worker
│   │   │   ├── asset.ts            # 存储抽象
│   │   │   └── session.ts
│   │   └── db/                     # Drizzle schema + migrations
│   ├── components/                 # chat/ agent-picker/ gallery/
│   ├── lib/                        # 共享 utils、config
│   └── types/                      # 共享类型
└── data/                           # sqlite 文件 + 本地图片（gitignore）
```

**分层边界**：`src/app` 只做路由薄壳；`src/server` 服务端专属，禁止被客户端代码 import（ESLint `no-restricted-imports` 强制）；`src/lib` 与 `src/types` 前后端共享。

## 9. 演进路径（超出 MVP 范围，按需启动）

- **多租户 SaaS**：userId 已预留，补注册/登录、配额/积分、团队隔离。
- **多实例部署**：task executor 换 BullMQ + Redis；本地存储切 OSS/S3（存储抽象已兼容）。
- **Agent 市场**：AgentRegistry 已是配置驱动，可平移到 DB 存储开放自定义。
- **局部重绘/抠图**：作为新工具加入 ToolRegistry，Agent 按需引用。
