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
| 5 category accents | 2 built-in agents today | Reduce to 3, and render as dots rather than colored fills (B7.4) |
| No admin app | `apps/admin` uses antd, no Tailwind | Add a token mapping (B7.5) |

---

# Part B · The oops Design System (Executable Spec)

## B0. How to Use This Document

1. **This file is the single source of truth for design tokens.** Hardcoded colors, radii, or durations in components are forbidden. Add the value to B1 first, land it as a token in `globals.css`, then reference it.
2. **Four token layers. A brand change only touches layers 1 and 3.**
3. Dark is the **default** theme. Anything that "only works in light mode" is a defect — `openspec/specs/app-theme/spec.md` mandates both themes.
4. When code and this document disagree, code wins — but then either fix the code or come back and fix this file. Permanent divergence is not allowed.

## B1. Token Layers & Naming

```
Layer 1  primitive   --violet-500 / --cyan-600 / --ink-800    raw ramps; business code must not import these
Layer 2  semantic    --primary / --ring / --border / --muted…  the existing shadcn layer; change values, not names
Layer 3  brand       --brand-gradient / --brand-blob-*        brand-only; decoration and emphasis
Layer 4  component   --radius-* / --shadow-* / --duration-*     shape, elevation, motion; shared app-wide
```

Why this matters: **a brand change = edit layers 1 and 3.** Semantic names like `--primary` never move, so component code stays untouched. That property is what makes this document authoritative rather than decorative.

## B2. Color

### B2.1 Brand Ramps (Primitive) `[proposed]`

Violet — brand primary; carries "primary action".

| Token | Value | Use |
| --- | --- | --- |
| `--violet-50` | `#f6f0fe` | Tint surface |
| `--violet-100` | `#ece0fd` | Blob / hover surface |
| `--violet-300` | `#c09df8` | Borders, disabled |
| `--violet-500` | `#7d2ae8` | **Base primary**: primary CTA, active state, gradient origin |
| `--violet-600` | `#6a1fd0` | Primary hover |
| `--violet-700` | `#571aab` | Text on violet, secondary emphasis |

Cyan — brand secondary; **atmosphere and focus only**.

| Token | Value | Use |
| --- | --- | --- |
| `--cyan-50` | `#e6f9fa` | Tint surface |
| `--cyan-100` | `#c4f0f2` | Blob |
| `--cyan-500` | `#00c4cc` | Gradient terminus, large decorative fills. **Never carries text** |
| `--cyan-600` | `#009aa2` | Borders, large text (≥24px/600) |
| `--cyan-700` | `#007a81` | **Cyan text step**: 5.1:1 with white ✓ |

Bridge blue — gradient midpoint so violet→cyan does not pass through mud: `#4a5cf0`.

### B2.2 Neutral Ramp — Cool Gray with a Whisper of Violet `[proposed]`

Once the brand hue is chromatic, the grays must lean cool too, or the whole UI reads dirty.

| Token | Value | Typical role |
| --- | --- | --- |
| `--ink-950` | `#0d0c12` | Dark page background (today `#0b0b0d`, plus a faint violet cast) |
| `--ink-900` | `#16151d` | Dark surface / card |
| `--ink-850` | `#1d1c26` | Dark raised surface |
| `--ink-800` | `#262430` | Dark border |
| `--ink-700` | `#3a3846` | Dark divider, hover fill |
| `--ink-600` | `#565469` | Light secondary text |
| `--ink-500` | `#77748a` | Dark secondary text (4.6:1 on `--ink-950`) |
| `--ink-400` | `#9b98ad` | Disabled text on light |
| `--ink-300` | `#c3c0cf` | Strong light border |
| `--ink-200` | `#e2e0ea` | Light border |
| `--ink-100` | `#eeecf4` | Light hover fill |
| `--ink-50` | `#f7f6fa` | Light section background |
| `--white` | `#ffffff` | Light page / card |

Light-mode primary text is `--ink-900` (`#16151d`, 15.9:1 on white) — **not pure black**.

### B2.3 Semantic Colors — Decoupled From the Brand `[proposed]`

**Rule: semantic hues (green / amber / red / blue) must not overlap brand hues (violet / cyan). Red always means "error or danger" and never brand decoration.** Section A's `#ff5757` serving as both a brand sparkle and the error color is exactly the coupling we are cutting.

| Token | Value | Use |
| --- | --- | --- |
| `--success` | `#00b894` | Saved, exported |
| `--warning` | `#ffb020` | Quota advisories |
| `--destructive` | `#e5484d` | Failure, destructive actions (**keeps today's hue**; we are only removing it from the brand palette) |
| `--info` | `#0d99ff` | Tips, links |

Coral `#ff7059` is demoted to a **decoration-only third color**: large fills and illustrations on the landing page. Never text, never status, never a button fill.

### B2.4 Contrast Table (WCAG, measured — re-verify on landing)

| Foreground | Background | Ratio | Verdict |
| --- | --- | --- | --- |
| white | `--violet-500` `#7d2ae8` | 6.2:1 | ✓ body and large text |
| white | `--violet-600` `#6a1fd0` | 8.0:1 | ✓ hover state |
| white | `--cyan-500` `#00c4cc` | 2.15:1 | ✗ decoration only, never text |
| white | `--cyan-600` `#009aa2` | 3.4:1 | △ large text / graphics only |
| white | `--cyan-700` `#007a81` | 5.1:1 | ✓ the cyan text step |
| white | `--destructive` `#e5484d` | 3.9:1 | △ button labels need ≥16px/600, or drop to a `--destructive-700` |
| `--ink-900` | white | 15.9:1 | ✓ |
| `--ink-600` | white | 6.5:1 | ✓ secondary text |
| `--ink-500` | white | 4.6:1 | ✓ secondary text on light |
| reference `#9aa0a6` | white | 2.64:1 | ✗ borders and placeholder blocks only |

**Hard rule that falls out of this table**: the light end of a gradient must be darkened. A white label on `#7d2ae8 → #00c4cc` **fails AA**. Either terminate at `--cyan-700` (~4.4–5.1:1) or set the label at ≥16px/600 and claim the large-text threshold.

### B2.5 Brand Tokens `[proposed]`

```
--brand-gradient        linear-gradient(135deg, #7d2ae8 0%, #4a5cf0 52%, #007a81 100%)
--brand-gradient-text   same, with background-clip:text (landing hero titles only)
--brand-blob-1/2/3      violet-100 / cyan-100 / #4a5cf0 @ 12% (organic landing background shapes)
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
| Page background | `--ink-50` / white | `--ink-950` |
| Card / panel | white | `--ink-900` |
| Primary text | `--ink-900` | white |
| Secondary text | `--ink-600` | `--ink-500` |
| Border | `--ink-200` | `--ink-800` |
| Primary CTA | violet gradient (both ends darkened per B2.4) | same hues, +5% lightness |
| Brand colors | same hues as dark — **no desaturation** | same |

The landing page is light-only by design (marketing pages do not need a dark mode), but `/login` and `/register` are bound by `openspec/specs/app-theme/spec.md` and must stay legible in both.

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

Minimal fix: rename the Geist variable in `layout.tsx` from `--font-geist-sans` to `--font-sans` so the `@theme inline` reference resolves. This is implementation work — verify in a real browser before landing.

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

**Shadows are effectively invisible in the dark theme.** Hierarchy there must be expressed through surface lightening plus an `--ink-800` hairline. Anything that currently relies on a shadow for hierarchy needs a dark-mode alternative.

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

- Light paper surface (`--ink-50`) plus three blob shapes, absolutely positioned, low opacity, organic — never a geometric grid.
- Hero title uses `--font-display` with `--brand-gradient-text`.
- Primary CTA is a gradient pill; secondary CTA is a white outlined pill.
- Container max 1200–1320px, 32px gutters, 96–128px section spacing.
- **Prefer a real product slice** (two frames: chat bubble → image card) over decorative illustration. The differentiator is "chat in, shippable image out" — so demonstrate it instead of hiding behind generic AI imagery.

### B7.2 Chat + Canvas (immersive)

- Stage: `--ink-950` plus a `radial-gradient` dot grid (currently hardcoded `rgba(255,255,255,0.07)` — should become a token).
- No brand color inside the stage (see B2.6).
- Floating chat panel: translucent `--ink-900` with backdrop blur; focus ring in cyan.
- Zoom and pan never re-encode images; animation is limited to container transforms.

### B7.3 Design Editor (tooling)

- Density over whitespace: tight panels, 28–32px control heights.
- Colors *inside* the canvas are **user content**, outside this palette's scope (the swatch constants in `design-right-panel.tsx` are content, not chrome — they are compliant).
- Documents may opt into the serif family (`--font-editorial`), kept separate from the UI family.

### B7.4 Agent Labels

The agent count will grow, but there are only **three** category colors: atmosphere → cyan family, poster → violet family, custom → coral (decorative). Render as a **neutral chip with a 6px leading color dot**, not a colored fill — highest contrast always belongs to the primary action (Principle 5).

### B7.5 admin (antd mapping)

`apps/admin` uses antd and does not consume Tailwind tokens, so the mapping must be explicit or the two apps silently diverge:

```ts
// ConfigProvider in apps/admin/src/app/layout.tsx (antd 6)
ConfigProvider theme={{ token: {
  colorPrimary: "#7d2ae8",   // = --violet-500
  colorInfo:    "#00c4cc",
  colorSuccess: "#00b894",
  colorWarning: "#ffb020",
  colorError:   "#e5484d",
  borderRadius: 10,          // = --radius-lg
  fontFamily:   "var(--font-sans)",
}}}
```

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

---

## Related Documents

- Principles and rulings: [PRODUCT_DESIGN.md](./PRODUCT_DESIGN.md)
- Theme behavior contract (dual theme, no first-paint flash): `openspec/specs/app-theme/spec.md`
- Landing page behavior contract: `openspec/specs/landing-page/spec.md` (to be created)