# oops 架构与技术栈

> 面向电商客户的文生图 Web 系统：用户在聊天框中描述需求并上传商品素材，选择设计 Agent，产出商品详情长图、海报、氛围图等电商图片。

> 仓库形态：pnpm workspace monorepo——web 应用位于 `apps/web/`（包 `@oops/web`），
> `messages/`、`public/`、`drizzle/`、`.env.example`、`drizzle.config.ts`、`vitest.*` 均在其下；
> 仓库根仅保留编排壳（`package.json` 脚本经 `pnpm --filter`/`-r` 转发、`pnpm-workspace.yaml`、
> 单一 `pnpm-lock.yaml`）。除标注仓库根前缀外，本文的 `src/**` 等应用内路径均相对 `apps/web/`。

## 1. 总体架构

一体化 Next.js 全栈应用（无独立后端），Route Handlers 承载 SSE 流与上传接口。

```
浏览器 (shadcn/ui：/home 落地页 + /canvas AI 画布页——点阵画布全屏 + 左上悬浮聊天面板；明暗双主题)
   │  SSE 流式消息 / 工具调用状态
   ▼
Route Handler /api/chat  ──桥接──►  pi-agent-core 运行时
                                      │  agentLoop + 声明式 Agent（提示词 + 工具子集）
                                      ├── tool: generate_image ──► 火山 Seedream / 通义万相
                                      ├── tool: render_html ──► 无浏览器渲染（satori + resvg）
                                      └── tool: save_asset ──► 图片存储
   │
   ▼
Drizzle ORM (PostgreSQL)  +  存储抽象（S3 兼容：本地 MinIO / 云上 Supabase·OSS·COS，env 切换）
```

核心决策（已确认）：

| 决策点 | 结论 |
| --- | --- |
| 生图路径 | **混合模式**：海报/详情长图 = agent 生成 HTML → 服务端截图；氛围/场景图 = 纯文生图 API |
| 产品形态 | MVP 多用户单部署（邀请码注册 + 用户名/密码登录），全表实装 `user_id` 隔离数据 |
| LLM 接入 | 复用 pi 生态 `pi-ai` 多 Provider 统一协议，配置化切换 |
| Agent 扩展 | 声明式配置文件（prompt + tools），新增 Agent 零代码改动 |
| 任务执行 | 进程内 Worker + DB 任务表，限并发；未来可平滑换 BullMQ/Redis |
| 前端骨架 | 三页结构：`/home` 轻量落地页（两级侧栏 + 创作输入/Agent 卡片入口 + 排版设计尺寸弹窗）+ `/canvas` 全屏 AI 画布页（无应用侧栏，聊天面板悬浮可收起）+ `/design` 设计工作台页（模板/素材/文字轻量编辑）；`/chat` 保留重定向；会话管理收敛到聊天面板头部时钟下拉 |
| 主题 | 手写 ThemeProvider（零依赖）：html `dark` class 切换 + localStorage（`oops-theme`）持久化 + layout 首屏阻塞脚本防闪烁；明暗两套 CSS token |
| i18n | next-intl cookie 模式（无 URL 路由）：zh/en 双语；层 A UI 文案进词典，层 B LLM 文本由 agent 语言跟随；防回流 = typed messages + lint 禁裸中文 + zh↔en 键对齐单测 |

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
| 图片渲染 | `satori` + `satori-html` + `@resvg/resvg-js` | 无浏览器渲染：HTML → VDOM → SVG → PNG（`src/server/infra/render/`），子集字体内置，与生图共用执行器闸门 |
| 图片存储 | S3 兼容存储抽象（`@aws-sdk/client-s3`） | 后端由 `S3_*` env 决定（代码零 provider 分支）：本地 MinIO（Docker Compose）/ 云上 Supabase、OSS、COS |
| 认证 | 用户名/密码（`crypto.scrypt`）+ 邀请码注册 + HMAC-SHA256 签名 cookie session（web 30 天 / 管理端 12 小时） | 自实现（HttpOnly/Secure/SameSite=Lax），不引入 next-auth；`AUTH_SECRET` 必填 ≥32 字符；载荷含会话版本 `tv`，与 `users.token_version` 不符即 401（改密 +1 并下发新 cookie，其他端下线）。管理端是另一套会话：`oops_admin_session` 不同名 + `ADMIN_AUTH_SECRET`（缺省回退 `AUTH_SECRET`），两侧互不相认 |
| i18n | next-intl（无 URL 路由的 cookie 模式） | `messages/zh.json`（基准）+ `en.json`（键结构镜像，对齐单测强制）；typed messages 编译期 key 校验；locale 解析链在 `src/i18n/request.ts` |
| 测试 | Vitest | 服务层单测 + 路由 mock 测试 |
| 代码规范 | ESLint（`no-restricted-imports` 强制分层边界）+ tsc | |

图片存储后端对照（全部经 `S3_*` 环境变量切换；易错点详见 `.env.example` 注释）：

| 后端 | S3_ENDPOINT | S3_REGION | S3_FORCE_PATH_STYLE | 备注 |
| --- | --- | --- | --- | --- |
| MinIO（本地 dev） | `http://localhost:9000` | 任意（如 `us-east-1`） | `true` | Docker Compose 自带并自动建桶 |
| Supabase | `https://<ref>.supabase.co/storage/v1/s3` | 项目真实 region | `true` | Dashboard 生成 S3 access key |
| 阿里云 OSS | `https://oss-cn-hangzhou.aliyuncs.com` | `cn-hangzhou`（**不带 `oss-` 前缀**） | `false` | 签名 region 与 endpoint 前缀解耦 |
| 腾讯云 COS | `https://cos.ap-guangzhou.myqcloud.com` | `ap-guangzhou` | `false` | bucket 名必须带 `-<appid>` 后缀 |

## 3. Agent 层：声明式注册

**两张注册表解耦：ToolRegistry + AgentRegistry。**

- **ToolRegistry**：工具实现一次、集中注册，Agent 配置按名字引用（越权工具被拦截）。MVP 已落地工具：`generate_image`（生成→下载→落对象存储→assets 的原子语义）；`render_html`（HTML→无浏览器渲染→assets，海报链路）；`save_asset` 属刻意延后项。
- **AgentRegistry**：启动时扫描 `src/server/agent/definitions/` 自动加载，并导出轻量元数据（id/name/description/icon/tools，不含 systemPrompt）给前端 `GET /api/agents`。

新增 Agent = 新增一个文件：

```ts
// src/server/agent/definitions/atmosphere-designer.ts
export const atmosphereDesigner = defineAgent({
  id: "atmosphere-designer",
  name: "氛围图设计师",
  description: "专注氛围/场景图与产品图的文生图助手",
  tools: ["generate_image"],     // 按名引用已注册工具（越权工具被拦截）
  systemPrompt,                 // 外置到 prompts/atmosphere-designer.md
});
```

> 注：Agent 定义为 `{ id, name, description, icon, tools, systemPrompt }`（icon 为前端头像徽标 emoji）；`greeting` / `defaults` 已从契约中移除（从未有消费方），以代码为准。

- system prompt 外置到 `src/server/agent/definitions/prompts/*.md`，独立调优（compact 摘要骨架 `session-summary.md` 同目录）。
- 切换 Agent = 换 systemPrompt + tools 子集重新进入 `agentLoop`，无子 Agent 黑盒编排（符合 Pi 反黑盒理念）。
- 前端 Agent 选择器消费元数据列表，新增 Agent 前端零改动。已有会话切换 Agent = composer 内 PATCH 重绑（持久化到 `chat_sessions.agent_id`，下一轮生效）；MVP 内置两个 Agent：氛围图设计师、产品摄影师。

## 4. 图片生成：异步任务执行模型

**Service 层：所有生图/截图都是任务。**

```
generate_image({ prompt, size, aspectRatio })
  → 生成闸门预检（/api/chat：余额 ≤ 0 → 402 整面板拒绝）
  → 事务内写 tasks 表 (pending) + 积分冻结（按 credit_prices 定价扣减余额 + frozen 流水）
  → 进程内 executor（单例，并发 2，单任务超时 90s；重启后 pending/running 标记 failed）
  → 调 DashScope Token Plan 万相 wan2.7-image（POST multimodal-generation，同步返回 base64）
  → provider 内把返回图下载/转 base64 → 写入对象存储 → assets 表落库
  → task 流转 pending → running → succeeded/failed
  → 终态结算：succeeded → settle（退差多退少补，frozen 条目转 settled）
              failed/canceled/重启清理 → release（全额返还，条目转 released）
```

- 无浏览器渲染（satori + resvg）同样任务化。实测单张 750×1334 约 23ms，纯 CPU 计算、
  无进程复用；resvg 的 native 调用为同步阻塞，并发过高会打满事件循环，与生图共用闸门。
- 进程重启后 pending/running 任务标记失败，启动对账（`reconcileFrozen`）释放任务已
  终态/不存在的残余冻结条目（崩溃窗口兜底）。
- 未来多实例：executor 替换为 BullMQ + Redis，Service 接口不变（冻结/结算语义不变）。

**Agent 工具层两种语义：**

| 工具 | 语义 | 场景 |
| --- | --- | --- |
| `generate_image` | 同步等待结果返回 agent；可选 `referenceAssetId`（画布引用的源图，zod + 归属校验，失败结构化回喂；通过校验后写入任务 payload 与 `assets.meta.referenceAssetId` 血缘） | 组合工作流：先生成**背景/氛围**底图，agent 拿 URL 再写 HTML 海报。**禁止用于生成商品本身**——文生图无法还原真实商品，海报 Agent 的商品形象只能来自用户上传的商品图 |
| `render_html` | agent 产出完整自包含海报 HTML（宽 750 固定 + 高度档位枚举，HTML ≤200KB）→ 无浏览器渲染落 assets；结果以 `ImageContent` 回喂 agent（后续轮可看见自己的产出），血缘经 `referenceAssetId` 透传 | 海报链路核心：版式精确可控、文字准确。前置条件：本轮必须有选中的商品图引用，否则 Agent 不得调用本工具 |
| `schedule_batch`（后续） | 提交即返回 taskId | 批量出图/重生成，无需 agent 继续推理 |

SSE 上同步等待表现为 tool call 的 loading 状态（AI Elements Tool 组件），10~30s 可接受。

## 5. 端到端流程（用户发送一条消息）

```
⓪ 认证：proxy.ts 按 cookie 存在性引导页面（`/` → 已登录 `/home` 否则 `/login`；`/home`、`/canvas` 未登录 → 302 `/login`；旧路径 `/chat` 由页面级 redirect 到 `/canvas`）；
   业务 API 由 `requireUser` 完整验签 + 查 `users` active + 会话版本一致（唯一安全边界），未认证统一 401
① 前端：Composer 提交消息（引用 = 画布选中条目，可移除 chip）→ POST /api/chat { sessionId, agentId, message, referenceAssetIds? } → SSE 连接
② Route Handler：requireUser 取 userId → 引用资产归属校验（存在/userId/sessionId 匹配，≤5）→
   用户消息以"原文 + 引用块"落库（content 与 UI 文本保持原文）→ AgentRegistry 取配置 → 加载历史 → agentLoop
③ agentLoop：LLM 流式推理 → 事件桥接 SSE（text-delta / tool-start / tool-result / finish），边推边落库
④ 工具执行：generate_image（出图 → 下载转 base64 → 落对象存储 → assets 落库，userId 源自工具上下文）返回自有 `/files` URL
⑤ agent 拿到图片 URL 继续推理 → 输出总结 → finish
⑥ 收尾：assistant 消息（含 tool parts）落库，图片入 assets → 画布可见
```

**画布工作台闭环**（`/canvas` 页，画布为多作品平面）：

```
tool_start(generate_image) → 画布插入生成中占位卡（有引用 placeNear 邻近放置，血缘 = 模型传参优先、回退本轮选中引用）
tool_end → 占位卡原位结算：成功换图；失败置失败卡（原因摘要 + 重试按钮，重试以卡内原始意图重新发起一轮）
结果不在当前视口 → 画布顶部居中浮出"有新结果"提示（点击定位选中）；在视口内静默完成，不强制移动视角
SSE 事件按发起会话归档（currentIdRef 守卫），流中切会话不串图；工作区（位置/视角/草稿/引用）300ms 防抖存本机
（键 oops:workspace:v1:<sessionId>），切换会话与刷新后恢复
```

账号入口：聊天面板头部时钟下拉底部用户区 + 首页侧栏底部头像菜单（只读账号摘要 / 个人信息 / 退出登录）→ `/profile`
维护昵称/性别/签名与改密（改密成功后当前端保持登录、其他端全部下线）。

要点：

- **事件即持久化**：每个 SSE 事件边推边存，刷新页面从 DB 重建完整会话，无需重放 agent。
- **失败回喂**：工具失败返回结构化错误给 agent，由 agent 用自然语言解释并建议重试，会话不崩。
- **用户中断生成**：流进行中发送钮变停止钮；点击断开 SSE（AbortController）→ 服务端捕获断连后中断 agent 循环与未结算任务，已生成部分照常落库。前端本轮聊天侧标记"[已停止生成]"（仅本轮 UI 态，不进持久化正文），画布未结算占位卡移除；刷新后以服务端落库的部分内容呈现，历史一致。

### 5.1 会话记忆：双视图持久化与上下文压缩（compact）

**双视图**：`messages` 每行同时存两个视图——UI 视图（`content` + `tool_calls`，渲染零转换）
与 LLM 视图（`transcript` jsonb，pi-ai `Message[]` 序列带 `v:1` 版本标记）。写入时清洗：
assistant 剥 `thinking` 块、图片内容块替换为含 URL/assetId 的文本占位（base64 绝不落库）；
读取时坏行（缺 transcript / 未知版本）整行跳过，不抛错。

**上下文重建**（每回合开始前，`runtime.ts`）：

```
摘要（sessions.summary，覆盖水位线之前轮次）
+ 水位线之后各行的 transcript 原文（排除本轮 user 行，避免与 prompt() 重复）
→ last-40 消息数硬上限（对齐完整轮边界，摘要前缀不占预算）
→ Agent initialState.messages
```

**compact**（`compact.ts`，回合开始前同步执行）：以字符近似估算 token（中文 ~1.5 字/token），
有效上下文（摘要 + 水位线后原文）超 **30k** 触发；压缩范围 = 水位线后的较早行（行边界天然
对齐完整轮），交 LLM 按固定骨架（用户目标 / 已确定设计要求 / 已生成资产清单 / 未完成意图）
生成摘要写入 `sessions.summary`，并单调推进水位线 `sessions.summarized_up_to`（目标压到
~10k 以内）。**原文永不删除**——摘要幂等可重算；compact 失败降级为按现有摘要/水位线回放，
不中断用户回合；摘要被清空时下次 compact 从原文重建。

### 5.2 前端骨架：双页路由、首页跳转协议与主题

**路由结构**：`/home` 落地页（**两级侧栏**：一级项 首页 / 创作 / 图库，二级项 创作›AI 画布·排版设计、
图库›作品集·素材库；一级项是纯展开控件，素材库置灰禁用；主区创作横幅、创作输入与 Agent 卡片）
+ `/canvas` AI 画布页（无应用侧栏，点阵画布全屏为唯一主舞台，聊天面板
左上悬浮可收起、收起后画布左上重开，画布右上悬浮保存徽章与导出）+ `/design` 设计工作台页
（顶栏撤销重做/下载 + 56px 左轨 + 模版/素材/文字面板 + 缩放适配画布；尺寸前置弹窗在 `/home`
触发，携 `?w=&h=` 建页）+
`/chat` 页面级 `redirect("/canvas")` 保存量入口。作品集**不占独立路由**：作为 `/home` 主区的
一个视图（`view: "home" | "portfolio"`），侧栏「作品集」切换主区而非跳转；`/portfolio`
仅保留为 `redirect("/home")` 供旧书签可用。窄屏（md 以下）
聊天与画布互斥切换显示。

**作品集与加工出口**（`/home` 主区作品集视图）：作品集是跨会话聚合视图——**条目即原资产本身**，
由 `assets.saved_at` 打标实现，非副本（见 §7）。三条入口：AI 画布卡片 hover 星标、
排版设计导出面板「同时存入作品集」勾选、首页侧栏 图库›作品集。加工出口一律传
`assetId` 而非图片 URL（`/canvas?assetId=`、`/design?assetId=`），服务端经
`GET /api/assets/:id` 校验归属后才给出 `/files/*` 地址——传URL 会让用户手改参数注入
任意外部图片源。设计侧以新增图层落地（复用 `designReducer` 的 `addElements`，自带
`pushHistory` 故可撤销），不覆盖既有设计稿；资产已删只内联提示，设计稿保持原样。
设计导出勾选入库失败时只警告：浏览器下载已完成，附加动作不得阻断首要意图。

**消息中心**（`/home` 主区视图 + 侧栏底栏铃铛）：同样**不占独立路由**，
`view: "home" | "portfolio" | "messages"`，切主区而非跳转。**铃铛是唯一入口**——导航树里没有
消息中心项（它在两个 L1 分组里都无处安放），故铃铛在该视图下带 `aria-current="page"`，
与作品集/首页的当前位置指示方式统一。取数收敛在一个
hook（`src/lib/notifications/use-notifications.ts`），由 `/home` 持有并注入铃铛与视图，
**只跑一个 60s 轮询**（多标签页不重复请求）：未读计数轮询，列表按来源筛选一次取完；
`document.hidden` 时暂停，切回可见立即补拉一次，轮询失败静默保留上次计数（不为角标打扰用户）。
系统消息按 `category` 与词典键**显式配对**渲染（`credits.low` / `credits.exhausted`
各配 title + body 两键），未登记类别回退消息主体保存的中文原文——不拿 `i18n_key` 直接撞词典，
因为 next-intl v4 没有 `t.has`，未知键只会打一条 onError 再返回键名。
管理端下发（`source=admin`）无 i18n_key，标题正文一律原样展示。

**侧栏形态**（spec home-landing「一级列与二级面板结构」「一级项展开面板并落到默认子项」「二级面板的开合约束」「当前位置的委托标记」、DESIGN.md B7.2）：侧栏从 `/home` 页面内联 JSX 抽为独立组件 `src/components/layout/home-sidebar.tsx`（除面板开合外纯展示，不碰 `view`、不碰路由、不取数）；窄屏抽屉状态与 `Cmd/Ctrl+B` 快捷键收敛在 `src/lib/layout/use-sidebar-layout.ts`（`drawerOpen` / `isNarrow` + `matchMedia`；**无 localStorage** —— rail 是常量，没有折叠态）。形态照抄一处实测参照（Canva 项目页，1440×900，2026-10-19 直接读 DOM）：**二级面板是 rail 的 flex 兄弟节点，占布局宽度把主区挤窄**（1121px → 857px），**不是浮层**；rail 64px、面板 264px、面板行高 40px。
**两级语义**：一级项（首页 / 创作 / 图库）常驻 64px 一级列；二级项只在该组的**并排二级面板**里出现。一级行只有**一个**可激活目标：激活它 = 展开本组面板 + 落到该组 `primaryId` 声明的默认子项（不靠数组顺序推断）；行内**没有展开控件 / chevron / 第二个目标**，故一级行是纯按钮而非链接。**落派只在当前页内执行**：图库 → 切主区为作品集；创作 → 不动（其默认子项是整页路由 `/canvas`，自动跳转会连同刚展开的面板一起被卸载，用户就退不回排版设计）。面板内激活二级项**不**收起面板，重复激活同一一级项也**不**收起。
面板的全局开合在**一级列顶部的线性开关**（参照实测：36×36 按钮，带 `aria-expanded`/`aria-controls`，重新打开时恢复上一次展开的组，与 `Cmd/Ctrl+B` 共用同一个 `togglePanel()`）。
面板状态保留在侧栏内部（不进 `page.tsx`，否则切面板会重渲染主区）、**不落盘**、初值 `null`；收起态 = 宽度 0 + `inert` + `aria-hidden`，**内容不卸载**（否则关闭过渡擦的是一条空条）。
色相只标记当前位置，非当前一级项与全部二级项中性。**两个标识分开**：填色 tile 标记当前所在**分区**（跟随用户激活的那个 L1，与主区视图解耦）；`aria-current="page"` 标记**最深的选中项**，且**恰好一个**（一级列 + 面板内二级项合计）：面板展开时标记面板内的二级项，面板收起（其项已移出可访问性树）时由其一级项代行。点「创作」会让它的 tile 亮起来而主区仍是落地页 —— 若从视图推导高亮，创作就会永远暗着（这正是过去的脏脏）。
产品标识与**构建版本**只在**二级面板顶部**（一级列顶部只剩面板开关），不在用户菜单；主题、语言、设置在用户菜单内。一级列底部仅铃铛 + 头像，**纵向排列**（上铃铛下头像）。
窄屏（<768px）侧栏移出文档流，经浮动菜单按钮以 Radix Dialog 抽屉唤出（`components/ui/sheet.tsx`，无新依赖；焦点陷阱 / `aria-modal` / 滚动锁定交给 Radix）；抽屉内以**分组标题 + 平铺二级项**呈现、无展开控件也无浮层——模态 Dialog 会给兄弟节点加 `aria-hidden`，portaled 浮层会落在焦点陷阱之外，且该分支没有常驻面板可开、一级项也已不再导航。
视觉规范（tile 几何、面板列规则、色相、宽度 token `--spacing-sidebar*`）以 DESIGN.md B7.2 为准。


**首页 → 画布直发协议**：创作输入提交（landing composer）携带 `?draft=<文本>&send=1&t=<提交时间戳>`，
选了 Agent 再带 `?agent=<id>`；待传附件（≤5 张图片）经模块级 handoff store（`src/lib/chat/home-handoff.ts`，
内存暂存）交接。画布页用 `useSearchParams`（路由状态）读取参数——不读 `window.location`（SPA 挂载时其
更新时序滞后）。直发衔接：bootstrap 跳过「选中最近会话」，引导完成后由 `loadSessions` 触发 `newChat`，
新会话 slot 在渲染中落地后由衔接 effect 消费（`runRound` 依赖当次渲染 slots 闭包，不可在 state 提交前同步
调用）——附件并行上传（`allSettled`，任一失败阻断发送、已成功条目仍落画布、草稿回填）后以 assetId 显式
引用自动发送首轮。`t` 为去重 nonce（同文案连发可再次入队）；跳转后刷新会清空内存 store，此时降级为
草稿回填不直发（「刷新丢附件保草稿」）。消费后 `history.replaceState` 清参防刷新重复触发。Agent 卡片
点击仍携带 `?agent=<id>`（空态预选；已有会话时会话绑定 Agent 优先），无会话时草稿挂起等待首个会话；
「本机工作区回贴完成」之后才消费草稿（避免快照旧草稿覆盖首页带来的新草稿）。

**主题**：`components/theme-provider.tsx` 手写 Context（零依赖）——`applyTheme` 切 html
`dark` class，`oops-theme` 存 localStorage；layout 内联阻塞脚本在存储为 dark 时预设 class 防
首屏闪烁，默认亮色。颜色一律走明/暗两套 CSS token（globals.css class-based dark variant），
切换入口在首页侧栏底部与画布悬浮顶栏（AppHeader）。

### 5.3 i18n：locale 解析、词典分层与防回流

**装配**（`src/i18n/`，client-safe）：`request.ts` 解析 locale——cookie `oops-locale`
（用户显式切换）→ Accept-Language（首次访问推断）→ 默认 `zh`，非法值逐级回落；`messages.ts`
装载词典：`zh.json` 为基准（`IntlMessages = typeof zh` 提供编译期 key 校验），en 加载时
deep-merge 到 zh 之上（缺失 key 回落中文而非裸 key）。根 layout 以 `NextIntlClientProvider`
下发词典 + `html lang` 动态化（zh→zh-CN、en→en）；切换器（首页侧栏底部 + 画布聊天面板头部）
写 cookie 后 `router.refresh()` 即时生效。

**文本三层**：

| 层 | 内容 | 策略 |
| --- | --- | --- |
| A 用户可见 UI 文案 | 组件/页面/可访问性文本/metadata | 必须经词典（zh 基准、en 键结构镜像） |
| B LLM 对话文本 | agent 提示词、工具错误、provider 拒绝原文 | 不进词典；prompt 携带「以用户消息语言回复」指令（工具失败/审核拒绝由 agent 同语言转述） |
| C 注释与测试断言 | 代码注释、既有中文断言 | 豁免 |

**服务端错误**：route handler 返回结构化 `{ code, message }`（message 保持中文，服务端不引入
翻译）；客户端按 `code` 渲染词典文案（`common.apiErrors`），未登记 code 以 `message` 兜底。
灵感卡 presets 为词典 key（`chat.presets.<agentId>.<key>`），`GET /api/agents` 按请求 locale
解析为文案（en 以英文撰写示例 prompt，非直译，保文生图质量）。

**防回流三件套**：① typed messages（key 拼错 typecheck 报错）；② ESLint
`no-restricted-syntax` error 级禁裸中文（`src/components/**` 与 `src/app/**` 非 test 文件的
字符串字面量/模板串/JSXText；注释、测试、`route.ts`、`src/server/**` 豁免）；③ zh↔en 键对齐
单测进 `pnpm test` 门槛。

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

> 以下为已落库的 MVP 表（已 `pnpm db:migrate` 应用）。业务四表带 `userId` 列
> （指向 `users.id`，仓储层必传，按用户隔离数据）；时间列 `timestamp with time zone`；
> `meta`/`payload`/`result`/`tool_calls` 用 `jsonb`；`role`/`kind`/`type`/`status` 用 `pgEnum`。

```
users          用户      id(uuid), username(text, lower(username) 唯一索引),
                        oops_id(text, 8 位去易混短 ID, 唯一索引, 注册时生成不可改),
                        password_hash(text, scrypt, 不存明文), display_name(text?),
                        role(user_role enum user|admin, 后台管理权限),
                        gender(user_gender enum, 默认 secret), bio(text?),
                        token_version(int, 改密踢下线水位),
                        status(user_status enum active|disabled), invite_code_id(uuid?→invite_codes),
                        credit_balance(int, 物化余额, == sum(credit_ledger.amount) 不变量),
                        created_at
invite_codes   邀请码    code(text 主键), max_uses(int, 默认 1), used_count(int, 默认 0),
                        expires_at(timestamptz?), note(text?), created_at,
                        revoked_at(timestamptz?, 后台作废水位；非空即注册被拒)
chat_sessions  会话      id(uuid), user_id(text→users.id), agent_id(uuid?), title(text?),
                        summary(text?, compact 摘要), summarized_up_to(uuid?, 摘要水位线),
                        created_at, updated_at
messages       消息      id(uuid), session_id(uuid→sessions FK), user_id, role(enum),
                        content(text), tool_calls(jsonb?), transcript(jsonb?, LLM 视图), created_at
assets         素材/作品 id(uuid), user_id, session_id?(→sessions, set null),
                        kind(enum image|json|other), storage_key(text), mime_type(text),
                        width(int?), height(int?), prompt(text?), model(text?),
                        source_url(text?), meta(jsonb, 默认 {}), created_at
tasks          生成任务  id(uuid), user_id, session_id?(→sessions), type(enum),
                        status(enum), payload(jsonb, 默认 {}), result(jsonb?),
                        error(text?), created_at, updated_at
credit_ledger  积分流水  id(uuid), user_id, type(enum grant|freeze|settle|release|adjust),
                        amount(int, 带符号 = 余额变动; freeze 为负), status(enum?, 仅 freeze 条目),
                        task_id?(→tasks, set null), note(text?), created_at
                        （append-only 账本；不变量 balance == sum(amount)）
credit_prices  任务定价  key(text 主键 generate_image|render_html), credits(int),
                        updated_at（seed：生图 10 / 渲染 5，后台编辑归 M2.3）
admin_audit_log
              管理审计  id(uuid), admin_user_id(text→users.id 逻辑引用, 不设外键——
                        管理员被删后审计仍可读), action(text, 应用层常量),
                        target_type(text), target_id(text?), before(jsonb?),
                        after(jsonb?), note(text?), created_at
                        （append-only；全部 admin 写操作与其业务写入同事务落审计）
app_config    运行配置  key(text 主键), value(jsonb), updated_by(text),
                        updated_at（类型化键空间：`agent.<agentId>.enabled` /
                        `model.<providerId>.<modelId>.enabled`(bool) /
                        `model.roleDefaults.<role>`({providerId,modelId})，
                        zod 校验写入；是配置三层链的 DB overlay 层）
notifications 消息主体  id(uuid), source(text system|admin), category(text),
                        level(text info|warning|critical), title(text), body(text),
                        i18n_key(text?), i18n_params(jsonb?),
                        audience(text all|users), created_by(text?, 管理员逻辑引用),
                        revoked_at(timestamptz?), created_at
                        （写时扇出：内容只存一份，逐人投递态在 user_notifications；
                        撤回只置 revoked_at，用户侧立即不可见，管理端统计保留）
user_notifications
              用户投递  user_id(text), notification_id(uuid→notifications, 级联删),
                        read_at(timestamptz?), PK(user_id, notification_id)
                        （投递即「可见且未读」；已读 = read_at 非空。user_id 不设外键：
                        users.id 是 uuid 而所有 *_user_id 列一律 text）
```

枚举取值：

- `message_role`：`user` / `assistant` / `system`
- `user_status`：`active` / `disabled`
- `user_gender`：`male` / `female` / `secret`
- `asset_kind`：`image` / `json` / `other` / `edited`
- `task_type`：`generate_image` / `render_html` / `export`
- `task_status`：`pending` / `running` / `succeeded` / `failed` / `canceled`
- `credit_ledger_type`：`grant` / `freeze` / `settle` / `release` / `adjust`
- `credit_ledger_status`：`frozen` / `settled` / `released`（仅 freeze 条目持有）

通知相关列一律 `text` + 应用层常量（`NOTIFICATION_SOURCES` / `_CATEGORIES` /
`_LEVELS` / `_AUDIENCES`，见 `packages/db/src/notification.repo.ts`）：动作集与类别集
随产品增长，`pgEnum` 改型需 DDL。取值：

- `notifications.source`：`system` / `admin`
- `notifications.level`：`info` / `warning` / `critical`
- `notifications.audience`：`all` / `users`
- `notifications.category`：`credits.low` / `credits.exhausted`（系统，积分两级阈值）
  / `admin.broadcast`（管理员全体广播）/ `admin.direct`（管理员定向）

> 注：`chat-image-gen` 已落地：① `chat_sessions` 新增 `agent_id` 列（迁移 `0001`）；
> ② 消息持久化采用 MVP 实际 schema（`content` 文本 + `tool_calls` jsonb），由
> `src/server/agent/transcript.ts` 确定性重建为可直接渲染的 UIMessage parts（零转换，前端不需字段映射）；
> ③ `assets` 记录生成来源（`prompt`/`model`/`meta` 含 provider/size/taskId）。
> `canvas-editing` 新增 `asset_kind=edited` 派生图：由画布导出得到，与原始生成图（`image`）区分，
> `meta` 记录 `sourceAssetId` 与编辑摘要（`crop`/`filters`），原始资产字节不被改动。
>
> `portfolio` 在 `assets` 上加 `saved_at`（收藏时间，null = 未收藏）与 `title`（用户命名），
> 并新增 `tags`（全局标签词表，`name` 唯一）与 `asset_tags`（关联表，复合主键，两侧外键
> `ON DELETE CASCADE`）两表（迁移 `0010`）。**收藏即在原资产上打标，不复制字节**
> （零存储开销），代价是 `DELETE /api/sessions/:id` 的 GC 需跳过已收藏项
> （`listKeysBySessionUnsaved` / `removeUnsavedBySession` 与无条件版本并存）；存活资产的
> `session_id` 因 `ON DELETE SET NULL` 被置空，作品集展示其来源时呈现为未知。`saved_at`
> 建部分索引（`WHERE saved_at IS NOT NULL`）供作品集列表使用。排版设计的导出成果经
> `POST /upload purpose=design` 落库为**无会话归属**资产（设计编辑器没有会话概念）。
> `canvas-first-workbench` 增 `meta.referenceAssetId`（generate_image 血缘：引用的源图 assetId，
> 参考图上传 `purpose=reference` 落 `kind=image` + `meta.purpose="reference"`，不追加聊天消息）。
> `agent-session-memory` 新增 `messages.transcript`（LLM 视图）与 `chat_sessions.summary` /
> `summarized_up_to`（compact 水位线，迁移 `0003`），存量数据零回填（见 5.1）。
> `user-auth` 新增 `users` / `invite_codes` 表与 `user_status` 枚举（迁移 `0004`）；
> `add-user-profile-and-logout` 为 `users` 增 `oops_id` / `gender` / `bio` / `token_version` 与 `user_gender` 枚举（迁移 `0005`，存量行 `oops_id` 已回填）；
> `add-credits-domain` 新增 `credit_ledger` / `credit_prices` 表、两组枚举与 `users.credit_balance`
> 物化列（迁移 `0007`，seed 定价 生图 10 / 渲染 5，存量用户回填 100 分 grant 流水）。
> `add-admin-console` 新增 `admin_audit_log` / `app_config` 表与 `invite_codes.revoked_at`
> 列（迁移 `0008`）；`users.role` 在更早的抽包阶段加入（迁移 `0006`）。
> 审计动作用 text + 应用层常量（不用 pgEnum——动作集随管理面增长，改型需 DDL）。
> `add-message-center` 新增 `notifications` / `user_notifications` 两表（迁移 `0011`）。
> 投递模型是**写时扇出**：消息主体一份内容，`user_notifications` 一人一行存已读态
> （500/批插入），因此「谁收到了、谁读了」是直接查询而非运行时 join 扩散；
> 撤回只置 `notifications.revoked_at`，用户侧列表/计数立即过滤，管理端的
> 目标人数与已读明细仍可回答「撤回前多少人读过」。积分两类系统消息的
> 去重与复位不引入状态列：比较「最近一条同类通知时刻」与「账本最近正向流水时刻」，
> 配合事务级 `pg_advisory_xact_lock(hashtext(userId))` 消除并发双写窗口。
> 保留期清理（已读且超 90 天）挂在 `apps/web/src/instrumentation.ts` 启动钩子。

### 7.1 管理面（admin console）

独立应用 `apps/admin`（antd 栈，dev 端口 3001），**自带登录页 `/login` 与独立的
`oops_admin_session` 会话**（复用 `users` 表账号，`role=admin` 才发会话；web 端会话
不被认，登录语义与部署形态无关）；页面由 proxy 存在性检查（无会话 → `/login`）+ layout
`requireAdmin` 双层守卫。七张管理面：
用户 / 邀请码 / 积分运营（发放·扣减·流水·对账·定价）/ Agent 开关 / 模型配置 / 总览看板 /
消息管理（下发广播·定向、已读明细、撤回）。

- **登录契约**：`POST /api/login` 同源校验 → 限频（10/60s）→ `authenticateAdmin`（密码 +
  `role=admin` + `status=active`；失败一律"用户名或密码不正确"，不泄漏账号与角色）→
  落 `auth.login` 审计 → 下发管理端会话 cookie。`role` 仍每请求判定：登录后被降级即 403。

- **API 纪律**：每个 Route Handler 先 `requireAdmin`（401/403 结构化错误），输入 zod
  校验；**全部写操作 = 业务写入 + 同事务审计**（who / what / when / before / after），
  绝无绕过审计的写路径；只读看板（dashboard）零写路由。
- **配置三层链**（`@oops/llm` runtime-config）：`app_config overlay → env → 目录默认`
  逐层回落，解析结果带来源层标注（overlay/env/catalog）；30s 模块级 TTL 缓存 +
  写侧进程内代数 bump（admin 端写后本进程即时生效，web 端 ≤30s 收敛）；overlay
  读失败 fail-open 回落下层且失败结果不缓存。消费点：Agent 启停（web 侧过滤注册表）、
  模型启停、角色默认模型（main / summarizer）。
- **审计动作**（应用层常量 `ADMIN_AUDIT_ACTIONS`）：`auth.login`（管理员登录，覆盖面中
  唯一的非写操作项）/ `user.status_change` / `invite.create` /
  `invite.revoke` / `credits.adjust` / `pricing.update` / `agent.toggle` / `model.config`
  （同时覆盖模型启停与角色默认模型）/ `message.send` / `message.revoke`（目标类型
  `message`，与消息投递同事务落审计——「消息已发但审计缺失」不可能发生）；
  审计可按动作 / 目标 / 操作者检索。
> 业务四表历史行的 `user_id='owner'` 为 foundation 阶段遗留值，仅作旧数据存在，新写入一律为真实用户 id。
> `assets.resultAssetId` 等扩展属后续按需演进。

Schema 方言（pg）：`JSON` → `jsonb`；枚举列用 `pgEnum`；时间列用 `timestamp with time zone`。

## 8. 项目目录

> 以下为当前实际存在的文件；标注「（后续 change）」的为尚未落地项。

```
oops/
├── apps/web/                       # web 应用包 @oops/web —— 下列 src/ 子树、messages/、public/、
│   │                               #   .env.example（及 gitignored 的 .env.local）、vitest.* 均位于其下
├── src/
│   ├── proxy.ts                    # Edge 层引导（cookie 存在性 → 302 /login；非安全边界）
│   ├── app/                        # 薄壳路由层（页面 + route.ts）
│   │   ├── (auth)/                 # 登录/注册页（公开，居中卡片）
│   │   │   ├── layout.tsx
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├── files/[...path]/route.ts # 资产代理读取（登录后，安全响应头）
│   │   ├── upload/route.ts         # 图片上传（requireUser + MIME 白名单 + 大小上限；purpose=reference 参考图分支，绑定会话不写消息）
│   │   ├── chat/page.tsx           # 画布工作台页（顶栏 + 工具条 + 可收起聊天 340px + 画布平面；会话抽屉覆盖层；窄屏聊天/画布互斥切换）
│   ├── design/page.tsx         # 设计工作台页（reducer 状态 + 顶栏/左轨/画布/面板组合 + localStorage 草稿；尺寸前置弹窗入口在 /home）
│   │   ├── profile/page.tsx        # 个人信息页（基本资料卡 + 改密卡，proxy 保护）
│   │   └── api/
│   │       ├── agents/route.ts     # GET 已注册 Agent 元数据
│   │       ├── auth/               # register / login / logout（邀请码 + 限频 + Set-Cookie）
│   │       ├── profile/            # GET/PATCH 资料 + POST 改密（requireUser + 改密按 IP 限频）
│   │       ├── sessions/route.ts   # 会话列表/新建（按认证用户隔离）
│   │       ├── sessions/[id]/route.ts # GET 历史（UIMessage 重建）/ PATCH 重命名+Agent 重绑 / DELETE 删除即 GC（删对象存储字节→assets→会话，messages 级联；已收藏资产豁免）
│   │       ├── assets/route.ts     # GET 作品集列表（游标分页 + 标签筛选）/ 批量收藏态（ids）
│   │       ├── assets/[id]/route.ts# GET 单图详情（加工出口换址）/ PATCH 收藏·标题·标签 / DELETE 彻底删除
│   │       ├── notifications/      # 站内信：route.ts GET 列表（来源筛选 + 分页）/
│   │       │   │                   #   unread-count/route.ts 未读计数（铃铛 60s 轮询）/
│   │       │   │                   #   [id]/route.ts PATCH 标记已读（撤回后 404）/ read-all/route.ts 全部已读
│   │       └── chat/route.ts       # POST SSE 聊天（requireUser + 敏感词初筛 + 首条消息自动标题 + 落库 + 流式；
│   │                              #   积分不足 402 前 best-effort 投递「已耗尽」通知）
│   ├── server/                     # 服务端专属（ESLint 禁止客户端 import）
│   │   ├── auth/                   # → @oops/auth（packages/auth：password / session-cookie / require-user / require-admin / register / authenticate / rate-limit / oops-id）
│   │   ├── db/                     # → @oops/db（packages/db：schema + 6 仓储 + drizzle/ 迁移与 drizzle.config.ts 共址）
│   │   ├── infra/
│   │       ├── storage/            # 存储抽象（S3 兼容，env 切换后端）
│   │           ├── s3.ts           # S3Client 封装 + key 生成
│   │           ├── serve.ts        # 资产响应构建（内联 vs 强制下载）
│   │           ├── upload.ts       # 上传处理：purpose=reference（参考图）/ =design（设计成果，无会话归属）/ 带 sessionId（画布派生导出）/ 缺省（userId-only）
│   │   │   └── providers/          # 外部 Provider 接入
│   │   │       ├── llm.ts          # qwen-token-plan-cn 文本模型装配
│   │   │       └── dashscope-images.ts # 万相 wan2.7-image 自定义 images provider
│   │   ├── domain/
│   │   │   └── tasks/handlers.ts    # generate_image / render_html 任务处理器（经 @oops/domain/tasks 执行器跑）
│   │   └── agent/                  # 声明式 Agent 运行时
│   │       ├── registry.ts / runtime.ts / types.ts / transcript.ts / moderation.ts / compact.ts
│   │       ├── definitions/        # 各 Agent 定义 + prompts/<id>.md（含 compact 摘要骨架）
│   │       └── tools/              # ToolRegistry（ToolExecutionContext 注入 userId）+ 工具实现
│   ├── components/                 # shadcn/ui + AI Elements（仅 UI，无业务逻辑）
│   │   ├── canvas/                 # 画布工作台（多作品平面 stage / 编辑工具条 / 滤镜面板 / 裁剪 / 空态）
│   │   ├── design/                 # 设计工作台（缩放适配画布 surface / 选中手柄 / 左轨 / 模版-素材-文字面板 / 尺寸前置弹窗）
│   │   ├── workbench/              # 工作台骨架（顶栏（会话名/保存状态/导出）/ 56px 工具条（会话抽屉、聊天显隐、底部用户入口）/ 会话抽屉）
│   │   └── chat/                   # 聊天面板与消息渲染（摘要 chip / 双形态 composer）
│   ├── i18n/                       # next-intl 装配（client-safe）：locale.ts/request.ts locale 解析链 + messages.ts 词典装载与类型
│   ├── lib/                        # 客户端安全共享：utils / canvas（reducer/coords/layout/存储）/ design（reducer 历史栈、模版-素材-字体目录、presets、草稿存储、snapdom 导出封装，均含单测）
│   └── types/                      # 共享 TypeScript 类型
├── apps/admin/                     # 管理端应用包 @oops/admin（M0.3 scaffold）——antd-only 栈（无 Tailwind），
│   │                               #   dev 端口 3001；门卫三层：proxy 存在性 → (console)/layout 全量校验 → 放行
│   ├── src/
│   │   ├── proxy.ts                # Edge 层引导（oops_session 存在性 → /gate；非安全边界）
│   │   ├── app/
│   │   │   ├── (console)/          # 门卫（requireAdminFromCookieHeader）+ AdminShell（Sider 七面菜单 +
│   │   │   │                       #   头部身份/退出 form）+ 七面页面（users/invite-codes/points/agents/models/audit/dashboard/messages）
│   │   │   ├── gate/page.tsx       # 无 cookie 引导页（指路 web 端登录）
│   │   │   ├── api/logout/route.ts # POST 清会话 cookie（Max-Age=0）+ 307 回 web 首页
│   │   │   └── layout.tsx          # 文档壳（AntdRegistry + next-intl + ConfigProvider zhCN）
│   │   ├── lib/guard-view.ts       # 门卫结果 → 视图分支映射（纯函数 + 单测三分支）
│   │   ├── components/             # admin-shell（client）/ guard-notices（401/403）/ section-placeholder（RSC）
│   │   └── i18n/                   # next-intl 装配（镜像 web，zh 单语 cookie 模式）
│   └── messages/zh.json            # 词典（zh 源）
├── packages/                       # 共享包（TS 源码直出，Next transpilePackages；分层 config → db → {domain,llm} → auth 单向禁逆）
│   ├── config/                     # @oops/config：env schema 按域分组 + 域级 getter + parseEnv 全量入口
│   ├── db/                         # @oops/db：Drizzle schema/仓储 + drizzle/ 迁移目录 + drizzle.config.ts 共址
│   ├── domain/                     # @oops/domain：积分账本服务（credits/）+ 任务执行器 core（tasks/，并发/注册/终态结算钩子）
│   ├── llm/                        # @oops/llm：模型目录 catalog + 角色 resolver（llm-assembly）
│   └── auth/                       # @oops/auth：password / session / require-user / require-admin / register / authenticate / rate-limit
├── docker-compose.yaml             # postgres:16 + minio + minio-init（自动建桶）
├── pnpm-workspace.yaml             # workspace 声明（apps/* + packages/*）
├── package.json                    # 根编排壳：dev/build/start → --filter @oops/web、db:* → --filter @oops/db、lint/typecheck/test → -r
└── pnpm-lock.yaml                  # workspace 单一锁文件
```

**分层边界**：`src/app` 只做路由薄壳；`src/server` 服务端专属，禁止被客户端代码 import
（ESLint `no-restricted-imports` 强制，覆盖 `src/components`、`src/hooks`）；`src/lib` 前后端共享且不含服务端实现。
领域仓储层为 `@oops/db`（纯 Drizzle，不依赖具体 Provider / 框架），`src/server/infra/storage` 为基础设施实现。
共享包依赖单向：`config → db → llm → auth` 禁逆；app 只经 `@oops/*` 公共 API（exports 子路径）消费，env 全部经 `@oops/config` 域 getter 读取。

> `src/server/infra/render/`（无浏览器渲染，对应 `render_html` 工具）已落地：
> HTML → satori-html 转 VDOM → satori 输出 SVG → resvg 转 PNG，不依赖浏览器二进制与进程，
> 可跑在无图形栈的函数运行时。渲染链路固定顺序「版式静态校验 → 图片出网闸门 → `/files/`
> 引用内联 → 渲染」；闸门必须在内联之前，顺序颠倒会让非法外链被内联成 data URI 绕过检查。
> 安全模型分两层：渲染器不执行 JS，「不执行脚本」是结构性事实（原 Playwright 时代的
> 禁脚本三重防护已删除）；图片外链仍由渲染前扫描剥离（非 data: 与非白名单 host），
> 与渲染器内建的内网/元数据 SSRF 防护形成纵深。
> `/files/` 引用读不到字节时（对象已删、地址是模型幻觉）按「该图缺席」降级，**不判定渲染失败**：
> 整个 `<img>` 标签被移除，而不是只抹掉 URL 字符串——后者会留下 `src=""`，satori 抛
> "Image source is not provided" 让整次渲染失败（且错误曾被误报成「版式非法」）；CSS `url()`
> 换成 `none`。剥离数（外链 + 读不到 + src 缺失）累进 `droppedImages` 回喂 Agent，商品图
> 丢失时必须转告用户重新上传/选中，而不是静默交付一张带空洞的海报。
> 字体：satori 不回退系统字体且不合成加粗，必须注入 Regular + Bold 两个真实字重的
> 子集字体（思源黑体 Noto Sans SC，SIL OFL 可再分发；由 `scripts/build-subset-font.mjs`
> 从可变字体实例化后裁剪，源字体在 `.fontcache/` 不入库）。汉字集取 GB 2312 一二级
> 6763 字（`scripts/gb2312-hanzi.txt`）——不能用连续码点范围：整个 CJK 基本区 20992 字
> 会触发 subset-font 的字形数 bug（产出损坏 glyf 表），而收窄到 3072 字又会让
> 「标题」「图片」等常用字静默缺字形。缺字形不报错，故有逐字覆盖回归测试锁定。
> 版式：渲染器对 grid / float / `var()` / `position:sticky` 等**静默降级不报错**，
> 故由 `assert-layout-support.ts` 在渲染前静态校验拒绝并回喂 Agent 改写。
> 多模态上下文：声明 vision 能力的 Agent（海报设计师）将引用商品图以 `ImageContent` 注入本轮
> LLM 输入（非 vision Agent 保持文本引用块），transcript 图片一律清洗为引用占位文本（无 base64 落库）；
> 部署海报场景需 `LLM_MAIN_MODEL` 指向已登记的 vision 模型（qwen3.7-plus；
> 目录条目 id 必须是 pi-ai provider 模型数据中真实存在的模型）。
> 领域聚合/任务状态机等按需演进（`task-executor` 已落地）。
> 图片浏览/编辑已在 `chat/page.tsx` 的**画布工作台**承载（缩略图上屏 + 裁剪/滤镜/导出），不再单独规划 `gallery` 作品库页。

## 9. 演进路径（超出 MVP 范围，按需启动）

- **多租户 SaaS**：注册/登录与用户级数据隔离已落地；积分计费（预扣冻结 + 终态结算）已落地，后续补团队与组织隔离。
- **多实例部署**：存储为 S3 兼容（env 可切云上后端）、DB 为 Postgres（无状态），应用可水平扩展；task executor 换 BullMQ + Redis 即可去单例限制（存储 / DB 不再是扩展瓶颈）。
- **Agent 市场**：AgentRegistry 已是配置驱动，可平移到 DB 存储开放自定义。
- **局部重绘/抠图**：作为新工具加入 ToolRegistry，Agent 按需引用。

## 10. 构建版本徽标

构建版本展示在 `/home` 用户菜单内（`src/lib/version.ts`）：构建时注入的
`NEXT_PUBLIC_APP_VERSION` 优先，缺失时回退 `package.json` 的 `version`，不注入也能正常构建与展示
（无需数据库配置）。构建/运行环境需同时注入该变量以保持 SSR 与客户端一致
（详见 `src/lib/version.ts` 注释）。可选在构建命令中覆盖，例如从 git tag 派生：

```bash
NEXT_PUBLIC_APP_VERSION=$(git describe --tags --always) pnpm build
```
