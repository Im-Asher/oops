<div align="center">

# 🎨 oops

**让电商图片"聊"出来 —— AI Agent 驱动的电商文生图工作台**

描述需求、上传商品素材、挑选设计 Agent，产出商品详情长图、海报与氛围图。

简体中文 · [English](README.en.md)

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white) ![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-PostgreSQL-C5F74F) ![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white) ![Vitest](https://img.shields.io/badge/Test-Vitest-6E9F18?logo=vitest&logoColor=white) ![License](https://img.shields.io/badge/License-MIT-yellow)

</div>

---

## 📌 5W2H 速览

| ❓ 问题 | 💡 一句话答案 |
| --- | --- |
| 🤔 **What** 是什么 | AI Agent 驱动的电商文生图 Web 系统：聊天式出图（详情长图 / 海报 / 氛围图） |
| 💭 **Why** 为什么 | 电商图片制作依赖设计师人力、周期长、成本高 —— 用 Agent 把"改稿十轮"变成"聊一轮" |
| 👥 **Who** 给谁用 | 电商卖家 / 运营人员（无设计背景），以及想低门槛接入 AI 生图能力的开发者 |
| 🕐 **When** 何时用 | 上架前批量出图、大促海报快速迭代、场景图补齐、单品多版本比稿 |
| 🌍 **Where** 在哪用 | 浏览器访问（首页 `/home` + 全屏 AI 画布 `/canvas`）；自托管部署（Node 22+ / Docker） |
| 🛠️ **How** 怎么做 | `pnpm install` → `docker compose up -d` → 配置 `.env.local` → `pnpm db:migrate` → `pnpm dev` |
| 💰 **How much** 花多少 | LLM + 生图 API 按量计费；进程内任务限并发（生图 2 / 截图 1~2），无额外中间件成本 |

---

## 🤔 What · 是什么

**oops** 是面向电商客户的文生图 Web 系统：用户在聊天框中描述需求并上传商品素材，选择一位设计 Agent，即可产出电商图片。

- 💬 **对话即创作** —— SSE 流式对话，Agent 会先追问澄清，再调用工具出图
- 🖼️ **混合生成管线** ——
  - 海报 / 商品详情长图：Agent 生成 HTML → 服务端 Playwright 截图（文字与排版像素级可控）
  - 氛围 / 场景图：纯文生图 API（通义万相 `wan2.7-image`）
- 🤖 **声明式 Agent** —— 每个 Agent 只是一个配置文件（系统提示词 + 工具子集），新增 Agent **零代码改动**；内置「氛围图设计师」「产品摄影师」
- 🧠 **会话记忆** —— 消息双视图持久化 + 上下文自动压缩（compact），长会话不失忆
- 🎨 **画布工作台** —— 生成结果落在全屏点阵画布上，占位 → 成图原地结算，支持参考图引用、裁剪 / 滤镜 / 导出
- 🗂️ **任务化执行** —— 所有生图 / 截图走持久化任务队列，限并发、可重试、刷新不丢
- 🌗 **明暗双主题** —— 全局亮 / 暗色切换，首屏防闪烁

> 架构详情见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，产品设计准则见 [docs/PRODUCT_DESIGN.md](docs/PRODUCT_DESIGN.md)。

## 💭 Why · 为什么做

传统电商图片产出的痛点：

| 痛点 😫 | oops 的答案 ✨ |
| --- | --- |
| 详情页长图排版反复改稿，沟通成本高 | Agent 生成 HTML 渲染，文字与布局精确可控 |
| 海报 / 氛围图需要多次试错 | 对话式迭代，画布上原地结算、失败卡一键重试 |
| 设计工具门槛高 | 聊天框描述需求即可，信息不足 Agent 主动追问 |
| 图片散落各处、难以追溯 | 素材统一入库（MinIO / S3），按会话与血缘组织 |

## 👥 Who · 给谁用

- 🛒 **电商卖家 / 运营**：需要高频产出详情图、海报、场景图，但没有设计资源
- 👨‍💻 **开发者**：想基于声明式 Agent 快速扩展自己的设计 Agent（加一个文件即可）
- 🏢 **MVP 单部署多用户**：邀请码注册 + 用户名密码登录，全表 `userId` 隔离，可平滑演进为多租户 SaaS

## 🕐 When · 何时用

- 📦 新品上架前：批量生成详情长图与主图海报
- 🎉 大促节点：海报文案 / 配色快速多版本迭代比稿
- 🌄 商品缺场景图：一句话补齐氛围 / 使用场景图
- 🔁 存量商品换季 / 改版：引用原图作为参考图再生成

任务异步执行（并发 2、单任务超时 90s），提交后可关闭页面，生成结果持久化不丢失。

## 🌍 Where · 在哪用

- 🖥️ **浏览器**：`http://localhost:3000`
  - `/home` —— 落地页（创作输入 + Agent 卡片入口）
  - `/canvas` —— 全屏 AI 画布工作台（悬浮聊天面板 + 点阵画布）
- ☁️ **部署**：任意可运行 Node.js 22+ 的主机（截图渲染需 Chromium）；依赖 Postgres + MinIO（S3 兼容），`docker-compose.yaml` 一键拉起

## 🛠️ How · 怎么用

```bash
# 1️⃣ 安装依赖
pnpm install

# 2️⃣ 启动本地基础设施（PostgreSQL + MinIO，自动建桶）
docker compose up -d

# 3️⃣ 配置环境变量（数据库 / MinIO / LLM 与生图 API Key）
cp .env.example .env.local

# 4️⃣ 初始化数据库
pnpm db:migrate

# 5️⃣ 启动开发服务器
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，注册（需邀请码）→ 登录 → 选 Agent → 开聊。

**常用命令** 🧰

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 开发服务器 |
| `pnpm build` / `pnpm start` | 生产构建 / 启动 |
| `pnpm lint` | ESLint（含分层边界检查） |
| `pnpm typecheck` | TypeScript 严格检查 |
| `pnpm test` | Vitest 单元测试 |
| `pnpm db:generate` | 生成 Drizzle 迁移 |

> 提交代码前请跑通：`pnpm lint && pnpm typecheck && pnpm test`

## 💰 How much · 花多少

- 🔑 **API 成本**：文本 LLM（通义千问 Token Plan）+ 生图 API（万相 `wan2.7-image`）按量计费；Agent 遵循"追问优先于猜测"，避免浪费生图额度
- ⚙️ **计算资源**：单进程内任务执行器（生图并发 2、截图并发 1~2、超时 90s），无需 Redis / MQ 等额外中间件；未来可平滑替换为 BullMQ
- 🧑‍💻 **扩展成本**：新增一个设计 Agent = 1 个定义文件 + 1 个提示词 Markdown，前端零改动
- ✅ **质量门槛**：所有变更需通过 lint + typecheck + test

---

<div align="center">

📝 License [MIT](LICENSE) · Made with ❤️ for e-commerce sellers

</div>
