# AGENTS.md — oops

Guidance for AI coding agents working in this repository.

## Project overview

**oops** is a text-to-image web system for e-commerce customers. Users describe
requirements (and upload product assets) in a chat box, pick a specialized
design agent, and receive generated product-detail images, posters, and
atmosphere/scene images.

Key characteristics:

- **Hybrid image generation** — posters / product-detail long images are
  rendered from agent-generated HTML and screenshotted server-side (precise
  text & layout control); atmosphere/scene images use pure text-to-image APIs
  (Seedream / Wanxiang).
- **Declarative agents** — every agent is a single config file under
  `apps/creation/src/agent/definitions/` (system prompt + tool list). Adding an
  agent requires **no** frontend or runtime code changes.
- **Two Node processes, one product** — `apps/web` (UI + BFF) and
  `apps/creation` (creative domain: agent runtime, tools, task executor,
  rendering, providers; default port 3002). `/api/chat` authenticates, gates
  credits, validates references and writes the user row, then POSTs
  `/v1/runs` to creation and **pipes the SSE body back unchanged** — no parsing,
  no re-assembly, no buffering. The wire contract (run request, SSE events with
  `v: 1`, agent metadata) lives in `packages/contracts` zod schemas, so both
  sides break at compile time instead of at runtime. Internal calls carry
  `x-internal-token` (`INTERNAL_TOKEN`, shared only inside one machine).
- **Single writer per row, not per table** — web writes user messages and
  `assets.savedAt`; creation writes assistant/tool messages, `tasks`, new
  assets and the credits ledger (freeze→settle must stay in one transaction; a
  cross-service settle would leave permanent freezes). Both sides share
  `@oops/db` and `@oops/domain`; never copy that logic.
- **Task-based generation** — all image work runs through an in-process task
  executor with concurrency limits; tasks are persisted and retryable.
- **In-session memory & compact** — every turn rebuilds LLM context from the
  persisted `messages.transcript` view (dual-view: UI parts + LLM transcript on
  the same row), capped by a last-40 fallback. When the estimated context
  exceeds ~30k tokens (char-approx), older turns are compacted into a skeleton
  LLM summary (`sessions.summary` + `summarized_up_to` watermark, originals
  never deleted). Thinking blocks and base64 images are never persisted.
- **Portfolio** — a cross-session gallery shown as a view inside `/home`'s main
  area (sidebar switches views; there is no standalone `/portfolio` route). An entry *is* the original
  asset, tagged via `assets.savedAt` (null = not collected) — never a copy, so
  collection costs no extra storage. Side effect: session delete
  (`DELETE /api/sessions/:id`) must skip collected assets
  (`listKeysBySessionUnsaved` / `removeUnsavedBySession` sit beside the
  unconditional variants); survivors keep a null `sessionId` and therefore show
  no known source. Tags live in a global `tags` pool joined by `asset_tags`, so
  spelling cannot fragment. Processing entry points pass `assetId` (never a URL)
  through `GET /api/assets/:id`, which checks ownership before handing out an
  address — a URL param would let a user inject an arbitrary external image.
- **Message center** — in-app notifications rendered as a view inside `/home`
  (sidebar switches views; the bell sits in the sidebar footer). Delivery is
  **write-time fan-out**: one `notifications` row holds the content, one
  `user_notifications` row per recipient holds the read state, so "who
  received it / who read it" is a query rather than a runtime join spread.
  Revoking only stamps `revokedAt` — invisible to the user immediately, while
  the admin console keeps target/read counts for the record. Credits notices
  are two-level (`credits.low` on settlement, `credits.exhausted` at the 402
  gate); dedup/reset is derived from the append-only ledger timeline (no
  extra state column) and serialized per user with a transaction-level
  `pg_advisory_xact_lock(hashtext(userId))`. Notification writes are
  best-effort everywhere: a failure must never change a 402 rejection or turn
  a settled task into a failed one. Retention (read + >90d) is purged from
  `apps/web/src/instrumentation.ts` at startup.
- **Resident-rail app sidebar with an adjacent L2 panel** — `/home`'s left sidebar
  is a single component (`components/layout/home-sidebar.tsx`) holding a **two-level**
  nav: L1 = 首页 / 创作 / 图库, L2 = 创作›AI 画布·排版设计 and 图库›作品集·素材库.
  The shape is copied from a measured reference (Canva projects page, 2026-10-19) and
  the rules below are the ones that measurement settled:
  - **The L2 panel is a flex sibling of the rail, not a floating overlay.** It occupies
    layout width and squeezes the main area (measured 1121px → 857px). Nothing may
    reintroduce an overlay here — the previous implementation did and it was wrong.
  - **An L1 row has exactly one activatable target: activating it opens that group's
    panel and lands on the group's `primaryId` child** (declared in the data, never
    inferred from array order). There is **no chevron and no second control per row**, so
    L1 rows are plain buttons, not links; a leaf L1 (首页) collapses the panel instead.
    Activating a panel row does **not** collapse the panel, and neither does
    re-activating the same L1.
  - **Landing on the default child happens only in-page.** 作品集 is a main-area view, so
    图库 switches to it; AI 画布 is a whole-page route, so 创作 opens its panel and stays.
    Auto-navigating there would remove the panel the user just opened and leave no way to
    reach 排版设计. Rule: *apply the default child's effect within the current page.*
  - **The panel's global open/close is a linear switch at the top of the rail** (beside
    the wordmark, `aria-expanded` + `aria-controls`), matching the reference's 36×36
    「切换侧边导航栏」 button. Reopening restores the group that was open last; it shares
    one `togglePanel()` with `Cmd/Ctrl+B`. It is absent below 768px, where there is no
    resident panel.

  - Panel state lives inside the sidebar (opening it must not re-render the main area),
    is never persisted, and starts closed. Collapsed means width 0 + `inert` +
    `aria-hidden`, **not** unmounted — otherwise the closing transition wipes an empty
    strip.
  - **Two indicators, deliberately separate.** The filled tile marks the current **section**
    and follows the L1 the user activated, *not* the main view — clicking 创作 selects its
    default child (AI 画布) while the main area stays on the landing page, so a
    view-derived highlight would leave 创作 dark. `aria-current="page"` marks the deepest
    selected item, and exactly one nav row carries it (rail L1 and panel L2 counted
    together); when the panel is collapsed its items leave the accessibility tree and the
    **L1 takes the mark over**, so the current-location anchor never disappears.
    消息中心 has **no nav row**: the footer bell is its only entry and carries
    `aria-current` while that view is up.
  - Nav items keep their visible text labels (the visible text is the accessible name,
    so no tooltip-only a11y gap opens). The rail footer keeps only bell and avatar;
    theme, locale and settings live in the user menu. The **wordmark and build-version
    badge appear only at the top of the L2 panel** — a 64px column cannot hold them, and the
    reference puts its brand there. The footer is a **vertical** stack: bell above, avatar
    below.
  - Narrow-viewport sheet state and the `Cmd/Ctrl+B` shortcut live in
    `lib/layout/use-sidebar-layout.ts`. Below 768px the sidebar leaves the document flow
    and opens as a Radix Dialog sheet (`components/ui/sheet.tsx`, no new dependency) that
    lists **group headings plus flat L2 rows** — L1 is a non-interactive heading there, no
    disclosure control and no floating layer, since a modal dialog marks its siblings
    `aria-hidden` and there is no resident panel to expand.
  - Geometry, hue rules and the `--spacing-sidebar*` width tokens (rail 64px, panel
    264px) are specified in `docs/DESIGN.md` B7.2 —
- **MVP single-tenant** — simple passcode/invite-code auth with a cookie
  session. All tables carry a `userId` column so multi-tenancy can be added
  later without schema redesign.

See `docs/ARCHITECTURE.md` for the full architecture and data model.

## Documentation maintenance

- `docs/ARCHITECTURE.md` and this file must stay in sync with the actual
  implementation. When a change alters architecture decisions, agents/tools,
  commands, conventions, or security requirements, update the relevant doc
  **in the same change** — doc updates are part of the definition of done.
- `docs/PRODUCT_DESIGN.md` is the product design constitution (principles &
  philosophy only — no implementation details, no status tracking). When a
  change makes a UX/product-principle decision, resolves a principle conflict,
  or would behave against a stated principle, update its affected sections
  **in the same change** (its own update rules live in §7 of that doc).
- `docs/DESIGN.md` is the design-token source of truth (four layers: primitive →
  semantic → brand → component; light/dark; per-surface rules). Any change to
  color / type / radius / shadow / motion must land there first, then be
  mirrored into `globals.css` (web, Tailwind v4 `@theme inline`) **and** the
  antd `ConfigProvider` token map in `apps/admin/src/app/layout.tsx` — the two
  apps consume tokens through different mechanisms and drift silently.
- Milestone plans (version-keyed) live in `docs/milestones/<version>.md`; the
  active one is `docs/milestones/v0.1.0.md`. A milestone is **not** a change
  log — progress is tracked by archived changes and git; keep its phases,
  decisions, and risk states in sync when the plan's direction changes.
- Sync rules and deferred doc TODOs live in `IMPROVEMENT.md`; it is **not** a
  change log — doc-update history is tracked in git commits, never duplicated
  in a manual table. If docs and code conflict, code wins — fix the doc
  immediately.


## Tech stack (summary)

| Layer          | Choice                                              |
| -------------- | --------------------------------------------------- |
| Framework      | Next.js 16 (App Router, `proxy.ts` not middleware)  |
| Language       | TypeScript (strict)                                 |
| UI             | shadcn/ui + AI Elements + Tailwind CSS v4           |
| Admin UI       | Ant Design (apps/admin only — antd stack, no Tailwind) |
| Agent runtime  | `@earendil-works/pi-agent-core` + `pi-ai`           |
| Database       | PostgreSQL via Drizzle ORM                          |
| Rendering      | `satori` + `satori-html` + `@resvg/resvg-js`（无浏览器；子集字体内置） |
| Image gen      | DashScope 万相 `wan2.7-image` via pi-ai `createImagesProvider` (Token Plan China) |
| i18n           | next-intl（无 URL 路由的 cookie 模式）— `messages/zh.json` + `en.json`，typed messages |
| Package mgr    | pnpm 10                                             |

## Project structure

pnpm workspace monorepo. The web app lives in `apps/web/` (package
`@oops/web`); the creative domain runs as its own process in `apps/creation/`
(package `@oops/creation`, native `node:http`, no build step — `tsx` runs the
TypeScript sources); the admin console lives in `apps/admin/` (package `@oops/admin`,
antd-only UI stack, dev port 3001, guarded by the same `oops_session` cookie;
seven management surfaces live since M2: users / invite codes / credits ops /
agent toggles / model config / dashboard+audit / message center); `packages/` holds shared
packages. Unless
written with a repo-root prefix, all app paths in the sections below are
**relative to `apps/web/`** (admin paths use explicit `apps/admin/` prefixes).

```
oops/                  # repo root = workspace orchestrator (scripts forward via pnpm --filter)
├── apps/admin/        # admin console: antd-only stack (no Tailwind), Layout/Menu scaffold,
│   │                  #   gate: proxy presence check + layout requireAdmin; dev port 3001
│   ├── src/app/            # pages + Route Handlers (thin shell, same discipline as web)
│   ├── src/i18n/           # next-intl assembly (zh single-locale, cookie mode like web)
│   └── messages/           # next-intl dictionary (zh.json)
├── apps/creation/     # creative domain process (:3002), tsx 直跑源码
│   ├── assets/fonts/  # 子集字体（渲染期按模块位置定位）
│   └── src/
│       ├── index.ts        # 入口：loadAppEnv 后动态 import（@oops/db 求值期建池）
│       ├── http/           # /v1/runs（SSE）· /v1/agents · /health · x-internal-token
│       ├── agent/          # runtime / registry / compact / tools / definitions(+prompts)
│       ├── tasks/          # generate_image / render_html 任务处理器注册
│       ├── providers/      # 文本模型装配 + 万相 images provider
│       ├── render/         # satori 管线（版式校验 → 出网闸门 → 内联 → 渲染）
│       └── store/          # 引用资产读取 + vision 字节注入
├── apps/web/          # the web app (UI + BFF)
│   ├── src/
│   │   ├── app/            # Thin routing shell: pages + Route Handlers only
│   │   ├── server/         # SERVER-ONLY: 产品域能力（认证/会话/资产/通知/creation 目录代理）
│   │   │   ├── creation/   # creation /v1/agents 内网客户端（60s 目录缓存）
│   │   │   ├── messages/   # 落库消息 → UIMessage parts（UI 视图重建）
│   │   │   ├── moderation.ts / presets.ts
│   │   │   └── infra/storage/  # serve / upload（S3 客户端在 @oops/storage）
│   │   ├── components/     # React components (client)；layout/ 放跨页面壳层（home-sidebar 等）
│   │   ├── i18n/           # next-intl 装配：locale.ts/request.ts locale 解析链 + messages.ts 词典装载与类型（client-safe）
│   │   ├── lib/            # Shared utilities (client-safe)
│   │   └── types/          # Shared TypeScript types
│   ├── messages/      # next-intl 词典（zh.json + en.json）
│   ├── public/        # 静态资源
│   └── .env.local     # web 专属层（同名键覆盖根共享层；NEXT_PUBLIC_* 等）
├── packages/          # shared packages：@oops/{config,db,domain,llm,auth,contracts,storage,eval}（TS 源码直出 + transpilePackages；
│                      #   包间分层 config → db → {domain,llm} → auth 单向禁逆，app 只经 @oops/* exports 消费；
│                      #   eval 为黑盒 HTTP 评测器，只依赖公开 HTTP 契约，见 ARCHITECTURE.md §4.1）
├── .env.local / .env.example  # 根共享 env 层：DATABASE_URL / S3_* / AUTH_SECRET / LLM_* / RENDER_* / QWEN_*
├── docker-compose.yaml  docs/  openspec/（本地）  AGENTS.md
```

**Import boundary (critical):** code under `apps/web/src/server/` must never be
imported from client code (`apps/web/src/app/**/page.tsx`, `apps/web/src/components/**`, or any
`"use client"` module). This is enforced via ESLint `no-restricted-imports`.

## Build and test commands

```bash
pnpm install            # Install dependencies (workspace root)
pnpm dev                # web :3000 + admin :3001 + creation :3002（pnpm -r --parallel）
pnpm dev:web            # 只起 web（creation 未起时 /api/chat 返回 503）
pnpm dev:creation       # 只起创作域
pnpm build              # Production build — forwards to @oops/web
pnpm --filter @oops/admin build  # Admin production build
pnpm start              # web + creation 并发的生产启动（creation 仍是 tsx 入口）
pnpm lint               # ESLint (includes import-boundary rules) — pnpm -r lint
pnpm typecheck          # tsc --noEmit — pnpm -r typecheck
pnpm test               # Run unit tests (Vitest) — pnpm -r test
pnpm eval            # 生成质量评测（需先 pnpm dev + pnpm eval:seed；详见 docs/ARCHITECTURE.md）
pnpm eval:doctor     # 评测前置体检：API key / web 可达 / 浏览器 / DATABASE_URL
pnpm eval:seed       # 幂等创建评测专用账号并灌初始积分
pnpm db:generate        # Generate Drizzle migrations — forwards to @oops/db
pnpm db:migrate         # Apply migrations (requires running Postgres) — forwards to @oops/db
```

Package manager is **pnpm 10** — do not use npm/yarn. Lockfile is
`pnpm-lock.yaml` (single workspace lockfile) and must be committed.

**Deployment.** The creative domain is a long-lived Node process with in-process
task execution and SSE streams, so it cannot run on Vercel functions; the target
form is "same repo, one command locally" (`docs/plans/2026-10-25-creation-service-design.md`).
The Vercel notes below still describe the web app's build contract and are kept
until the deployment doc is rewritten (P2):

**Deployment (Vercel, Root Directory = `apps/web`)**: migration is part of the build,
not a manual step. `apps/web/vercel.json` sets `buildCommand` to
`pnpm --filter @oops/db db:migrate && pnpm build`, so every deploy applies pending
migrations before `next build`; the first deploy applies `0000`~`0011` in full. Rules:

- **A schema change ships its SQL.** `pnpm db:generate` and committing
  `packages/db/drizzle/*.sql` are two separate acts — a forgotten migration file makes
  the build succeed while the tables stay missing, which is harder to diagnose than a
  failed build.
- **A failed migration must fail the build** (never `|| true`), otherwise the deploy
  ships a version that cannot talk to its database.
- `drizzle-kit` is a devDependency of `@oops/db`. If `NODE_ENV=production` is set in the
  project env, the install step skips devDependencies and the migrate command cannot
  resolve it — use Install Command `pnpm install --prod=false` in that case.
- Preview deployments migrate too (they inherit the same `DATABASE_URL` unless a
  separate preview database is configured). Every migration so far is additive +
  `ON CONFLICT DO NOTHING` seed, but **give Preview its own database before writing a
  destructive migration**.
Env 是**两层结构**：仓库根 `.env.local`（共享域键：DATABASE_URL / S3_* /
AUTH_SECRET / LLM_* / RENDER_* / QWEN_*）+ `apps/*/.env.local`（app 专属键，
同名覆盖根层）。构建/脚本入口统一经 `@oops/config` 的
`loadAppEnv(workspaceRoot, appDir?)` 加载——Next 求值 config 前已 builtin
加载 app 层，此处补加载根层用不覆盖语义，app 层始终最优先；脚本类入口
（drizzle-kit 等）省略 appDir 只取根层。`.env.example` 同构分层（根 =
共享键全清单；`.env*` gitignore 不入库）。

## Code style guidelines

- **TypeScript strict mode.** No `any` in new code; use `unknown` + narrowing
  or proper types. Export explicit types from `src/types/` when shared.
- **Layering convention:**
  - `src/app/` is a thin shell: pages, `route.ts` handlers, minimal glue.
    In `apps/web`, `src/server/` keeps only product-domain capabilities
    (auth, sessions/messages read, assets, notifications, creation client).
    The creative domain (agent runtime, tools, providers, render, task
    handlers) lives in `apps/creation/src` and must never be imported across
    app boundaries — the only channel between the two is HTTP plus the
    `packages/contracts` schemas.
  - **Shared packages (`packages/`) depend one-way: `config → db → {domain, llm} → auth`.**
    Never import `@oops/auth`/`@oops/llm`/`@oops/db` from `@oops/config`, and
    never create reverse edges between them; apps consume packages only via
    their `exports` subpaths. Env access goes exclusively through
    `@oops/config` domain getters (never raw `process.env` outside it).
    `@oops/domain` holds pure domain services (credits ledger + task executor
    core) on top of `@oops/db`; creation-specific task handlers live in
    `apps/creation/src/tasks/handlers.ts` and register via the
    `import "../agent"` side-effect chain in the creation entry.
  - Route Handlers validate input (zod), call server services, and return
    responses. They must stay short.
  - Shared UI helpers go in `src/lib/`; components in `src/components/`.
- **Naming:** files `kebab-case.ts(x)`; components/Types `PascalCase`;
  functions/variables `camelCase`; constants `SCREAMING_SNAKE_CASE`.
- **Agent definition (declarative):** one file per agent in
  `apps/creation/src/agent/definitions/<agent-id>.ts` calling `defineAgent({...})`.
  System prompts live in the same tree under `definitions/prompts/<agent-id>.md` —
  never inline long prompts in code (the compact summary skeleton
  `session-summary.md` lives in the same directory). Tools are referenced
  **by name** from the ToolRegistry; do not implement ad-hoc tools inside
  agent files.
- **Tools:** implementations live in `apps/creation/src/agent/tools/`, registered in
  the ToolRegistry with zod schemas for inputs. Tools return structured
  results; errors are returned as structured error payloads (the agent
  explains them in natural language) — never throw raw errors upward.
- **i18n (next-intl, cookie locale — no URL routing):** every new user-visible
  UI string (layer A) MUST go through the dictionaries: `messages/zh.json` is
  the source of truth and `messages/en.json` mirrors its key structure exactly
  (a key-alignment unit test enforces this); update both **in the same
  change**. Keys are type-checked via `IntlMessages` (typo = typecheck error).
  Text layering — layer B (LLM conversation text: agent prompts, tool errors,
  provider rejections) never enters the dictionaries; prompts carry a
  language-following instruction so the agent replies in the user's language.
  Server error responses keep a Chinese `message` plus a stable `code`;
  clients render dictionary copy by `code` and fall back to `message` for
  unregistered codes. Inspiration-card presets are dictionary keys
  (`chat.presets.<agentId>.<key>`) resolved per request locale in
  `GET /api/agents` (en presets are English-written prompts, not literal
  translations). Bare-CJK strings in client UI code are lint-blocked
  (`no-restricted-syntax`, error level) — exemptions: comments, test files,
  `route.ts` handlers (server messages stay Chinese by design) and
  `src/server/**`.
- **React:** function components only; `"use client"` only where needed;
  prefer server components. AI Elements components are the base for all chat
  UI — do not hand-roll message/attachment/tool UI.
- **Async tasks:** image generation and HTML rendering must go through
  `@oops/domain/tasks/executor` (invoked from creation tools). Never call
  provider APIs or render directly from tools/route handlers with unbounded
  concurrency.
- **Comments:** explain *why*, not *what*. No narration comments.
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`, `docs:`...).

## Testing instructions

- Framework: **Vitest** (unit) with tests co-located or under `src/**/*.test.ts`.
- Integration tests that need real Postgres are gated behind
  `RUN_PG_TESTS=1` + `DATABASE_URL` (e.g. `packages/domain/src/credits/credits.int.test.ts`:
  concurrent freeze atomicity, tx rollback, leak reconciliation). They skip
  silently in the default `pnpm test` run; run them explicitly before touching
  ledger/freeze semantics.
- What to test:
  - **Unit (required for new logic):** agent registry loading, tool input
    schemas, services with mocked providers (image generation, render),
    session/auth helpers.
  - **Route handlers:** validate request parsing and error shapes with mocked
    services.
  - **Manual smoke path** after changes to the chat flow: login → create
    session → pick agent → send message (first message auto-titles the
    session) → observe SSE stream → verify the generating placeholder appears
    on the canvas and settles in place (image or failure card with retry) →
    select a canvas image to attach it as a reference chip and submit a
    follow-up edit (new version placed near the source) → chat result chip
    locates the item on canvas → switch/reload sessions to confirm messages,
    canvas items, draft and view restore (workspace saved locally per session)
    → deleting a session must remove its MinIO objects and asset rows (GC)
    → narrow-viewport check: chat/canvas toggle exclusively, session drawer.
  - **Poster flow** (needs `LLM_MAIN_MODEL` pointed at a vision model):
    pick poster-designer → attach a product image → **select it on the canvas**
    (selection is the only path an image reaches the agent; upload alone does not)
    → request a poster → verify the rendered poster appears in chat and canvas
    (vision input, browser-free render) → select the poster as a reference
    for an edit round → reload to confirm restore.
    Without a selected product image the poster agent refuses to run any tool and
    asks for one — it will not fabricate a product via `generate_image`.
- Run `pnpm lint && pnpm typecheck && pnpm test` before declaring work done.
  These lock code contracts only; generation **quality** (layout overflow, missing
  glyphs, missing text, aesthetics) is covered by the separate eval harness
  (`pnpm eval`, see `docs/ARCHITECTURE.md` §4.1) — run it after changes to prompts,
  renderer, fonts or layout CSS. Its baseline `packages/eval/baseline.json` does not
  exist yet, so until one is recorded the run reports but never blocks.
- Rendering tests are hermetic service-level tests using minimal HTML fixtures;
  they need no browser. Note the two hard constraints the tests lock in: resvg must
  run with `loadSystemFonts: false` (16× slower otherwise, silently), and satori must
  keep `embedFont: true` (text vanishes otherwise, also silently).

## Security considerations

- **Secrets:** provider API keys (LLM, Seedream, Wanxiang) live only in
  `.env*` (gitignored). Access them exclusively through
  `@oops/config` domain getters; never log secrets or echo them into prompts/errors.
- **Auth:** cookie session with HttpOnly + Secure + SameSite=Lax. Every Route
  Handler must verify the session before touching DB or spawning tasks — call
  `requireUser` (`src/server/auth/require-user.ts`) and return 401 on null.
  `proxy.ts` only redirects pages for UX (cookie presence check, never a
  security boundary — Edge has no DB access); the full verification (HMAC
  signature, expiry, `users.status=active`, session-version match) lives in
  `requireUser`. The session payload carries a token version (`tv`): on
  password change the same UPDATE writes the new scrypt hash and bumps
  `users.token_version`, and the response issues a fresh cookie — the current
  client stays logged in while all other sessions 401. Profile read/update and
  password change (`/api/profile*`) are `requireUser`-protected the same way;
  the password endpoint reuses per-IP rate limiting to blunt current-password
  brute force. Registration requires a valid invite code (conditional-UPDATE
  decrement prevents concurrent over-issue). Passwords are salted scrypt hashes
  (never plaintext). Keep it minimal — no query-string tokens.
- **Uploads:** validate MIME type and size on upload (images only, hard cap);
  store with generated filenames (never user-supplied names); serve user
  files through the `files` route with correct `Content-Type` and
  `Content-Disposition` to prevent stored-XSS via SVG/HTML.
- **HTML rendering sandbox (important):** agent-generated HTML is rendered without
  any browser. The renderer never executes JS, so scripts are structurally inert
  (the old pre-check/CSP/script-intercept layers are gone). Outbound network is the
  remaining risk: strip every image reference that is not a `data:` URI or a
  whitelisted host **before** inlining `/files/` refs (reversing the order lets a
  stripped URL become an inlined data URI and bypass the gate). Per-render timeout
  is mandatory. Never let agent HTML reach internal network URLs (SSRF) or local
  file paths.
- **Prompt-injection containment:** user-supplied text and file contents are
  untrusted input to the LLM. Tools must validate inputs with zod
  regardless of what the model asks for; the tool registry blocks any tool
  not declared for the active agent.
- **Content compliance:** text-to-image providers perform their own content
  moderation; surface provider rejections to the user verbatim (via the
  agent), and keep an entry-level keyword screen before LLM calls.
- **Admin console (`apps/admin`):** every admin Route Handler must call
  `requireAdmin` (`@oops/auth`, checks `users.role=admin` on top of the
  session) and return structured 401/403 — same discipline as `requireUser`.
  **Every admin write = business write + audit row in the SAME transaction**
  (`admin_audit_log`, who / what / when / before / after); a write path
  without audit is a defect, not a shortcut. Runtime config lives in the
  3-layer chain `app_config overlay → env → catalog defaults` (`@oops/llm`
  runtime-config: 30s TTL cache + in-process generation bump + fail-open on
  overlay read errors); admin writes overlay + bumps, web converges within
  30s. The admin-side agent list is a static convention
  (`apps/admin/src/lib/agent-catalog.ts`) — the web agent registry is not
  importable across processes; adding/removing an agent requires updating
  both (duty note lives in that file).
- **Error handling:** return structured errors to clients; never leak stack
  traces, SQL, or internal paths in responses. Log server-side with request IDs.


