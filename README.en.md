<div align="center">

# 🎨 oops

**Talk your e-commerce imagery into existence — an AI-agent-powered text-to-image workbench**

Describe your needs, upload product assets, pick a design agent, and get product detail pages, posters & scene images.

[简体中文](README.md) · English

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white) ![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-PostgreSQL-C5F74F) ![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white) ![Vitest](https://img.shields.io/badge/Test-Vitest-6E9F18?logo=vitest&logoColor=white) ![License](https://img.shields.io/badge/License-MIT-yellow)

</div>

---

## 📌 5W2H at a Glance

| ❓ Question | 💡 Answer in one line |
| --- | --- |
| 🤔 **What** | AI-agent-powered text-to-image web app for e-commerce: chat your way to product detail pages, posters & scene images |
| 💭 **Why** | E-commerce imagery is slow and costly with human designers — agents turn "10 rounds of revisions" into "1 conversation" |
| 👥 **Who** | E-commerce sellers / operators (no design background), and developers who want plug-and-play AI image agents |
| 🕐 **When** | Bulk imagery before product launch, rapid poster iteration for campaigns, filling in scene shots, A/B variations |
| 🌍 **Where** | In the browser (`/home` landing page + full-screen `/canvas` workbench); self-hosted (Node 22+ / Docker) |
| 🛠️ **How** | `pnpm install` → `docker compose up -d` → configure `.env.local` → `pnpm db:migrate` → `pnpm dev` |
| 💰 **How much** | Pay-as-you-go LLM + image APIs; in-process task limits (image gen ×2 / screenshot ×1–2), zero extra middleware cost |

---

## 🤔 What · What is it?

**oops** is a text-to-image web system for e-commerce customers: describe your needs in a chat box, upload product assets, pick a design agent, and get production-ready images.

- 💬 **Conversation as creation** — streaming SSE chat; the agent asks clarifying questions first, then calls tools to generate
- 🖼️ **Hybrid generation pipeline** —
  - Posters / product-detail long images: agent-generated HTML → server-side Playwright screenshot (pixel-precise text & layout)
  - Atmosphere / scene images: pure text-to-image API (Wanxiang `wan2.7-image`)
- 🤖 **Declarative agents** — each agent is a single config file (system prompt + tool subset); adding one requires **zero code changes**. Ships with "Atmosphere Designer" & "Product Photographer"
- 🧠 **Session memory** — dual-view message persistence + automatic context compaction (compact); long sessions never lose the thread
- 🎨 **Canvas workbench** — results land on a full-screen dotted canvas, placeholder → settled in place, with reference-image reuse, crop / filters / export
- 🗂️ **Task-based execution** — all image work runs through a persisted, concurrency-limited, retryable task queue
- 🌗 **Light & dark themes** — global toggle with no first-paint flicker

> See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture and [docs/PRODUCT_DESIGN.md](docs/PRODUCT_DESIGN.md) for design principles.

## 💭 Why · Why build it?

| Pain point 😫 | oops' answer ✨ |
| --- | --- |
| Endless revision cycles for detail-page layouts | Agents render HTML — text and layout stay pixel-precise |
| Posters / scene images need trial and error | Conversational iteration; results settle in place on canvas, failures retry in one click |
| Design tools have a steep learning curve | Just describe what you want; the agent proactively asks for missing info |
| Assets scattered everywhere, hard to trace | Unified asset store (MinIO / S3), organized by session and lineage |

## 👥 Who · Who is it for?

- 🛒 **E-commerce sellers / operators**: high-volume detail pages, posters, and scene shots without a design team
- 👨‍💻 **Developers**: extend the system with your own design agents — one file is all it takes
- 🏢 **MVP, single deployment, multi-user**: invite-code registration + username/password auth, `userId` isolation on every table, ready to evolve into multi-tenant SaaS

## 🕐 When · When to use it?

- 📦 Before a product launch: bulk-generate detail pages and hero posters
- 🎉 Campaign season: rapid multi-version poster copy / color iterations
- 🌄 Missing scene shots: one sentence generates atmosphere / usage scenarios
- 🔁 Seasonal refresh of existing products: re-generate with the original as a reference image

Tasks run asynchronously (concurrency 2, 90s timeout per task) — close the page freely, results are persisted.

## 🌍 Where · Where does it run?

- 🖥️ **Browser**: `http://localhost:3000`
  - `/home` — landing page (creation composer + agent card entries)
  - `/canvas` — full-screen AI canvas workbench (floating chat panel + dotted canvas)
- ☁️ **Deployment**: any host running Node.js 22+ (Chromium needed for screenshot rendering); requires Postgres + MinIO (S3-compatible), both provisioned by `docker-compose.yaml`

## 🛠️ How · How to run it?

```bash
# 1️⃣ Install dependencies
pnpm install

# 2️⃣ Start local infrastructure (PostgreSQL + MinIO, bucket auto-created)
docker compose up -d

# 3️⃣ Configure environment (database / MinIO / LLM & image API keys)
cp .env.example .env.local

# 4️⃣ Initialize the database
pnpm db:migrate

# 5️⃣ Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), register (invite code required) → log in → pick an agent → start chatting.

**Handy commands** 🧰

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build / start |
| `pnpm lint` | ESLint (incl. layer-boundary rules) |
| `pnpm typecheck` | Strict TypeScript check |
| `pnpm test` | Vitest unit tests |
| `pnpm db:generate` | Generate Drizzle migrations |

> Before committing, make sure this passes: `pnpm lint && pnpm typecheck && pnpm test`

## 💰 How much · What does it cost?

- 🔑 **API costs**: text LLM (Qwen Token Plan) + image API (Wanxiang `wan2.7-image`), pay as you go; the agent "asks before guessing" to avoid wasted generation quota
- ⚙️ **Compute**: single in-process task executor (image gen ×2, screenshots ×1–2, 90s timeout) — no Redis / MQ required; swappable for BullMQ later
- 🧑‍💻 **Extension cost**: a new design agent = 1 definition file + 1 prompt Markdown, zero frontend changes
- ✅ **Quality bar**: every change must pass lint + typecheck + test

---

<div align="center">

📝 License [MIT](LICENSE) · Made with ❤️ for e-commerce sellers

</div>
