# fitai.coach — Brand Kit (Nexus)

> Drop this file into your repo (e.g. `docs/BrandKit/BRAND.md`) and reference it when asking Claude Code to build UI. Everything here is tokenized so it pastes cleanly into Tailwind, CSS variables, or a design-system package.

---

## 1 · Brand essence

**Name:** fitai.coach
**Mark:** Nexus — three connected nodes forming a triangle. Athlete · Coach · AI. A graph, not a gym.
**Positioning:** AI-native fitness coaching. Premium, quiet, data-forward. Not bro-culture, not wellness-pastel.
**Tagline options:**
- *Train in the loop.*
- *Your coach, in the graph.*
- *Signal over noise.*

**Voice:**
- Direct, second-person, lowercase. "you ran 5k" not "Great job! 🎉"
- Numbers are facts, not celebrations. Let the data speak.
- Short sentences. No hedging. No emoji in product UI.
- Technical when it earns trust ("VO₂max trended up 2.1% over 14 days"), plain when it doesn't.

---

## 2 · Logo

The mark is a triangular graph: three nodes connected by three edges. The **top node is hollow** (the athlete — receiving), the **two bottom nodes are solid** (coach + AI — sending).

### Files
```
assets/
  logo-primary.svg       # lime bg, ink strokes — default
  logo-ink.svg           # black bg, white strokes — for light surfaces
  logo-mono.svg          # white bg, black strokes — for single-color print
  mark-currentcolor.svg  # inherits currentColor — for inline use
```

### Rules
- **Clear space:** minimum 1 node-radius (8px at 96px canvas) around all sides of the container.
- **Minimum size:** 16px (favicon). Below 16px, use `mark-currentcolor.svg` without the rounded container.
- **Do not:** rotate, recolor individual nodes, stretch, outline-only versions, add gradients, place on photography without a solid backing.
- **Corner radius** of the container: 22% of canvas size. Never square, never circle.

### Inline React component
```tsx
export function NexusMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" className={className} aria-label="fitai.coach">
      <rect width="96" height="96" rx="21" className="fill-lime-brand" />
      <g stroke="currentColor" strokeWidth="5" strokeLinecap="round">
        <line x1="24" y1="72" x2="72" y2="72" />
        <line x1="24" y1="72" x2="48" y2="26" />
        <line x1="72" y1="72" x2="48" y2="26" />
      </g>
      <circle cx="24" cy="72" r="8" fill="currentColor" />
      <circle cx="72" cy="72" r="8" fill="currentColor" />
      <circle cx="48" cy="26" r="10" fill="currentColor" />
      <circle cx="48" cy="26" r="4" className="fill-lime-brand" />
    </svg>
  );
}
```

### Wordmark
- Family: **Space Grotesk**, weight 700, tracking −0.025em.
- Rendering: `fitai` in ink, `.coach` in `--color-muted`. Period included.
- In all-caps contexts: `FITAI.` — 600 weight, tracking +0.14em, period in `--color-primary`.

### Lockup
Horizontal: mark + 14px gap + wordmark. Wordmark cap-height matches mark height × 0.7.
Stacked: mark above wordmark, gap = 0.5 × mark height.

---

## 3 · Color tokens

### Core palette
| Token | Hex | HSL | Use |
|---|---|---|---|
| `--color-ink` | `#0A0A0A` | `0 0% 4%` | Primary text, secondary surface, logo strokes |
| `--color-paper` | `#FFFFFF` | `0 0% 100%` | Primary surface |
| `--color-lime` | `#C4F37E` | `96 85% 74%` | Brand primary — logo bg, key CTAs, hero accents |
| `--color-lime-ink` | `#365F1A` | `96 56% 24%` | Lime-tinted text on light surface |
| `--color-lime-soft` | `#F0F9E4` | `96 60% 94%` | Lime wash — badges, subtle highlights |

### Neutrals (ink ramp)
| Token | Hex | Use |
|---|---|---|
| `--color-ink-900` | `#0A0A0A` | text-primary |
| `--color-ink-700` | `#3D3D3D` | text-secondary |
| `--color-ink-500` | `#858585` | text-muted, icons |
| `--color-ink-300` | `#D4D4D4` | borders-emphasized |
| `--color-ink-200` | `#EFEFEF` | borders-default |
| `--color-ink-100` | `#F5F5F5` | surface-muted |
| `--color-ink-50`  | `#FAFAFA` | surface-subtle |

### Data colors (charts, categories)
Reserved for data viz. Never use for UI chrome.
| Token | Hex | |
|---|---|---|
| `--data-1` | `#1E90F0` | azure |
| `--data-2` | `#00B88A` | teal |
| `--data-3` | `#F5A623` | amber |
| `--data-4` | `#E84A5F` | coral |
| `--data-5` | `#8B5CF6` | violet |

### Semantic
| Token | Hex | Use |
|---|---|---|
| `--color-success` | `#22C55E` | completed, on-track |
| `--color-warning` | `#F59E0B` | attention, recovery needed |
| `--color-danger`  | `#EF4444` | errors, overtraining |
| `--color-info`    | `#1E90F0` | informational only |

### CSS variables block — paste as-is
```css
:root {
  /* brand */
  --color-ink: #0A0A0A;
  --color-paper: #FFFFFF;
  --color-lime: #C4F37E;
  --color-lime-ink: #365F1A;
  --color-lime-soft: #F0F9E4;

  /* ink ramp */
  --color-ink-900: #0A0A0A;
  --color-ink-700: #3D3D3D;
  --color-ink-500: #858585;
  --color-ink-300: #D4D4D4;
  --color-ink-200: #EFEFEF;
  --color-ink-100: #F5F5F5;
  --color-ink-50:  #FAFAFA;

  /* semantic */
  --color-bg: var(--color-paper);
  --color-surface: var(--color-ink-50);
  --color-surface-muted: var(--color-ink-100);
  --color-border: var(--color-ink-200);
  --color-border-strong: var(--color-ink-300);
  --color-text: var(--color-ink-900);
  --color-text-muted: var(--color-ink-500);
  --color-primary: var(--color-ink);
  --color-primary-contrast: var(--color-paper);
  --color-accent: var(--color-lime);
  --color-accent-contrast: var(--color-ink);

  /* status */
  --color-success: #22C55E;
  --color-warning: #F59E0B;
  --color-danger:  #EF4444;

  /* data viz */
  --data-1: #1E90F0;
  --data-2: #00B88A;
  --data-3: #F5A623;
  --data-4: #E84A5F;
  --data-5: #8B5CF6;
}

.dark {
  --color-bg: #0A0A0A;
  --color-surface: #141414;
  --color-surface-muted: #1C1C1C;
  --color-border: #262626;
  --color-border-strong: #363636;
  --color-text: #F5F5F5;
  --color-text-muted: #858585;
  --color-primary: var(--color-lime);
  --color-primary-contrast: var(--color-ink);
}
```

### Tailwind extension
```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0A0A0A', 900: '#0A0A0A', 700: '#3D3D3D', 500: '#858585', 300: '#D4D4D4', 200: '#EFEFEF', 100: '#F5F5F5', 50: '#FAFAFA' },
        paper: '#FFFFFF',
        lime: { DEFAULT: '#C4F37E', ink: '#365F1A', soft: '#F0F9E4', brand: '#C4F37E' },
        data: { 1: '#1E90F0', 2: '#00B88A', 3: '#F5A623', 4: '#E84A5F', 5: '#8B5CF6' },
      }
    }
  }
}
```

---

## 4 · Typography

Three families. No more.

| Family | Use | Weights |
|---|---|---|
| **Space Grotesk** | Display, headings, wordmark | 500, 600, 700 |
| **Geist** | UI, body, buttons | 400, 500, 600 |
| **Geist Mono** | Numbers, data, timestamps, code | 400, 500, 700 |

Load:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

### Scale

| Token | Size / Line | Weight | Tracking | Family | Use |
|---|---|---|---|---|---|
| `display` | 60 / 64 | 700 | −0.03em | Space Grotesk | Marketing hero |
| `h1` | 40 / 44 | 700 | −0.02em | Space Grotesk | Page title |
| `h2` | 28 / 32 | 600 | −0.015em | Space Grotesk | Section |
| `h3` | 20 / 28 | 600 | −0.01em | Space Grotesk | Card title |
| `body` | 16 / 24 | 400 | 0 | Geist | Default paragraph |
| `body-sm` | 14 / 20 | 400 | 0 | Geist | Secondary |
| `label` | 12 / 16 | 500 | +0.08em | Geist | Uppercase meta label |
| `metric-xl` | 48 / 52 | 700 | −0.02em | Geist Mono | Hero metric |
| `metric` | 32 / 36 | 700 | −0.01em | Geist Mono | Card metric |
| `mono` | 14 / 20 | 500 | 0 | Geist Mono | Timestamps, IDs |

### Rules
- All `.metric` classes use `font-variant-numeric: tabular-nums`.
- Headings are never full black when on paper — use `--color-ink-900` which is `#0A0A0A`, not pure `#000`.
- Body copy is left-aligned. Center only for short hero statements.
- Numbers in a data context (`28.4 km`, `142 bpm`) are always mono. Inline numbers in prose are not.

---

## 5 · Layout, spacing, radius

### Spacing scale (4px base)
`0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`

### Radius scale
| Token | Value | Use |
|---|---|---|
| `--radius-none` | 0 | Dividers, precision inputs |
| `--radius-sm` | 4px | Badges, pills |
| `--radius-md` | 8px | Buttons, inputs |
| `--radius-lg` | 12px | Cards |
| `--radius-xl` | 20px | Modals, sheets |
| `--radius-full` | 9999px | Avatars, status dots |

### Elevation (very restrained)
The system is mostly flat. Shadows carry semantic weight, not decoration.
```css
--shadow-1: 0 1px 2px rgba(10,10,10,0.04);           /* resting */
--shadow-2: 0 4px 8px -2px rgba(10,10,10,0.08);      /* hover */
--shadow-3: 0 12px 32px -8px rgba(10,10,10,0.18);    /* popover, modal */
```

### Grid
- Max content width: **1200px**.
- Page gutter: 24px mobile, 48px desktop.
- Cards sit on a 12-column grid. Gap: 20px.

---

## 6 · Components

### Button
| Variant | Bg | Text | Border | Use |
|---|---|---|---|---|
| `primary` | `--color-ink` | `--color-paper` | — | Main CTA |
| `accent` | `--color-lime` | `--color-ink` | — | Brand moment, hero CTA |
| `secondary` | transparent | `--color-ink` | `--color-border-strong` | Secondary actions |
| `ghost` | transparent | `--color-ink` | — | Low-emphasis |
| `danger` | `--color-danger` | `#fff` | — | Destructive |

Sizes: `sm` 32px / `md` 40px / `lg` 48px. Radius: `--radius-md`. Font: Geist 500 14px.
Icon gap: 8px. Icon size matches line-height.

### Card
```
background: var(--color-paper);
border: 1px solid var(--color-border);
border-radius: var(--radius-lg);
padding: 20px;
```
No default shadow. Add `--shadow-1` only on hover/interactive cards.

### Badge
12px, 500 weight, uppercase, tracking +0.08em. Radius `--radius-sm` (pill-adjacent, not fully round). Background `--color-ink-100` + text `--color-ink-700` by default; accent uses `--color-lime-soft` + `--color-lime-ink`.

### Input
Height 40px, border `--color-border-strong`, radius `--radius-md`, padding-x 12px. Focus ring: 2px `--color-ink`.

### Chart defaults
- Gridlines: `--color-border`, 1px, dashed.
- Axis labels: `label` token, `--color-text-muted`.
- Values on hover: Geist Mono 14px.
- Line thickness: 2px for primary series, 1.5px for comparisons.
- Use data colors in order: `--data-1` → `--data-5`.

---

## 7 · Motion

- **Duration:** micro 120ms, UI 200ms, layout 320ms.
- **Easing:** `cubic-bezier(0.2, 0.7, 0.3, 1)` for entry, `cubic-bezier(0.4, 0, 1, 1)` for exit.
- **Reduce:** respect `prefers-reduced-motion: reduce` — fade only, no translate.
- Buttons: no scale on hover. Only `filter: brightness(0.96)`.
- Nexus mark has an optional active state: the three nodes pulse in sequence (athlete → coach → ai) over 1400ms. Use only in loading or live-sync contexts.

---

## 8 · Iconography

- **Library:** Lucide, 1.5px stroke, 24px default.
- Icon color matches surrounding text color. Never brand-colored.
- The Nexus mark is **not** an icon — never use it inline with text at icon size except for `<title>`, tab favicons, or explicit brand moments.

---

## 9 · Photography & imagery

- **Do:** strong shadows, single subjects, desaturated skin tones, indoor/neutral environments. Training over posing.
- **Don't:** stock-smile gym photography, heavy gradients, motivational overlays, drone-mountain shots.
- Graph and data visualizations are the hero art of this brand. Treat them as imagery, not decoration.

---

## 10 · Voice snippets

**Onboarding**
> sync your watch. the rest is automatic.

**Empty state**
> no workouts yet this week. that's ok — rest is training.

**Error**
> we lost connection to your garmin. retry, or finish logging by hand.

**Success (understated)**
> run logged. 5.2 km at 5:14/km.

**Never:**
- "🎉 Amazing workout!"
- "You crushed it!"
- "Let's gooo"

---

## 11 · Quick reference — handoff prompt for Claude Code

Paste this at the top of any UI task:

> Use the fitai.coach brand system. Primary surface is `--color-paper`, text is `--color-ink-900`, brand accent is `--color-lime` (#C4F37E) used sparingly — hero CTAs, logo, single highlighted metrics. Neutrals come from the ink ramp. Typography: Space Grotesk for headings, Geist for UI/body, Geist Mono for all numbers and timestamps. Cards have a 12px radius, 1px `--color-border`, no default shadow. Buttons are 40px, 8px radius, no scale animation. Voice is lowercase, direct, second-person, no emoji. The Nexus mark (three connected nodes) is the only logo; never recolor individual nodes.
