# oops Design System

> **Part A is a style reference (read it for tone). Part B is the executable spec (write code against it only).**
> Mixing the two in one file was this document's biggest flaw: once a reference is mistaken for a spec, the code drifts.

Principles and rulings live in [PRODUCT_DESIGN.md](./PRODUCT_DESIGN.md). This file answers only "what does it look like and which values do we use" — never "why we designed it that way".

**Status legend**: `[shipped]` the value already exists in code · `[proposed]` decided here, not yet landed in `globals.css` / components

---

# Part A · Style Reference (Canva Observations)

Canva is the friendliest face in design tooling: Adobe looks professional and forbidding, Canva looks like an invitation. Its techniques are worth borrowing — but **its color values must not be copied verbatim** (see the contrast warnings in A2).

## A1. Character

- A clean light canvas plus one violet→cyan brand gradient, reserved for the brand mark, the primary CTA, and "magic" moments.
- Generous padding, softly rounded edges, cool-toned shadows that deepen on hover.
- Hierarchy carried mainly by **weight contrast** rather than color contrast.
- Iconography speaking the same shape language as the UI.
- An "ultra-soft" shape system: small radii on cards, larger on panels, pills for chips.

**Take these three**: ① oversized radii + pills; ② gradient primary CTA; ③ a Chinese display face with personality for hero titles (we already own one: Smiley Sans).
**Skip this one**: the weight-contrast strategy. Most Chinese display faces ship a single weight, so this needs a different answer (see B3.2).

## A2. Reference Palette

| Role | Value | Note |
| --- | --- | --- |
| Canva Purple | `#7d2ae8` | Brand primary, gradient origin |
| Canva Cyan | `#00c4cc` | Brand secondary, gradient terminus |
| Canva Pink | `#ff5757` | Tertiary sparkle. ⚠️ Nearly identical to the error color — never reuse it semantically |
| Canvas / Surface Subtle / Surface Inset | `#ffffff` / `#f4f5f7` / `#e8eaed` | Page base / section break / disabled block |
| Ink Primary → Faint | `#0e1318` → `#9aa0a6` | Four text levels |
| Success / Warning / Error / Info | `#00b894` / `#ffb020` / `#ff5757` / `#0d99ff` | Semantic four |
| Category accents Coral / Tangerine / Mint / Sky / Lavender | `#ff7059` `#ff9633` `#48c997` `#3ea6ff` `#9b87f5` | Template tags |

> ⚠️ **Contrast warnings (measured WCAG ratios)**: white on `#00c4cc` is only **2.15:1**; `#9aa0a6` as body text is **2.64:1**; Coral as text is **2.72:1**. Most of this palette is therefore **fill- and decoration-only; it cannot carry text**. That is the single most substantive correction in this rewrite.

## A3. Reference Typography & Shape

- Canva Sans (geometric sans, Airbnb/Asana lineage) with 'YS Text' fallback — **neither is available to us; do not reference them as if it were.**
- Hero 64/800, H1 36/700, H2 24/700, H3 18/600, body 16/400, caption 12/500.
- Buttons at 8px radius with `0 2px 8px rgba(0,0,0,.06)`, deepening on hover.
- Cards at 12px radius, `translateY(-2px)` plus a deeper shadow on hover.
- Motion 180ms (hover) / 280ms (menu) / 420ms (sidebar collapse), `cubic-bezier(0.4,0,0.2,1)`.
- 4px spacing base, 1320px container.

## A4. Known Divergence From oops Reality (Do Not Copy Section A)

| Reference says | oops reality | Resolution |
| --- | --- | --- |
| Icons must be filled, never outlined | `lucide-react` outlined icons throughout | **Change the rule**, not the icon library (B9) |
| Light canvas only | The app is **dark by default** | Add a dark-theme chapter (B2.7) |
| 8px buttons / 12px cards | `--radius: 0.625rem` (10px) + 7 derived steps | Align to the existing scale; never run a second one (B4) |
| Motion 180/280/420ms | PRODUCT_DESIGN Principle 5 mandates a single 200ms rhythm | Baseline becomes 200ms (B6) |
| 1320px container | `/home` is 768px, `/canvas` is full-bleed | Specify per surface (B7) |
| Pro / Magic moments | **oops has no Pro tier and no Magic Studio** | Delete outright — a design system must not describe products that do not exist |
| 5 category accents | 2 built-in agents today | Reduce to 3, and render as dots rather than colored fills (B7.5) |
| No admin app | `apps/admin` uses antd, no Tailwind | Add a token mapping (B7.6) |

---

# Part B · The oops Design System (Executable Spec)

## B0. How to Use This Document

1. **This file is the single source of truth for design tokens.** Hardcoded colors, radii, or durations in components are forbidden. Add the value to B1 first, land it as a token in `globals.css`, then reference it.
2. **Four token layers. A brand change only touches layers 1 and 3.**
3. Light is the **default** theme (2026-10: flipped from dark per product decision). Anything that "only works in one mode" is a defect — `openspec/specs/app-theme/spec.md` mandates both themes.
4. When code and this document disagree, code wins — but then either fix the code or come back and fix this file. Permanent divergence is not allowed.

## B1. Token Layers & Naming

```
Layer 1  primitive   --brand-violet-500 / --brand-cyan-600 / --brand-ink-800    raw ramps; business code must not import these
Layer 2  semantic    --primary / --ring / --border / --muted…  the existing shadcn layer; change values, not names
Layer 3  brand       --brand-gradient / --brand-blob-*        brand-only; decoration and emphasis
Layer 4  component   --radius-* / --shadow-* / --duration-*     shape, elevation, motion; shared app-wide
```

Why this matters: **a brand change = edit layers 1 and 3.** Semantic names like `--primary` never move, so component code stays untouched. That property is what makes this document authoritative rather than decorative.

## B2. Color

### B2.1 Brand Ramps (Primitive) `[shipped — apps/web/src/app/globals.css :root，守卫 globals.tokens.test.ts]`

> **Naming rule: every brand ramp carries the `--brand-` prefix.** Tailwind v4 already ships built-in scales — `--color-violet-500: #8d54ff`, `--color-cyan-500`, and so on — which power utilities like `bg-violet-500`. Unprefixed `--violet-500` would sit one character away from a *different* purple that renders on the very same screen. The prefix makes that collision physically impossible, and it also keeps layers 1 and 3 reading as one family. **Never write `bg-violet-500` expecting brand color**; use `var(--brand-violet-500)`.

Violet — brand primary; carries "primary action".

| Token | Value | Use |
| --- | --- | --- |
| `--brand-violet-50` | `#f6f0fe` | Tint surface |
| `--brand-violet-100` | `#ece0fd` | Blob / hover surface |
| `--brand-violet-300` | `#c09df8` | Borders, disabled |
| `--brand-violet-500` | `#7d2ae8` | **Base primary**: primary CTA, active state, gradient origin |
| `--brand-violet-600` | `#6a1fd0` | Primary hover |
| `--brand-violet-700` | `#571aab` | Text on violet, secondary emphasis |

Cyan — brand secondary; **atmosphere and focus only**.

| Token | Value | Use |
| --- | --- | --- |
| `--brand-cyan-50` | `#e6f9fa` | Tint surface |
| `--brand-cyan-100` | `#c4f0f2` | Blob |
| `--brand-cyan-500` | `#00c4cc` | Gradient terminus, large decorative fills. **Never carries text** |
| `--brand-cyan-600` | `#009aa2` | Borders, large text (≥24px/600) |
| `--brand-cyan-700` | `#007a81` | **Cyan text step**: 5.1:1 with white ✓ |

Bridge blue — gradient midpoint so violet→cyan does not pass through mud: `--brand-blue-500: #4a5cf0`.

### B2.2 Neutral Ramp — Cool Gray with a Whisper of Violet `[shipped — 同上]`

Once the brand hue is chromatic, the grays must lean cool too, or the whole UI reads dirty.

| Token | Value | Typical role |
| --- | --- | --- |
| `--brand-ink-950` | `#0d0c12` | Dark page background (today `#0b0b0d`, plus a faint violet cast) |
| `--brand-ink-900` | `#16151d` | Dark surface / card |
| `--brand-ink-850` | `#1d1c26` | Dark raised surface |
| `--brand-ink-800` | `#262430` | Dark border |
| `--brand-ink-700` | `#3a3846` | Dark divider, hover fill |
| `--brand-ink-600` | `#565469` | Light secondary text |
| `--brand-ink-500` | `#77748a` | Dark secondary text — **实测 4.31:1 on `--brand-ink-950`（卡片上 4.01），不达 AA；语义层暗色 muted-foreground 已改映射 `--brand-ink-400`（B2.7），本档勿再作正文字色** |
| `--brand-ink-400` | `#9b98ad` | Disabled text on light |
| `--brand-ink-300` | `#c3c0cf` | Strong light border |
| `--brand-ink-200` | `#e2e0ea` | Light border |
| `--brand-ink-100` | `#eeecf4` | Light hover fill |
| `--brand-ink-50` | `#f7f6fa` | Light section background |
| `--white` | `#ffffff` | Light page / card |

Light-mode primary text is `--brand-ink-900` (`#16151d`, 15.9:1 on white) — **not pure black**.

### B2.3 Semantic Colors — Decoupled From the Brand `[partially shipped — web 保留 --destructive；--success/--warning/--info 目前只活在 admin ANTD_THEME_TOKEN，web 侧 token 未落]`

**Rule: semantic hues (green / amber / red / blue) must not overlap brand hues (violet / cyan). Red always means "error or danger" and never brand decoration.** Section A's `#ff5757` serving as both a brand sparkle and the error color is exactly the coupling we are cutting.

| Token | Value | Use |
| --- | --- | --- |
| `--success` | `#00b894` | Saved, exported |
| `--warning` | `#ffb020` | Quota advisories |
| `--destructive` | `#e5484d` | Failure, destructive actions (**keeps today's hue**; we are only removing it from the brand palette) |
| `--info` | `#0d99ff` | Tips, links |

Coral `#ff7059` is demoted to a **decoration-only third color**: large fills and illustrations on the landing page. Never text, never status, never a button fill.

### B2.4 Contrast Table (WCAG, measured — re-verified 2026-10-15, change add-landing-page 任务 3.3)

| Foreground | Background | Ratio | Verdict |
| --- | --- | --- | --- |
| white | `--brand-violet-500` `#7d2ae8` | 6.23:1 | ✓ body and large text |
| white | `--brand-violet-600` `#6a1fd0` | 7.72:1 | ✓ hover state |
| white | `--brand-cyan-500` `#00c4cc` | 2.15:1 | ✗ decoration only, never text |
| white | `--brand-cyan-600` `#009aa2` | 3.42:1 | △ large text / graphics only |
| white | `--brand-cyan-700` `#007a81` | 5.12:1 | ✓ the cyan text step |
| white | `--destructive` `#e5484d` | 3.91:1 | △ button labels need ≥16px/600, or drop to a `--destructive-700` |
| `--brand-ink-900` | white | 18.12:1 | ✓ |
| `--brand-ink-600` | white | 7.32:1 | ✓ secondary text |
| `--brand-ink-500` | white | 4.52:1 | ✓ secondary text on light |
| reference `#9aa0a6` | white | 2.64:1 | ✗ borders and placeholder blocks only |
| white | `--brand-blue-500`（渐变中点） | 5.15:1 | ✓ 渐变 CTA 白字全程 ≥5.12 |

**Hard rule that falls out of this table**: the light end of a gradient must be darkened. A white label on `#7d2ae8 → #00c4cc` **fails AA**. Either terminate at `--brand-cyan-700` (~4.4–5.1:1) or set the label at ≥16px/600 and claim the large-text threshold.

### B2.5 Brand Tokens `[shipped — globals.css :root + @utility，禁裸 hex 由守卫测试断言]`

```
--brand-gradient        linear-gradient(135deg, var(--brand-violet-500) 0%, var(--brand-blue-500) 52%, var(--brand-cyan-700) 100%)   — token composition only; raw hex in the gradient is forbidden
--brand-gradient-text   same, with background-clip:text (landing hero titles only)
--brand-blob-1/2/3      var(--brand-violet-100) / var(--brand-cyan-100) / var(--brand-blue-500) — the blue is consumed at 12% alpha at the use site   (organic landing background shapes)
--brand-shadow          0 2px 8px rgb(125 42 232 / .20); hover 0 4px 14px / .28
```

Gradients are allowed in exactly four places: the primary CTA, the brand mark, landing hero title text, and the low-opacity shimmer inside a generation placeholder.

### B2.6 Zoning Rule — Brand Color Enters Chrome, Never the Stage

The rule most likely to be bypassed, and the most important one here.

```
/canvas
├─ chrome  (sidebar, panels, tabs, buttons, focus ring, selection)   <- brand color ALLOWED
└─ stage   (dot grid, images, image shadows, zoom levels)           <- brand color FORBIDDEN

/design
├─ editor chrome                                                  <- ALLOWED
└─ document content colors belong to the user's artwork           <- OUT OF SCOPE (not chrome)

/  /login  /register
└─ full brand: paper surface + blobs + gradient CTA + gradient hero title
```

**Why**: the deliverable is a product image. Any chromatic UI inside the image area gets misread as part of the image. This directly contradicts Principle 3 ("quality is the floor") and Principle 5 ("visual serves content"). Coloring the interaction layer costs the content nothing and still gives clear affordances on a dark UI.

### B2.7 Light / Dark Theme Mapping

| Role | Light | Dark |
| --- | --- | --- |
| Page background | `--brand-ink-50` / white | `--brand-ink-950` |
| Card / panel | white | `--brand-ink-900` |
| Primary text | `--brand-ink-900` | white |
| Secondary text | `--brand-ink-600` | `--brand-ink-400`（偏离 B2.2 的 ink-500 建议：实测 4.31:1 不达 AA，3.3 修正） |
| Border | `--brand-ink-200` | `--brand-ink-800` |
| Primary CTA | violet gradient (both ends darkened per B2.4) | same hues, +5% lightness |
| Brand colors | same hues as dark — **no desaturation** | same |

The landing page is light-only by design (marketing pages do not need a dark mode), but `/login` and `/register` are bound by `openspec/specs/app-theme/spec.md` and must stay legible in both.

### B2.8 Brand Mark `[proposed — asset does not exist yet]`

**Status: there is no brand mark in the repo.** `apps/web/public/` still holds the untouched Next.js scaffold (`file` / `globe` / `next` / `vercel` / `window` `.svg`), and `favicon.ico` is the default file. Until this ships, no landing work may assume a logo exists — the wordmark below is the fallback.

| Property | Rule |
| --- | --- |
| Wordmark | Lowercase `oops` in `--font-display`, `--brand-ink-900` on light / white on dark |
| Glyph mark (optional) | 24–32px, `--brand-gradient` fill inside a `--radius-lg` container. May be omitted — the wordmark alone is a complete brand mark |
| Clear space | ≥ the wordmark's x-height on all sides |
| Nav usage | Wordmark only; never the gradient fill at nav size |
| Favicon | 32×32 mark on `--brand-ink-950`; must stay readable at 16px |
| OG image | 1200×630; wordmark plus a one-line value prop, `--brand-ink-50` ground, gradient accent bar |

Rules:

- The wordmark never carries the gradient below 24px — gradient text loses per-glyph contrast at small sizes.
- Never place the mark on a fill of the same gradient hues.
- The mark is decorative on the landing page and must never be a section's only visual anchor.

## B3. Typography

### B3.1 Three Families

| Token | Family | Role | Status |
| --- | --- | --- | --- |
| `--font-display` | `Smiley Sans` (得意黑, self-hosted oblique) | Landing hero titles, oversized numerals, brand lines | ✓ in repo |
| `--font-sans` | `Geist` + `PingFang SC` / `Microsoft YaHei` fallbacks | All body copy and UI | ⚠️ see B3.3 |
| `--font-editorial` | `LXGW WenKai` | **Editor-canvas documents only** | ✓ in repo |
| `--font-mono` | Geist Mono | Debug panels | ✓ |

Smiley Sans is effectively Canva Bold's Chinese counterpart — the cheapest, highest-yield move in "adopting the Canva look": no new font procurement, and the hero tone lands immediately.

### B3.2 Type Scale `[proposed]`

| Role | Family | Size | Line height | Tracking | Notes |
| --- | --- | --- | --- | --- | --- |
| Display | display | `clamp(40px, 6vw, 64px)` | 1.05 | -0.02em | Landing hero |
| H1 | display | 36px | 1.15 | -0.01em | Page title |
| H2 | sans | 24px | 1.25 | -0.005em | Section heading |
| H3 | sans | 18px | 1.3 | 0 | Card title |
| Body Large | sans | 16px | 1.6 | 0 | Marketing prose, landing lede |
| Body | sans | 14px | 1.55 | 0 | Workbench UI prose (dense areas) |
| Caption | sans | 12px | 1.45 | 0.005em | Hints, metadata |
| Mono | mono | 12px | 1.5 | 0 | Debug only |

> **Consequence**: Smiley Sans ships a single 400 weight, so **Chinese display headings cannot be leveled by weight** — Canva's 800/700 strategy simply does not exist on the Chinese side. Hierarchy is carried by size + tracking + color depth instead.

### B3.3 Font Loading Chain (Currently Broken — Fix Before Anything Else)

`globals.css` declares `--font-sans: var(--font-sans)` inside `@theme inline` — a **self-reference** — while `layout.tsx` only injects `--font-geist-sans` and `--font-geist-mono`. A self-referencing custom property is invalid at computed-value time, so `font-family` falls back to the browser's initial serif: **Latin text is most likely not rendering in Geist at all** today (CJK survives only through per-glyph fallback).

Minimal fix: repoint the theme token at the variable that actually exists.

```css
@theme inline {
- --font-sans: var(--font-sans);
+ --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-sans);
}
```

**Do not "fix" this by renaming the Geist variable in `layout.tsx` to `--font-sans`.** That variable is not dead: `apps/web/src/lib/design/fonts.ts` offers `var(--font-geist-sans)` as a *selectable canvas font* in the design editor, and `apps/web/src/lib/design/catalog.test.ts` asserts on that literal string. Renaming would break the editor's font list and turn that test red. Repointing touches one line and breaks nothing.

**Verified against the build output (2026-10-13)**: `--font-sans: var(--font-sans)` is the *only* declaration of that variable in the entire compiled CSS, and `@apply font-sans` compiles to `html { font-family: var(--font-sans) }` with no fallback. A self-reference is invalid at computed-value time, so `font-family` computes to `unset`; because the property is inherited and `html` has no parent, it lands on the **initial value — the browser default serif**. Latin text renders in a serif face today. Tailwind's preflight fallback `var(--default-font-family, -apple-system, ... sans-serif)` does *not* rescue it, because `--default-font-family` is *defined* (albeit invalidly) and `var()` only falls back when a property is absent. The repoint repairs that chain at the same time.

**Also missing: the `--font-display` token.** `globals.css` has an `@font-face` for Smiley Sans but no `--font-display` mapping — only `--font-heading: var(--font-sans)`. The landing hero (B7.1.4) depends on it, so creating it belongs to the token baseline task.

## B4. Shape (Radius)

**Reuse the existing scale; never start a second one** `[proposed: two additions only]`

```
--radius-sm    6px     (existing 0.6 step)
--radius-md    8px     (existing 0.8)
--radius-lg   10px     base --radius: 0.625rem
--radius-xl   14px     (existing 1.4)
--radius-2xl  18px     (existing 1.8)
--radius-3xl  22px     (existing 2.2)
--radius-4xl  26px     (existing 2.6)
--radius-media 28px    [new] landing media blocks
--radius-pill  999px   [new] chips and pill buttons
```

The derivation formula is untouched, which avoids a global visual regression; we only append `media` and `pill` to carry Canva's ultra-soft geometry. Buttons default to `--radius-lg`, not 8px — 8px is a discontinuity against the current ramp.

## B5. Elevation `[proposed]`

| Token | Value | Use |
| --- | --- | --- |
| `--shadow-1` | `0 1px 2px rgb(13 12 18 / .06)` | Card at rest |
| `--shadow-2` | `0 4px 12px rgb(13 12 18 / .08)` | Card hover, with `translateY(-2px)` |
| `--shadow-pop` | `0 8px 24px rgb(13 12 18 / .12)` | Popovers, floating panels |
| `--shadow-brand` | see B2.5 | Primary CTA |

**Shadows are effectively invisible in the dark theme.** Hierarchy there must be expressed through surface lightening plus an `--brand-ink-800` hairline. Anything that currently relies on a shadow for hierarchy needs a dark-mode alternative.

## B6. Motion `[proposed]`

```
--duration-fast  120ms   micro-feedback (hover color, icon nudge)
--duration-base  200ms   baseline — Principle 5 mandates "a single 200ms motion rhythm"
--duration-slow  320ms   large translation, panel expansion
--ease-standard  cubic-bezier(0.2, 0, 0, 1)
--ease-exit      cubic-bezier(0.4, 0, 1, 1)
--ease-back      cubic-bezier(0.34, 1.56, 0.64, 1)   CTA hover only
```

Constraints:

- Outside the generation shimmer, workbench motion has exactly three durations: 120 / 200 / 320. A fourth is a defect.
- Under `prefers-reduced-motion: reduce`, everything degrades to opacity-only; all translation and bounce is removed.
- Section A's "no animation on magic moments" is **not** adopted: we want an unmistakable sense of progress (Principle 2 — waiting must be transparent). But every looping animation needs a **static readable equivalent**.

## B7. Per-Surface Rules

### B7.1 Landing Page `/` (marketing)

#### B7.1.1 Section Inventory & Order

The order is fixed. Adding a section means removing one (Principle 1).

| # | Section | Job | Primary CTA |
| --- | --- | --- | --- |
| 1 | Nav | Orientation + register / login | "Start free" |
| 2 | Hero | The value proposition in one sentence | gradient pill |
| 3 | Product slice | Prove the differentiator: chat in, shippable image out | none — it is proof, not pitch |
| 4 | Agents | Three specialists and when to pick each | none |
| 5 | How it works | Speak → Agent generates → ship | secondary |
| 6 | Comparison | "Ten revision rounds" vs "one conversation" | none |
| 7 | FAQ | Objections, including an honest statement of limits | secondary |
| 8 | Closing CTA + footer | Final conversion + legal / meta | gradient pill |

- Exactly **one** gradient CTA is visible per viewport. The closing section repeats that CTA; it never introduces a second one.
- Section 3 outranks section 4: if the product slice is missing, no amount of illustration substitutes for it.
- No section may advertise a capability the product cannot actually perform (anti-pattern 11).

#### B7.1.2 Grid & Breakpoints

| Breakpoint | Container | Columns | Gutter | Section spacing |
| --- | --- | --- | --- | --- |
| >=1280px | 1200px centered | 12 | 32px | 128px |
| 1024–1279px | fluid, 32px margin | 12 | 24px | 96px |
| 768–1023px | fluid, 24px margin | 8 | 24px | 72px |
| <768px | fluid, 20px margin | 4 | 16px | 56px |

- CSS Grid only. No horizontal carousels, no scroll-snap sections.
- Text blocks cap at 32ch (B3.4) regardless of the column they sit in.
- Alignment is **asymmetric by default** — prefer a 7/5 or 8/4 split over 6/6.
- Below 768px every multi-column block collapses to one stack ordered by importance, which is not always DOM order.

#### B7.1.3 Background Blobs

A reproducible method, so blobs read as one family instead of three one-offs:

```
shape    border-radius: 58% 42% 38% 62% / 46% 52% 48% 54%   (asymmetric on both axes)
rotate   multiples of 15deg only — never a free angle
size     320–720px desktop, 180–320px mobile
fill    --brand-blob-1 / -2 / -3   (violet-100 / cyan-100 / #4a5cf0 @ 12%, i.e. the two tint steps plus a 12%-alpha blue)
filter   blur(60–90px); no border, no shadow
motion   none — blobs are static; movement here competes with the hero
stacking behind all content, pointer-events: none, never over text
```

Rules: at most 3 blobs per viewport; never under body text (contrast), only behind imagery or empty space; no geometric grid or dot pattern substitutes.

#### B7.1.4 Hero

| Element | Spec |
| --- | --- |
| Eyebrow | Body Small, `--brand-ink-600`, single line, never gradient |
| Headline | `--font-display`, per-locale clamp (B3.4), `--brand-gradient-text`, `text-wrap: balance`, within the line budget |
| Sub | Body Large, `--brand-ink-600`, max 32ch |
| Primary CTA | gradient pill, `--radius-pill`, 48px height, `--ease-back` lift on hover |
| Secondary CTA | white pill, 1px `--brand-ink-200` border, no fill |
| Proof | The product slice (B7.1.5) — never decorative illustration |
| Height | Content-driven, `min-height: 70vh` at >=1024px only. Never force a full viewport: a hero that must scroll hides its own CTA |

#### B7.1.5 Product Slice (the proof asset)

- Two frames: a chat bubble holding the user's own sentence, and the resulting image card. Real product UI, cropped — not a mockup.
- 4:3, max width 560px, `--radius-media`, `--shadow-2`.
- The bubble text is a real runnable prompt; the image is a real output. No lorem, no stock photography.
- Frames sit side by side with a 32px gap and a 24px `--radius-pill` arrow between them; stacked with 48px spacing on mobile.
- Never animate the two frames swapping. A 320ms crossfade is the ceiling.

#### B7.1.6 Media & Image Requirements

| Slot | Ratio | Sizes | Format | Notes |
| --- | --- | --- | --- | --- |
| Hero product slice | 4:3 | 560 / 1120 | webp | priority loaded, `sizes` set |
| Agent samples (3) | 1:1 | 320 / 640 | webp | one per built-in agent |
| Workflow step icons | 1:1 | 64 | svg | stroke 2, `--brand-ink-700` |
| OG image | 1200×630 | — | png | see B2.8 |
| Favicon | 32×32 | — | ico / png | see B2.8 |

- Every image declares `width`/`height` or `aspect-ratio`. Layout shift is a conversion leak.
- Samples must match what the shipped agent actually produces; overstating capability is forbidden.
- All marketing images live under `public/` and must not be served from `/files/*`, which is authenticated.
- `alt` is mandatory and describes what the image shows — never "image" or "示例".

#### B7.1.7 Nav & Footer

| Element | Spec |
| --- | --- |
| Nav height | 64px desktop / 56px mobile, sticky |
| Nav background | `--brand-ink-50` at 80% with backdrop blur once scrolled; transparent at the top |
| Nav contents | Wordmark (B2.8) · up to 4 links · locale toggle · "Log in" text button · "Start free" gradient pill |
| Nav links | `Body` size, no dropdowns, no mega-menu |
| Footer | `--brand-ink-950` ground, `--brand-ink-50` at 70% opacity, at most 3 columns (product / company / legal) |
| Legal line | States terms and privacy honestly, including when those pages do not exist yet. A dead "Privacy Policy" link is forbidden |

#### B7.1.8 Conversion Path

| Stage | Action |
| --- | --- |
| Primary | "Start free" → `/register` (invite code required) |
| Secondary | "Log in" → `/login` |
| Already authenticated | `/` redirects to `/home` — the marketing page never interrupts a signed-in user |

#### B7.1.9 Motion & Reduced Motion

- Landing uses `--duration-base` 200ms for hover and entrances, plus one `--duration-slow` 320ms crossfade on the product slice.
- Entrances are a single 12px rise + fade, staggered at most 80ms, capped at six elements. No count-up numbers, no parallax, no scroll-jacking.
- Under `prefers-reduced-motion: reduce`, entrances become instant and the crossfade becomes a hard cut. Blobs stay — they do not move anyway.
- No looping animation anywhere on the landing page, hero included.

### B7.2 Application Sidebar `/home` (resident rail + adjacent panel)

Implementation: `apps/web/src/components/layout/home-sidebar.tsx` (presentation + open-panel state) + `apps/web/src/lib/layout/use-sidebar-layout.ts` (narrow-viewport sheet + the disclosure shortcut).

Reference measurement (Canva projects page, 1440x900, live DOM, 2026-10-19): rail **64px**, item 64x52; panel **264px**, row 40px; the panel is a **push column** — with it open the main area goes 1121px to 857px, and closing restores it; clicking an L1 opens that section's panel and lands on its first L2; clicking the same L1 again does **not** collapse it; clicking a different L1 collapses it.

Information architecture — **L1 is a destination that also opens its panel**:

| L1 | Navigates to | L2 (panel only) |
| --- | --- | --- |
| 首页 | the landing view, collapsing the panel | — (leaf) |
| 创作 | *(no in-page default)* | AI 画布 · 排版设计 (size dialog to `/design?w=&h=`) |
| 图库 | 作品集 (main-area view) | 作品集 · 素材库 (placeholder, disabled) |

Each group's **default child is declared in the data** (`primaryId`), never inferred from array order — a reorder must not silently change where 创作 leads.

- **The panel is a sibling, not an overlay.** It occupies layout width and squeezes the main area; it never floats above the main content. Three consequences worth keeping:
  - **L2 never shares the column.** Affiliation is structural (column vs adjacent column) rather than an indent. The earlier same-column variant proved the indent route cannot carry it: `pl-4` inside an `items-center` flex container yields an 8px shift, and brand-hued children read as one violet slab.
  - **The panel opens on L1 activation, not on a per-row control.** There is **no chevron and no second target per row** — a row with two activatable targets reads as one control to a screen reader, and the reference implementation has no such control. Activating 首页 has no panel to open, so it collapses the current one.
- **The panel's global open/close lives in a linear switch at the top of the rail**, beside the wordmark, measured on the reference as a 36×36 button labelled 「切换侧边导航栏」 (toggling the main area 1361px ↔ 1097px). It carries `aria-expanded` + `aria-controls`; reopening restores the group that was open last. It shares one `togglePanel()` with `Cmd/Ctrl+B`, so the two never diverge. Below 768px it disappears — there is no resident panel to toggle.
  - **The bell is the only entry to 消息中心**, a main-area view like 作品集 with no nav row; the bell carries `aria-current` while that view is up.

**Landing on the default child happens only in-page.** Activating 图库 switches the main area to 作品集; activating 创作 opens the panel and **stays put**. Reason: 创作's first L2 (AI 画布) is a full-page route that carries no app sidebar, so auto-navigating would remove the panel the user just opened — and they could never reach 排版设计. The rule is uniform, not a special case: *apply the default child's effect **within the current page**; a whole-page destination waits for an explicit click.* Hence L1 rows are plain buttons, not links.

#### B7.2.1 Width

| Token | Value | Use |
| --- | --- | --- |
| `--spacing-sidebar-rail` | 64px | the resident L1 column → `w-sidebar-rail` |
| `--spacing-sidebar-drawer` | 264px | the L2 panel and the narrow-viewport sheet → `w-sidebar-drawer` |

Declared in `@theme inline` under Tailwind's spacing namespace, **never in `:root`**: `:root`'s semantic layer is mirrored verbatim by `.landing-root`, and the token guard in `globals.tokens.test.ts` turns red on any divergence. A width token added to `:root` alone breaks that mirror.

The rail is a **constant** — there is no collapsed state, so there is no second geometry to keep in sync. The panel shares one width token with the narrow sheet: both are "the second column", and a sheet narrower than 264px would truncate four-character labels.

#### B7.2.2 Nav Item Geometry

| Element | Spec |
| --- | --- |
| Rail target | `w-full` column in the rail's 56px content box: 32px squircle tile (`--radius-lg`) holding a 16px icon, `py-1`, label `text-[11px]/leading-tight` below, `whitespace-nowrap`. About 58px tall |
| Panel item | horizontal row, `h-10` (40px), `px-3`, `gap-2`: 14px icon in a 24px box + `text-[13px]` label |
| Narrow sheet | the same horizontal row component; children indent with `ml-4` (margin, not padding — padding inside an `items-center` row reads as half its value) |
| Group separator | a centered 32px (`w-8`) `--brand-ink-200` hairline with 8px clearance above and below, **between the two groups only** |
| Rail top | the panel switch only (`size-7` icon button, `PanelLeftOpen`/`PanelLeftClose`) — **no wordmark, no version**: a 64px column cannot hold them, and the reference puts its brand at the top of the panel |
| Panel top | wordmark `oops` + the build-version badge (`text-[11px] tabular-nums`), `px-3 py-3` |
| Footer | hairline above, then a **vertical** stack of two controls — bell above, avatar below (`gap-1`). Theme, locale and settings moved into the user menu |

- **The chevron is gone entirely** — not moved, not restyled. It only made sense while a row had two targets; with one target per row there is nothing to expand *from*, and a decorative affordance on a non-interactive element is worse than none.
- **The hairline is load-bearing, not decoration.** An 11px centered gray label is nearly the same shape as a nav label, so without a rule between them 创作 and 图库 read as one undifferentiated list. It sits *between* groups only.

#### B7.2.2a Vertical Budget

The rail has no page to scroll, so the nav either fits or the user loses the current-location anchor to a scroll. There is only **one** state to budget (the panel is a separate column with its own height), at a **565px** viewport (a short window — the case that actually broke):

| Region | Rail |
| --- | --- |
| Container padding | 16 |
| Rail top | 36 |
| Nav content | 189 |
| Footer | 77 |
| **Total** | **318** |

Derivation, so a reviewer can re-check it without a browser:

- Rail target = `8 (py-1) + 32 (tile) + 4 (gap) + 14 (label) = 58`.
- Nav = 首页 `58` + `2` gap + 创作 `58` + `2` gap + hairline `17 (1 + 8 + 8)` + 图库 `58` = **195**.
- Footer = `8 (pt-2) + 1 (border) + 32 (bell) + 4 (gap-1) + 32 (avatar size-8)` = **77** — a column stacks, so the rail can afford it.
- Rail top = `28 (size-7 button) + 8 (pb-2)` = **36**; the version badge used to sit here and now lives in the user menu.

Moving L2 out of the rail is what bought the headroom. **Overflow is the fallback, never the default**: if a change pushes the total past the viewport, shrink a region rather than adding scroll. Never solve a height problem with `overflow-y-auto` alone — closing the panel returns focus to the nav row, and the browser's `block:'nearest'` scroll then pushes 首页 out of view, so the user cannot see where they are.

#### B7.2.3 Color Hierarchy

| State | Fill | Glyph |
| --- | --- | --- |
| Current rail item | `bg-primary` tile | `text-primary-foreground` (the 6.2:1 pair from B2.4) |
| Current panel item | full-row `bg-primary/10` pill | `text-primary` + `font-medium` |
| Any other item | transparent, `hover:bg-accent/60` | `text-muted-foreground` |
| Disabled | 40% opacity, no hover feedback | `cursor-not-allowed` |

**Hue marks the current location and nothing else.** The earlier group hue (violet 创作 / neutral 图库) existed to separate siblings inside one column; grouping is now expressed by structure (two adjacent columns), so tinting sibling L1 items is noise — and the panel sits flush against the rail, where a hue difference would assert a relationship that no longer exists. This also settles a code/doc conflict: the implementation gave 创作's children `brand` while this section specified the opposite.

The two fills never overlap: the L1 that stands in for a hidden current child shows the filled tile, while an open panel marks the child itself.

#### B7.2.4 One Component, One Width

A single nav item component per orientation (rail column, panel row) serves every L1 and L2 row, so hierarchy is expressed by **placement** — which column the row lives in — never by a second item geometry or an indent. Consequences:

- The rail has no width transition, so per-item re-layout during an animation is impossible.
- The rail **keeps its text labels**. Two CJK glyphs at 11px occupy about 22px inside a 56px target, so the visible text equals the `aria-label`, leaving no tooltip-only accessibility gap.
- **Two distinct indicators, never one.** The filled tile marks the current **section** (whichever L1 the user last activated — decoupled from the main view, see below); `aria-current="page"` marks the **deepest selected item**, and **exactly one nav row carries it at a time** (rail L1 and panel L2 counted together). Selecting 创作 therefore lights its tile while `aria-current` sits on 作布内的 AI 画布 — which is what the reference does when both its rail item and 所有项盈亮. When the panel is collapsed its items leave the accessibility tree (`inert` + `aria-hidden`), so the **L1 takes the mark over** — otherwise collapsing the panel would erase the current-location anchor this document keeps insisting on.
- **The current section is state, not a derivation of the main view.** Clicking 创作 selects its default child (AI 画布) while the main area stays on the landing page, because that child is a whole-page route with no in-page form. Deriving the highlight from the view alone would leave 创作 dark — the exact bug that made the rail look broken. The panel renders a second `<nav>` landmark with its own label (`{group}的二级导航`) rather than an anonymous region.
- The **footer** is the one region that differs from the old panel: the rail has room for a column, so it keeps only bell · avatar and preferences moved into the user menu.
- The nav scrolls only when the budget in B7.2.2a is exceeded, and its scrollbar is the `sidebar-scroll` utility — a 6px transparent-track bar. The default scrollbar overlaps `border-r` and reads as a double rule.

#### B7.2.5 The Panel Is a Column, Not an Overlay

The panel is a flex sibling of the rail inside the page's flex container, sized by one width transition:

- **Opening and closing animate `width`** (`w-0` to `w-sidebar-drawer`) on `--duration-slow` (320ms) with `--ease-standard`, `motion-reduce:transition-none`. The panel's *content* keeps a fixed 264px width inside an `overflow-hidden` wrapper, so the transition is a horizontal wipe rather than a text reflow.
- **Content is not unmounted on close.** If it were, the 320ms in which the main area returns to full width would show an empty strip. The last opened group stays mounted and is hidden by width 0 plus `inert` + `aria-hidden` — which is also what keeps it out of the tab order and the accessibility tree while collapsed, a hard requirement because "collapsed" here means "present in the DOM".
- **Activating a panel row does not collapse the panel.** With push semantics, collapsing on every selection would make the main area jump on each navigation.
- **Re-activating the same L1 does not collapse it either** (measured). To close the panel: activate 首页, or press `Cmd/Ctrl+B`. There is no close button — the reference has none, and the panel is one keystroke or one click away.

Narrow viewport (<768px) is a different rendering branch, not a second design: the sidebar leaves the document flow (`fixed inset-y-0`) and opens as a Radix `Dialog` sheet from a floating 40px menu button. Inside that modal sheet the levels are listed as **group headings plus flat L2 rows** — no disclosure control, no floating layer — because a modal dialog marks its siblings `aria-hidden`, so a portaled overlay would be invisible to screen readers and outside the focus trap, and because there is no resident panel here while L1 no longer navigates: an activatable L1 row would only promise a panel that cannot exist. The same data drives both branches. `Escape`, the close button and any navigation dismiss the sheet.

#### B7.2.6 Motion

The panel's `width` transition is the "panel expansion" step in B6: `--duration-slow` (320ms) with `--ease-standard`, `motion-reduce:transition-none`. A fourth duration step is a defect (B6). The rail itself never animates — there is no width to animate.

### B7.3 Chat + Canvas (immersive)

- Stage: `--brand-ink-950` plus a `radial-gradient` dot grid (currently hardcoded `rgba(255,255,255,0.07)` — should become a token).
- No brand color inside the stage (see B2.6).
- Floating chat panel: translucent `--brand-ink-900` with backdrop blur; focus ring in cyan.
- Zoom and pan never re-encode images; animation is limited to container transforms.

### B7.4 Design Editor (tooling)

- Density over whitespace: tight panels, 28–32px control heights.
- Colors *inside* the canvas are **user content**, outside this palette's scope (the swatch constants in `design-right-panel.tsx` are content, not chrome — they are compliant).
- Documents may opt into the serif family (`--font-editorial`), kept separate from the UI family.

### B7.5 Agent Labels

The agent count will grow, but there are only **three** category colors: atmosphere → cyan family, poster → violet family, custom → coral (decorative). Render as a **neutral chip with a 6px leading color dot**, not a colored fill — highest contrast always belongs to the primary action (Principle 5).

### B7.6 admin (antd mapping)

`apps/admin` uses antd and does not consume Tailwind tokens, so the mapping must be explicit or the two apps silently diverge:

```ts
// apps/admin/src/lib/theme.ts — consumed by ConfigProvider in src/app/layout.tsx
export const ANTD_THEME_TOKEN = {
  colorPrimary: "#7d2ae8",   // = --brand-violet-500
  colorInfo:    "#00c4cc",   // = --brand-cyan-500; links/info only, never text (B2.4)
  colorSuccess: "#00b894",
  colorWarning: "#ffb020",
  colorError:   "#e5484d",   // semantic red, decoupled from brand (B2.3)
  borderRadius: 10,          // = --radius (0.625rem)
  fontFamily:   "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
};
```

`fontFamily` is a literal stack, **not** `var(--font-sans)`: the admin app ships neither Geist nor Tailwind's theme variables, so the CSS variable would be undefined there. `apps/admin/src/lib/theme.test.ts` asserts this map stays in lockstep with `globals.css` — a divergence turns the suite red.

Change both places together; this document is the only justification either of them needs.

## B8. AI-Specific States (Non-Negotiable for a Generation Product)

The reference document has nothing in this category, yet it is the interface users see most often.

| State | Visual spec | Tokens |
| --- | --- | --- |
| **Generating placeholder** | Skeleton block at the final image's dimensions; brand gradient sweeping across at 8% opacity on a 200ms loop; one line of "正在生成…" | `--brand-gradient` @ 8% |
| **Streaming output** | Fades in per segment, 200ms `--ease-standard`; no character-by-character typewriter (it damages reading) | — |
| **Failure card** | Destructive hairline + icon + human-language error copy + **solid** retry button (never gradient — it would compete with the primary CTA) | `--destructive` |
| **Insufficient credits (402)** | Whole panel in a muted disabled state + explanatory copy. **Not** the error color: this is a normal state, not a failure | `--muted` |
| **Selection** | 2px `--ring` (cyan) outline. Deliberately not violet, so it never collides with the primary action | `--ring` |
| **Empty state** | One sentence about the next step. No three-step tour, no onboarding tasks (Principle 1) | `--muted-foreground` |

## B9. Iconography & Illustration

- **Use `lucide-react` outlined icons uniformly**, `stroke-width: 2`, round caps. Section A's "filled only, never outlined" is **rejected** — swapping the icon library costs far more than it returns.
- Filled illustration is allowed on the landing page, but never mix both styles in one viewport.
- Illustration subjects should be **e-commerce objects** — product cards, color swatches, rulers, tags, stamps, crop marks — not generic AI sparkles or robots, which read as "yet another AI tool".

## B10. Anti-Patterns

1. Hardcoded hex / rgba / px durations in components. Known debt: `canvas-stage.tsx` dot grid `rgba(255,255,255,0.07)`; a stale `#0A0A0A` in the `(auth)/layout.tsx` comment.
2. White text on cyan — 2.15:1, unreadable.
3. Applying brand color to the canvas stage, product images, or image shadows.
4. Mixing more than three radius steps in one surface.
5. Using semantic red as brand decoration, or brand violet to signal error.
6. Any workbench duration outside 120 / 200 / 320 (the generation shimmer excepted).
7. Agent labels rendered as filled chips that steal contrast from the primary action.
8. Expressing hierarchy through shadow alone in the dark theme.
9. Leveling Chinese headings by font weight (Smiley Sans is single-weight).
10. Overlaying gradients on images to "unify the style" — it contaminates product color and violates Principle 3.
11. Showing sample images that do not match real capability (better to omit a capability than overstate it).
12. Using Tailwind's built-in scales where brand color is meant — `bg-violet-500` is `#8d54ff`, **not** our purple. Brand color always goes through `var(--brand-violet-*)`.
13. "Fixing" a broken token by renaming the variable other code depends on. Repoint the reference instead (see B3.3).

---

## Related Documents

- Principles and rulings: [PRODUCT_DESIGN.md](./PRODUCT_DESIGN.md)
- Theme behavior contract (dual theme, no first-paint flash): `openspec/specs/app-theme/spec.md`
- Landing page behavior contract: `openspec/specs/landing-page/spec.md` (drafted under change `add-landing-page`)