# Kamino Design System

> **Terminal Aesthetic Meets Deep Space**
> A portable, cross-product design language for the Kamino product family

**Version**: 2.0
**Last Validated**: 2026-04-05
**Source of Truth**: Elephantasm frontend (`frontend/src/`)

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Foundations](#foundations)
   - [Color System](#color-system)
   - [Typography](#typography)
   - [Spacing & Sizing](#spacing--sizing)
   - [Border Radius](#border-radius)
   - [Elevation & Shadows](#elevation--shadows)
   - [Opacity Scale](#opacity-scale)
   - [Z-Index Layers](#z-index-layers)
3. [Theme Tokens (CSS Custom Properties)](#theme-tokens-css-custom-properties)
4. [Component Library](#component-library)
   - [Buttons](#buttons)
   - [Inputs & Forms](#inputs--forms)
   - [Cards & Containers](#cards--containers)
   - [Terminal Container](#terminal-container)
   - [Glassmorphic Card](#glassmorphic-card)
   - [Modals & Dialogs](#modals--dialogs)
   - [Tables](#tables)
   - [Tooltips & Popovers](#tooltips--popovers)
   - [Status Indicators](#status-indicators)
   - [Progress Bars](#progress-bars)
   - [Loading States](#loading-states)
   - [Empty States](#empty-states)
   - [Error States](#error-states)
5. [Navigation & Information Architecture](#navigation--information-architecture)
6. [Iconography & Symbols](#iconography--symbols)
7. [Animations & Motion](#animations--motion)
8. [Backgrounds & Atmospherics](#backgrounds--atmospherics)
9. [Scrollbar Styling](#scrollbar-styling)
10. [Responsive Design](#responsive-design)
11. [Accessibility](#accessibility)
12. [Adopting for Sister Products](#adopting-for-sister-products)

---

## Design Philosophy

### Core Aesthetic: Retro Terminal + Deep Space

The visual language draws from two sources:
1. **Terminal/Command-Line Interfaces** — Monospace fonts, grid-based borders, title bars, status indicators, `>` chevrons, `[ BRACKETS ]`
2. **Deep Space Imagery** — Starfields, nebulae, particle effects, cosmic gradients, ambient drift

### Five Principles

#### 1. Functional Minimalism
Every visual element serves a purpose. No decorative flourishes for their own sake. Information hierarchy is clear and deliberate.

#### 2. Terminal as Interface Metaphor
Terminal windows as container pattern. Title bars with `[ COMPONENT NAME ]` headers. Green chevrons (`>`) as universal action/status indicators. Monospace font for headers and labels.

#### 3. Dark-First, High Contrast
Pure black (`#000000`) as primary background. Light text on dark backgrounds (WCAG AA compliant). Strategic use of opacity for layering depth.

#### 4. Subtle, Not Flashy
Animations enhance, never distract. Glassmorphic effects are restrained (low opacity). Hover states are gentle transitions (200ms), not jarring pops.

#### 5. Color as Information Architecture
Each product domain gets a dedicated accent color. Colors carry meaning — they indicate *what area* you're in, not just decoration. The palette is deliberate and consistent.

---

## Foundations

### Color System

#### Base Palette (Neutrals)

The neutral scale provides backgrounds, text, and borders. Based on Tailwind's gray scale.

```
#000000  ── Pure black       Page backgrounds
#0a0a0a  ── Near-black       Card/panel backgrounds (hsl(0 0% 3.9%))
#111827  ── Gray 900         Subtle borders, deep backgrounds
#1f2937  ── Gray 800         Elevated backgrounds, empty states
#27272a  ── Zinc 800         Dark mode borders (--border)
#374151  ── Gray 700         Secondary borders
#4b5563  ── Gray 600         Active borders, terminal borders (primary)
#6b7280  ── Gray 500         Muted text, captions
#9ca3af  ── Gray 400         Secondary text, body copy
#d1d5db  ── Gray 300         Primary text, descriptions
#e5e7eb  ── Gray 200         Headings
#f3f4f6  ── Gray 100         Bright text, emphasis
#fafafa  ── Gray 50          Maximum brightness text
```

#### Background Hierarchy (4 tiers)

Depth is created through layered backgrounds, not shadows alone:

```
Tier 1  #000000              Page/root background
Tier 2  #0a0a0a              Cards, modals, panels
Tier 3  #1f2937 / #27272a    Elevated elements, hover states
Tier 4  #374151 / zinc-700   Maximum elevation, active states
```

With transparency variants:
```
bg-black/80    ── Terminal containers (80% black)
bg-black/50    ── Input fields
bg-black/40    ── Subtle overlays, rail backgrounds
bg-white/5     ── Glassmorphic container fills
bg-white/10    ── Glassmorphic borders, track fills
bg-white/[0.02] ── Barely-there gradient endpoints
```

#### Brand Green (Primary Accent)

Green is the universal brand color across all products. It signals: active, success, primary action, brand identity.

```
#dcfce7  ── green-100    Light tint backgrounds
#86efac  ── green-300    Bright highlights
#4ade80  ── green-400    Glow effects, bright accents
#22c55e  ── green-500    PRIMARY — status, chevrons, focus rings
#16a34a  ── green-600    Button hover states
#15803d  ── green-700    Button default backgrounds
#166534  ── green-800    Dark tint
#0c4521  ── green-950    Banner backgrounds
```

#### Feature Color Map

Each product section/domain has a dedicated accent color. This system is the primary mechanism for wayfinding across the UI.

| Section      | Role     | Color          | Hex       | Tailwind Class |
|-------------|----------|----------------|-----------|----------------|
| Anima       | Entity   | Green          | `#22c55e` | `green-500`    |
| Memories    | Entity   | Blue           | `#60a5fa` | `blue-400`     |
| Knowledge   | Entity   | Violet         | `#a78bfa` | `violet-400`   |
| Identity    | Entity   | Amber          | `#fbbf24` | `amber-400`    |
| Sandbox     | Tool     | Cyan           | `#06b6d4` | `cyan-500`     |
| Pipeline    | Tool     | Rose           | `#fb7185` | `rose-400`     |
| Payloads    | Tool     | Orange         | `#fb923c` | `orange-400`   |
| Dreams      | Tool     | Purple         | `#c084fc` | `purple-400`   |
| Meditations | Tool     | Teal           | `#2dd4bf` | `teal-400`     |
| Logs        | Tool     | Emerald        | `#34d399` | `emerald-400`  |

**Pattern for applying feature colors:**
```
Active nav:     text-{color}  bg-{color}/10  border-b-2 border-{color}
Nav hover:      hover:text-{color}
Section header: text-{color}
Accent glow:    shadow-[0_0_12px_rgba({r},{g},{b},0.15)]
Tinted bg:      bg-{color}/5  or  bg-{color}/10
```

#### Alert Colors

```
#ef4444  ── red-500     Errors, destructive actions
#f87171  ── red-400     Error text on dark backgrounds
rgba(127, 29, 29, 0.3) ── Red background tint
```

#### Glassmorphic Overlays (White Opacity)

```
rgba(255, 255, 255, 0.02)  ── Barely-there gradient endpoints
rgba(255, 255, 255, 0.05)  ── Container background fills
rgba(255, 255, 255, 0.10)  ── Borders, track fills
rgba(255, 255, 255, 0.20)  ── Hover borders
rgba(255, 255, 255, 0.30)  ── Strong accents
```

---

### Typography

#### Font Stack

Three fonts, each with a distinct role:

| Font | CSS Variable | Role | Weights |
|------|-------------|------|---------|
| **Geist Sans** | `--font-geist-sans` | Default body text, UI elements | 400, 500, 600, 700 |
| **Geist Mono** | `--font-geist-mono` | Code blocks, data values | 400, 700 |
| **Space Mono** | `--font-space-mono` | Terminal headers, labels, buttons — the "signature" font | 400, 700 |

```css
/* Import setup (Next.js Google Fonts) */
font-family: var(--font-geist-sans);   /* Body default */
font-family: var(--font-geist-mono);   /* Code/data */
font-family: var(--font-space-mono);   /* Terminal aesthetic */
```

**Rule**: Space Mono defines the brand feel. Use it for all headers, labels, buttons, navigation, and status text. Use Geist Sans for body paragraphs and long-form content where readability matters. Use Geist Mono for code, data values, and technical output.

#### Type Scale

| Token | Size | Use |
|-------|------|-----|
| `text-xs` | 12px (0.75rem) | Labels, captions, terminal headers, buttons |
| `text-sm` | 14px (0.875rem) | Body text, descriptions, secondary content |
| `text-base` | 16px (1rem) | Large body, subsection headings |
| `text-lg` | 18px (1.125rem) | Section titles |
| `text-xl` | 20px (1.25rem) | Page subtitles |
| `text-2xl` | 24px (1.5rem) | Page titles |
| `text-4xl` | 36px (2.25rem) | Hero titles (mobile) |
| `text-5xl` | 48px (3rem) | Hero titles (desktop) |

#### Type Patterns

```css
/* Terminal header (signature pattern) */
font-mono tracking-wider uppercase text-xs text-gray-500

/* Terminal label */
text-xs font-semibold uppercase tracking-wider text-gray-500 font-mono

/* Page heading */
text-2xl font-bold text-gray-200 tracking-tight

/* Body text */
text-sm text-gray-400

/* Caption/metadata */
text-xs text-gray-500

/* Hero title */
text-4xl sm:text-5xl font-bold uppercase tracking-widest text-gray-100
```

#### Letter Spacing

| Class | Value | Use |
|-------|-------|-----|
| `tracking-tight` | -0.015em | Page headings, large text |
| `tracking-normal` | 0 | Body text |
| `tracking-wide` | 0.025em | Subheadings |
| `tracking-wider` | 0.05em | Terminal labels, buttons (primary) |
| `tracking-widest` | 0.1em | Hero titles |

#### Typography Rules

1. **Always uppercase** for: buttons, labels, terminal headers, navigation, status text
2. **Wide letter-spacing** (`tracking-wider` minimum) for all uppercase text
3. **No italics** — italic text breaks the terminal aesthetic
4. **Font hierarchy**: Space Mono for UI chrome, Geist Sans for content, Geist Mono for data

---

### Spacing & Sizing

Base unit: **4px** (Tailwind's `1` = 0.25rem = 4px). Most common spacing values are multiples of 4 or 8.

#### Spacing Scale

```
1    = 0.25rem   (4px)     Tight gaps
1.5  = 0.375rem  (6px)     Compact gaps
2    = 0.5rem    (8px)     Standard gap (most common)
3    = 0.75rem   (12px)    Component internal spacing
4    = 1rem      (16px)    Standard padding
5    = 1.25rem   (20px)    Comfortable padding
6    = 1.5rem    (24px)    Card/modal padding
8    = 2rem      (32px)    Section padding (mobile)
12   = 3rem      (48px)    Section padding (desktop)
16   = 4rem      (64px)    Page vertical spacing
20   = 5rem      (80px)    Hero spacing
```

#### Common Patterns

```css
/* Terminal title bar */
px-3 py-2        /* or px-4 py-2 */

/* Terminal content area */
px-4 py-4

/* Card/modal content */
p-6              /* 24px all sides */

/* Page container */
px-4 py-8                    /* Mobile */
sm:px-8 sm:py-12             /* Desktop */

/* Between form fields */
space-y-4

/* Between section components */
space-y-8

/* Flex/grid gaps */
gap-2  (8px)     /* Most common */
gap-3  (12px)    /* Comfortable */
gap-4  (16px)    /* Spacious */
gap-6  (24px)    /* Between sections */
```

#### Container Widths

```
max-w-md   = 28rem   (448px)    Modals (narrow)
max-w-lg   = 32rem   (512px)    Forms
max-w-xl   = 36rem   (576px)    Modals (standard)
max-w-2xl  = 42rem   (672px)    Content columns
max-w-4xl  = 56rem   (896px)    Content pages, large modals
max-w-5xl  = 64rem   (1024px)   Wide content
max-w-6xl  = 72rem   (1152px)   Dashboard layouts
max-w-7xl  = 80rem   (1280px)   Full-width pages
```

#### Icon Sizes

```
size={16}   Small (inline, captions)
size={18}   Medium (close buttons, nav)
size={24}   Large (mobile menu, hero)
```

#### Spinner Sizes

```
w-3 h-3    Inline with text
w-4 h-4    Small loading states
w-8 h-8    Full-screen loaders
```

---

### Border Radius

The system uses rounded corners, with size indicating element importance:

```
rounded-sm   = 2px (0.125rem)     Small elements, tags
rounded      = 4px (0.25rem)      Grid cells, minor elements
rounded-md   = 6px (0.375rem)     Inputs, buttons, selects, textareas
rounded-lg   = 8px (0.5rem)       Containers, panels, rails
rounded-xl   = 12px (0.75rem)     Cards (primary shape)
rounded-full = 9999px             Avatars, badges, status dots, spinners, pills
```

**CSS Variables:**
```css
--radius:    0.5rem   /* 8px — base */
--radius-lg: 0.75rem  /* calc(var(--radius) + 2px) */
--radius-md: 0.5rem   /* var(--radius) */
--radius-sm: 0.25rem  /* calc(var(--radius) - 2px) */
```

**Rules:**
- Terminal containers use **no border-radius** (square corners) — this is the signature terminal look
- shadcn/ui components (Card, Input, Button) use their default radius values
- Status dots and avatars always use `rounded-full`
- The two systems coexist: terminal patterns are square, component-library patterns are rounded

---

### Elevation & Shadows

Shadows are used sparingly. Depth is primarily communicated through background color tiers and borders.

```css
/* Standard elevation */
shadow       0 1px 2px 0 rgba(0, 0, 0, 0.05)         Cards, containers

/* Low elevation */
shadow-sm    0 1px 2px 0 rgba(0, 0, 0, 0.05)         Inputs, buttons

/* High elevation */
shadow-lg    0 10px 15px -3px rgba(0, 0, 0, 0.1)      Elevated panels

/* Maximum elevation */
shadow-xl    0 20px 25px -5px rgba(0, 0, 0, 0.1)      Modals
shadow-2xl   0 25px 50px -12px rgba(0, 0, 0, 0.25)    Overlays

/* Brand glow effects */
shadow-[0_0_12px_rgba(34,211,238,0.15)]                Cyan glow (tech/LLM elements)
shadow-[0_0_12px_rgba(34,197,94,0.15)]                 Green glow (brand elements)

/* Terminal container shadow */
box-shadow: 0 0 12px rgba(0,0,0,0.45),
            0 1px 0 rgba(255,255,255,0.04) inset;      Terminal glass effect
```

#### Border Widths

```
border    = 1px    Glassmorphic cards, subtle separation
border-2  = 2px    Terminal containers (signature pattern)
```

---

### Opacity Scale

Opacity modifiers on colors are a primary tool for creating hierarchy without multiplying the palette:

```
/5     5%     Minimal tint (barely visible)
/10    10%    Subtle highlight (active nav background, feature tint)
/20    20%    Visible background (hover states)
/30    30%    Strong background (scrollbar thumbs)
/40    40%    Prominent overlay (image overlays)
/50    50%    Significant opacity (borders, strong tints)
/60    60%    High contrast
/70    70%    Near-opaque overlays
/80    80%    Terminal containers, modal backdrops
/90    90%    Near-opaque
```

**Key patterns:**
- `bg-{color}/10` — Active state background tint
- `bg-{color}/5` — Subtle section tint
- `bg-black/80` — Terminal container fill
- `bg-black/40` — Image/background overlay
- `border-{color}/50` — Tinted borders

---

### Z-Index Layers

```
-z-10    Background layers (particle fields, starfields)
z-0      Default content
z-10     Overlaid content, page content above backgrounds
z-40     Modal backdrops
z-50     Modals, fixed headers, navigation, popovers
```

---

## Theme Tokens (CSS Custom Properties)

The design system uses HSL-based CSS custom properties (from shadcn/ui) for theme-aware components. These allow automatic light/dark switching.

**Important:** Values are stored as raw HSL channels without `hsl()` wrapper, so they can be composed with opacity: `hsl(var(--primary) / 0.5)`.

### Dark Mode (Primary — `@media (prefers-color-scheme: dark)`)

```css
--background:             0 0% 3.9%;      /* #0a0a0a  Near-black */
--foreground:             0 0% 98%;       /* #fafafa  Off-white */
--card:                   0 0% 3.9%;      /* #0a0a0a */
--card-foreground:        0 0% 98%;       /* #fafafa */
--popover:                0 0% 3.9%;      /* #0a0a0a */
--popover-foreground:     0 0% 98%;       /* #fafafa */
--primary:                0 0% 98%;       /* #fafafa */
--primary-foreground:     0 0% 9%;        /* #171717 */
--secondary:              0 0% 14.9%;     /* #262626 */
--secondary-foreground:   0 0% 98%;       /* #fafafa */
--muted:                  0 0% 14.9%;     /* #262626 */
--muted-foreground:       0 0% 63.9%;     /* #a3a3a3 */
--accent:                 0 0% 14.9%;     /* #262626 */
--accent-foreground:      0 0% 98%;       /* #fafafa */
--destructive:            0 62.8% 30.6%;  /* #7f1d1d */
--destructive-foreground: 0 0% 98%;       /* #fafafa */
--border:                 0 0% 14.9%;     /* #262626 */
--input:                  0 0% 14.9%;     /* #262626 */
--ring:                   0 0% 83.1%;     /* #d4d4d8 */
```

### Light Mode (`:root` default)

```css
--background:             0 0% 100%;      /* #ffffff */
--foreground:             0 0% 3.9%;      /* #0a0a0a */
--card:                   0 0% 100%;      /* #ffffff */
--card-foreground:        0 0% 3.9%;      /* #0a0a0a */
--primary:                0 0% 9%;        /* #171717 */
--primary-foreground:     0 0% 98%;       /* #fafafa */
--secondary:              0 0% 96.1%;     /* #f5f5f5 */
--secondary-foreground:   0 0% 9%;        /* #171717 */
--muted:                  0 0% 96.1%;     /* #f5f5f5 */
--muted-foreground:       0 0% 45.1%;     /* #737373 */
--accent:                 0 0% 96.1%;     /* #f5f5f5 */
--accent-foreground:      0 0% 9%;        /* #171717 */
--destructive:            0 84.2% 60.2%;  /* #ef4444 */
--destructive-foreground: 0 0% 98%;       /* #fafafa */
--border:                 0 0% 89.8%;     /* #e5e5e5 */
--input:                  0 0% 89.8%;     /* #e5e5e5 */
--ring:                   0 0% 3.9%;      /* #0a0a0a */
```

### Derived Variables

```css
--font-sans: var(--font-geist-sans);
--font-mono: var(--font-geist-mono);

--color-background: hsl(var(--background));
--color-foreground: hsl(var(--foreground));
--color-card:       hsl(var(--card));
--color-primary:    hsl(var(--primary));

--radius-lg: calc(var(--radius) + 2px);   /* 0.75rem */
--radius-md: var(--radius);                /* 0.5rem */
--radius-sm: calc(var(--radius) - 2px);    /* 0.25rem */
```

---

## Component Library

### Foundation: shadcn/ui

The component layer is built on [shadcn/ui](https://ui.shadcn.com/) (New York style, neutral base color). This provides consistent, accessible primitives that are then styled with the terminal aesthetic.

**Configuration:**
```json
{
  "style": "new-york",
  "rsc": true,
  "tailwind": {
    "baseColor": "neutral",
    "cssVariables": true
  }
}
```

---

### Buttons

#### Primary Button (Terminal Green)

```tsx
<button className="
  px-4 py-2
  text-xs font-semibold tracking-wider uppercase
  bg-green-700 hover:bg-green-600
  text-white border border-green-600
  transition-all font-mono
">
  > Button Text
</button>
```

- Default: `bg-green-700`, `border-green-600`
- Hover: `bg-green-600` (lighter)
- Disabled: `opacity-50 cursor-not-allowed`

#### Secondary Button (Outline)

```tsx
<button className="
  px-4 py-2
  text-xs font-semibold tracking-wider uppercase
  text-gray-300 bg-transparent
  border border-gray-600
  hover:border-gray-500 hover:bg-white/5
  transition-all font-mono
">
  > Action
</button>
```

#### Destructive Button (Red on Hover)

```tsx
<button className="
  px-3 py-1.5
  text-xs font-semibold tracking-wider uppercase
  text-gray-300 border border-gray-700
  hover:border-red-500 hover:text-red-500 hover:bg-red-500/10
  transition-all font-mono
">
  Sign Out
</button>
```

#### shadcn/ui Button Variants

These coexist with terminal buttons for component-library contexts:

| Variant | Classes |
|---------|---------|
| `default` | `bg-primary text-primary-foreground shadow hover:bg-primary/90` |
| `destructive` | `bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90` |
| `outline` | `border border-input bg-background shadow-sm hover:bg-accent` |
| `secondary` | `bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80` |
| `ghost` | `hover:bg-accent hover:text-accent-foreground` |
| `link` | `text-primary underline-offset-4 hover:underline` |

Sizes: `default` (h-9, px-4 py-2), `sm` (h-8, px-3 text-xs), `lg` (h-10, px-8), `icon` (h-9 w-9)

---

### Inputs & Forms

#### Text Input

```tsx
<input className="
  bg-black/50 border border-gray-600
  text-gray-100 font-mono text-sm
  placeholder:text-gray-600
  focus:border-green-500 focus:outline-none
  px-3 py-2 rounded-md
  transition-colors
" />
```

#### shadcn/ui Input

```
h-9 rounded-md border border-input bg-transparent
px-3 py-1 text-base shadow-sm
focus-visible:ring-1 focus-visible:ring-ring
```

#### Labels

```tsx
<label className="
  text-gray-300 text-xs uppercase tracking-wider font-mono
">
  Field Name
</label>
```

#### Select

```
rounded-md border border-input bg-transparent
px-3 py-2 text-sm
focus:ring-1 focus:ring-ring shadow-sm
```

#### Switch

```
h-5 w-9 rounded-full shadow-sm
Thumb: h-4 w-4 rounded-full
Transition: data-[state=checked]:translate-x-4
```

#### Textarea

```
rounded-md border border-input bg-transparent
px-3 py-2 min-h-[60px]
focus-visible:ring-1 focus-visible:ring-ring
```

---

### Cards & Containers

#### shadcn/ui Card

```tsx
<Card>           {/* rounded-xl border bg-card text-card-foreground shadow */}
  <CardHeader>   {/* flex flex-col space-y-1.5 p-6 */}
    <CardTitle>  {/* font-semibold leading-none tracking-tight */}
    <CardDescription> {/* text-sm text-muted-foreground */}
  </CardHeader>
  <CardContent>  {/* p-6 pt-0 */}
  <CardFooter>   {/* flex items-center p-6 pt-0 */}
</Card>
```

---

### Terminal Container

The signature pattern. Square corners, 2px borders, title bar with brackets.

```tsx
<div className="border-2 border-gray-600 bg-black/80 backdrop-blur-sm">
  {/* Title Bar */}
  <div className="border-b-2 border-gray-600 px-3 py-2">
    <div className="text-xs text-gray-500 tracking-wider uppercase font-mono">
      [ COMPONENT NAME ]
    </div>
  </div>

  {/* Content */}
  <div className="px-4 py-4">
    {/* ... */}
  </div>
</div>
```

**Characteristics:**
- `border-2 border-gray-600` — 2px solid border
- `bg-black/80` — Semi-transparent black fill
- `backdrop-blur-sm` — Glassmorphic blur (4px)
- **No border-radius** — Square corners are the terminal signature
- Title uses `[ BRACKET SYNTAX ]` in uppercase

---

### Glassmorphic Card

Used on public-facing pages (landing, docs, whitepaper).

```tsx
<div className="
  border border-white/10
  bg-gradient-to-br from-white/5 to-white/[0.02]
  backdrop-blur-xl
  hover:border-white/20
  transition-all
">
  {/* Optional header */}
  <div className="border-b border-white/10 px-4 py-3 bg-white/5">
    {/* ... */}
  </div>

  {/* Content */}
  <div className="p-6">
    {/* ... */}
  </div>
</div>
```

**Characteristics:**
- 1px border at 10% white opacity
- Subtle gradient fill (5% to 2% white)
- Extra blur (`backdrop-blur-xl`)
- Hover brightens border to 20%

---

### Modals & Dialogs

```tsx
{/* Backdrop */}
<div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">

  {/* Modal */}
  <div className="
    relative w-full max-w-4xl max-h-[90vh] overflow-hidden
    border border-white/20
    bg-gradient-to-br from-black/95 to-black/90
    backdrop-blur-xl shadow-2xl
  ">

    {/* Sticky Header */}
    <div className="
      sticky top-0 z-10
      border-b border-white/10
      px-6 py-4
      bg-black/80 backdrop-blur-sm
      flex items-center justify-between
    ">
      <div className="text-xs text-gray-400 tracking-wider uppercase font-mono">
        Modal Title
      </div>
      <button className="
        p-2 text-gray-400
        hover:text-white hover:bg-white/10
        transition-all
        border border-white/10 hover:border-white/20
      ">
        <X size={18} />
      </button>
    </div>

    {/* Scrollable Body */}
    <div className="overflow-y-auto max-h-[calc(90vh-80px)] px-6 py-6">
      {/* Content */}
    </div>
  </div>
</div>
```

**Backdrop CSS:**
```css
.modal-backdrop {
  backdrop-filter: blur(8px);
  background-color: rgba(0, 0, 0, 0.8);
}
```

---

### Tables

Terminal-style tables with zebra striping:

```tsx
<table className="w-full text-sm font-mono">
  <thead>
    <tr className="border-b border-gray-700 text-xs text-gray-500 uppercase tracking-wider">
      <th className="px-3 py-2 text-left">Column</th>
    </tr>
  </thead>
  <tbody>
    <tr className="border-b border-gray-800 even:bg-white/[0.02] hover:bg-white/5 transition-colors">
      <td className="px-3 py-2 text-gray-300">Data</td>
    </tr>
  </tbody>
</table>
```

---

### Tooltips & Popovers

```
rounded-md px-3 py-1.5 text-xs
animate-in fade-in-0 zoom-in-95
```

---

### Status Indicators

#### Active Status

```tsx
<div className="text-sm text-gray-400 font-mono">
  <span className="text-green-500">&gt;</span> ACTIVE
</div>
```

#### Pulsing Dot

```tsx
<span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse" />
```

#### Compiling Status

```tsx
<div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
  <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse" />
  COMPILING
</div>
```

---

### Progress Bars

```tsx
<div className="flex items-center gap-3">
  <div className="flex-1 h-2 bg-white/10 overflow-hidden backdrop-blur-sm">
    <div
      className="h-full bg-gradient-to-r from-green-400/60 to-green-500/40"
      style={{ width: '48%' }}
    />
  </div>
  <span className="text-gray-300 text-sm font-semibold font-mono">48%</span>
</div>
```

- Track: `bg-white/10` (subtle)
- Fill: Green gradient (from-green-400/60 to-green-500/40)
- Label: Monospace with percentage

---

### Loading States

#### Spinner

```tsx
<div className="w-4 h-4 border-2 border-gray-700 border-t-green-500 rounded-full animate-spin" />
```

#### Full-Screen Loading

```tsx
<div className="min-h-screen px-4 py-8 flex items-center justify-center">
  <div className="border-2 border-gray-600 bg-black/80 backdrop-blur-sm px-6 py-4">
    <div className="flex items-center gap-3 text-sm font-mono">
      <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-green-500">&gt;</span>
      <span className="text-gray-400">Loading data...</span>
    </div>
  </div>
</div>
```

---

### Empty States

```tsx
<div className="border-2 border-gray-600 bg-black/80 backdrop-blur-sm">
  <div className="border-b-2 border-gray-600 px-3 py-2">
    <div className="text-xs text-gray-500 tracking-wider uppercase font-mono">
      [ SECTION NAME ]
    </div>
  </div>
  <div className="px-4 py-4 text-xs font-mono space-y-2">
    <div className="text-gray-600">
      <span className="text-green-500">&gt;</span> No data yet.
    </div>
    <div className="text-gray-700 text-xs">
      Helpful guidance message about what to do next.
    </div>
  </div>
</div>
```

---

### Error States

```tsx
<div className="border-2 border-red-500/50 bg-black/80 backdrop-blur-sm px-6 py-6">
  <div className="space-y-3 text-sm font-mono">
    <div className="text-red-500">
      <span>&gt;</span> Error loading data
    </div>
    <div className="text-gray-500">{error.message}</div>
    <button className="
      px-4 py-2
      border-2 border-green-500 bg-green-500/10
      text-green-500 hover:bg-green-500/20
      transition-colors font-mono text-xs uppercase tracking-wider
    ">
      &gt; Reload
    </button>
  </div>
</div>
```

---

## Navigation & Information Architecture

### Structure

Navigation is split into two groups separated visually:

1. **Entities** (core data types): Anima, Memories, Knowledge, Identity
2. **Tools** (operational views): Sandbox, Pipeline, Payloads, Dreams, Meditations, Logs

#### Active State Pattern

```tsx
/* Active */
className="text-{color} bg-{color}/10 border-b-2 border-{color}"

/* Inactive */
className="text-gray-400 hover:text-{color} transition-colors"
```

Each section has its own accent color (see Feature Color Map). The active state uses:
- Colored text
- 10% opacity background tint
- 2px bottom border in the section color

#### Nav Bar

```tsx
<header className="
  fixed top-0 left-0 right-0 z-50
  bg-black/80 backdrop-blur-sm
  border-b border-gray-900
">
  <div className="px-4 sm:px-8 py-4">
    {/* Logo + nav items */}
  </div>
</header>
```

#### Mobile: Hamburger menu at `md:` breakpoint (768px)

```tsx
{/* Desktop nav */}
<nav className="hidden md:flex items-center gap-8">{/* ... */}</nav>

{/* Mobile trigger */}
<button className="md:hidden"><Menu size={24} /></button>
```

---

## Iconography & Symbols

### Icon Library: Lucide React

All icons come from [Lucide](https://lucide.dev/) for consistency.

```tsx
<Icon size={18} className="text-gray-400 hover:text-gray-200 transition-colors" />
```

**Rules:**
- Keep stroke width consistent (Lucide defaults)
- Always pair with hover state
- Icon-only buttons must have `aria-label`

### Brand Symbols

#### Green Chevron (`>`)

The universal brand indicator. Used before status text, button labels, list items, empty state messages.

```tsx
<span className="text-green-500">&gt;</span>
```

#### Square Brackets (`[ ]`)

Terminal title bar identifier. Always uppercase.

```tsx
[ ANIMA CORE ]
[ MEMORIES ]
[ ELEPHANTASM LOGIN TERMINAL ]
```

#### Status Dots

```tsx
{/* Active */}
<span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />

{/* Inactive */}
<span className="w-2 h-2 bg-gray-600 rounded-full" />
```

---

## Animations & Motion

### Principles

1. **Fast feedback**: UI transitions are 200ms
2. **Smooth ambient**: Background animations are slow (5-60s)
3. **Ease-in-out everywhere**: The default easing curve
4. **Respect motion preferences**: Complex animations should be disableable

### Transition Durations

| Duration | Use |
|----------|-----|
| 200ms | Button hovers, nav highlights, color transitions (most common) |
| 300ms | Rail/panel hover effects, layout transitions |
| 500ms | Node label changes, emphasis transitions |
| 700ms | Nebula pulses, ambient effects |

### CSS Transitions

```css
/* Most common — color changes */
transition-colors duration-200

/* General UI feedback */
transition-all duration-200

/* Hover scale effects */
transition-transform duration-200

/* Fade effects */
transition-opacity duration-200
```

### Framer Motion Patterns

Used for component entrance/exit animations:

```tsx
/* Standard entrance */
initial={{ opacity: 0, y: -20, scale: 0.8 }}
animate={{ opacity: 1, y: 0, scale: 1 }}
exit={{ opacity: 0, scale: 0.8 }}
transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}

/* Staggered children */
transition={{ delay: index * 0.05 }}

/* Layout animations */
<AnimatePresence mode="popLayout">
```

### CSS Keyframes

#### Typewriter (Landing Page)

```css
@keyframes typing {
  from { width: 0; }
  to { width: 100%; }
}

@keyframes blink-caret {
  from, to { border-color: transparent; }
  50% { border-color: #f3f4f6; }
}

.typewriter {
  overflow: hidden;
  border-right: 3px solid #f3f4f6;
  white-space: nowrap;
  letter-spacing: 0.15em;
  animation:
    typing 3.5s steps(29, end) forwards,
    blink-caret 0.75s step-end 3.5s 3;
}
```

Staggered lines (`.typewriter-line-1` through `.typewriter-line-6`) each fade in and type sequentially with increasing delays.

**Mobile**: Typewriter disabled below 640px — text displays immediately and wraps naturally.

#### Background Animations

```css
/* Starfield twinkle (6s cycle) */
@keyframes twinkleStars {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

/* Slow star twinkle variant */
@keyframes twinkleStarsSlow {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 0.5; }
}

/* Nebula drift (60s cycle — very slow) */
@keyframes driftNebula {
  0% { transform: translate(0, 0); }
  50% { transform: translate(30px, -20px); }
  100% { transform: translate(0, 0); }
}

/* Particle field twinkle (5s cycle) */
@keyframes twinkle {
  0%, 100% { opacity: 0.1; }
  50% { opacity: 0.3; }
}
```

#### Interactive Animations

```css
/* Spinner */
animate-spin     /* 1s linear infinite rotation */

/* Pulse (status dots) */
animate-pulse    /* 2s cubic-bezier(0.4, 0, 0.6, 1) infinite */

/* Progress bar */
@keyframes progress {
  from { width: 0%; }
  to { width: 48%; }
}
```

---

## Backgrounds & Atmospherics

### 1. Particle Field (Dashboard/Platform)

Simple white dots at very low opacity with gentle twinkle:

```css
.particle-field {
  background-image:
    radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.1) 1px, transparent 1px),
    radial-gradient(1px 1px at 60% 70%, rgba(255,255,255,0.1) 1px, transparent 1px),
    /* 6+ more at varied positions */;
  background-size: 200px 200px, 300px 300px, 400px 400px /* varied for depth */;
  animation: twinkle 5s ease-in-out infinite;
}
```

### 2. Deep Space Starfield (Public Pages)

Multi-layered with nebulae + stars on fixed positioning (parallax):

```css
.deep-space-bg {
  background-color: #000000;
}

/* Layer 1: Nebula clouds */
.deep-space-bg::before {
  position: fixed;
  background:
    radial-gradient(ellipse at 20% 30%, rgba(30, 60, 100, 0.03) 0%, transparent 50%),
    radial-gradient(ellipse at 70% 60%, rgba(60, 30, 80, 0.02) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 80%, rgba(20, 80, 60, 0.025) 0%, transparent 50%);
  animation: driftNebula 60s ease-in-out infinite;
}

/* Layer 2: Star points */
.deep-space-bg::after {
  position: fixed;
  background-image:
    radial-gradient(circle at 15% 25%, rgba(255, 255, 255, 0.8) 0.5px, transparent 1px),
    radial-gradient(circle at 75% 15%, rgba(255, 255, 255, 0.7) 0.5px, transparent 1px),
    /* 18+ more stars */;
  animation: twinkleStars 6s ease-in-out infinite;
}
```

### 3. Galactic Cityscape (Landing Page)

Background image fixed to bottom with overlay:

```tsx
<div
  className="min-h-screen bg-bottom bg-no-repeat bg-fixed"
  style={{
    backgroundImage: 'url(/bg/galactic-cityscape-2.webp)',
    backgroundSize: '100% auto',
    backgroundColor: '#000000'
  }}
>
  <div className="absolute inset-0 bg-black/40" />
  {/* Content at z-10 */}
</div>
```

### 4. Nebula Glow Effects (Canvas Visualizations)

Layered radial gradients for ambient atmosphere:

```css
background:
  radial-gradient(ellipse at center,
    rgba(59, 130, 246, 0.12) 0%,
    rgba(59, 130, 246, 0.08) 30%,
    transparent 60%);
```

Color combos: blue `(59, 130, 246)`, cyan `(34, 211, 238)`, indigo `(99, 102, 241)` at 5-15% opacity.

---

## Scrollbar Styling

Custom scrollbars reinforce the brand:

```css
/* Green scrollbar (default) */
.custom-scrollbar::-webkit-scrollbar { height: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); }
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(34, 197, 94, 0.3);    /* green */
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(34, 197, 94, 0.5);
}

/* Cyan scrollbar (chat/interactive) */
.chat-scrollbar {
  scrollbar-color: rgba(6, 182, 212, 0.3) rgba(39, 39, 42, 0.5);
  scrollbar-width: thin;                  /* 8px */
}

/* Thin gray scrollbar */
.scrollbar-thin {
  scrollbar-color: #4b5563 transparent;
  scrollbar-width: thin;
}

/* Hidden scrollbar (still scrollable) */
.scrollbar-hide { scrollbar-width: none; }
```

---

## Responsive Design

### Breakpoints

```
sm:   640px    Tablet portrait
md:   768px    Tablet landscape / small laptop
lg:  1024px    Desktop
xl:  1280px    Large desktop
2xl: 1536px    Extra-large desktop
```

### Mobile-First Approach

Always start with mobile styles, add breakpoints for larger screens:

```tsx
className="
  text-xl              /* Mobile */
  sm:text-2xl          /* Tablet */
  md:text-4xl          /* Desktop */
"
```

### Common Responsive Patterns

```tsx
/* Navigation: hamburger below md */
<nav className="hidden md:flex items-center gap-8">{/* Desktop */}</nav>
<button className="md:hidden">{/* Mobile */}</button>

/* Padding */
className="px-4 py-8 sm:px-8 sm:py-12"

/* Grid columns */
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"

/* Typography scaling */
className="text-2xl tracking-tight sm:text-3xl sm:tracking-wide"
```

### Mobile Rules

1. **Disable complex animations** below 640px (typewriter, particles)
2. **Allow text wrapping** — remove `whitespace-nowrap`
3. **Touch targets** minimum 44px tall
4. **Horizontal scroll** for timeline/data views on small screens
5. **Sidebar collapse** — sidebars become bottom sheets or hidden panels

---

## Accessibility

### Color Contrast (WCAG AA)

| Element | Color on Black | Ratio | Pass |
|---------|---------------|-------|------|
| Body text | `#9ca3af` | 4.95:1 | AA |
| Headings | `#f3f4f6` | 18.3:1 | AAA |
| Green accent | `#22c55e` | 7.8:1 | AAA |
| Muted text | `#6b7280` | 3.4:1 | AA Large |

### Focus States

Always visible. Never remove focus outlines without replacement.

```css
/* Button focus */
button:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}

/* Input focus */
input:focus {
  border-color: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

/* shadcn/ui ring */
focus-visible:ring-1 focus-visible:ring-ring
```

### Keyboard Navigation

- **Tab order**: Logical flow (top to bottom, left to right)
- **Escape**: Closes modals
- **Enter/Space**: Activates buttons

### ARIA

```tsx
{/* Icon-only buttons */}
<button aria-label="Close"><X /></button>
<button aria-label="Toggle menu"><Menu /></button>
```

### Semantic HTML

Use `<header>`, `<nav>`, `<main>`, `<button>`. Avoid div-as-button. Provide alt text for images. Use `sr-only` for visually hidden labels.

---

## Adopting for Sister Products

### What to Keep Identical

These elements must be shared across all Kamino products:

1. **Font stack** — Geist Sans + Geist Mono + Space Mono (identical import)
2. **Green as brand accent** — `#22c55e` (green-500) for primary actions, chevrons, focus rings
3. **Dark-first background hierarchy** — `#000 → #0a0a0a → #1f2937 → #374151`
4. **Terminal container pattern** — `border-2 border-gray-600 bg-black/80`, `[ BRACKET HEADERS ]`, `>` chevrons
5. **CSS custom properties** — The full HSL token set (copy `globals.css` variables verbatim)
6. **Typography patterns** — Space Mono for UI chrome, Geist Sans for content, uppercase + tracking-wider for labels
7. **Glassmorphic treatment** — `backdrop-blur`, `bg-white/5`, `border-white/10` for elevated surfaces
8. **Transition timing** — 200ms ease-in-out for all interactive transitions
9. **shadcn/ui base** — New York style, neutral base, same component primitives
10. **Scrollbar styling** — Green-tinted custom scrollbars

### What to Customize Per Product

1. **Feature color map** — Each product defines its own section-to-color mapping, but should draw from the same Tailwind palette (use 400-500 shades)
2. **Background imagery** — Each product can have its own atmospheric backgrounds (starfields, particle effects, etc.) as long as they follow the layering pattern (fixed → overlay → content)
3. **Navigation structure** — Different sections, but same active state pattern (`text-{color} bg-{color}/10 border-b-2 border-{color}`)
4. **Component-specific patterns** — Tables, visualization canvases, data-specific UI can vary
5. **Hero/landing page** — Each product's public page can have its own character

### Quick-Start Checklist for a New Sister Product

- [ ] Install fonts: Geist Sans, Geist Mono, Space Mono (via `next/font/google` or equivalent)
- [ ] Copy CSS custom properties from [Theme Tokens](#theme-tokens-css-custom-properties) into your global CSS
- [ ] Install shadcn/ui with `style: "new-york"`, `baseColor: "neutral"`, `cssVariables: true`
- [ ] Copy scrollbar classes (`.custom-scrollbar`, `.scrollbar-thin`, `.scrollbar-hide`)
- [ ] Copy `.modal-backdrop` class
- [ ] Copy particle field / deep space CSS if using atmospheric backgrounds
- [ ] Define your feature color map (section name -> Tailwind color at 400 or 500 shade)
- [ ] Apply terminal container pattern for primary panels
- [ ] Use green (`#22c55e`) for: primary buttons, focus rings, chevrons, active states, brand accents
- [ ] Ensure all uppercase labels use `tracking-wider` and `font-mono` (Space Mono)
- [ ] Test WCAG AA contrast on all text elements
- [ ] Implement responsive nav with `md:` breakpoint hamburger toggle

### Anti-Patterns (Things to Avoid)

- **Bright/saturated backgrounds** — Backgrounds are always black/near-black; color comes from text and borders
- **Rounded terminal containers** — Terminal boxes are always square-cornered; only shadcn/ui components use border-radius
- **Serif fonts** — Never use serif fonts; the aesthetic is strictly mono + geometric sans
- **Heavy shadows** — Depth comes from background tiers and borders, not drop shadows
- **Color as background fill** — Feature colors are used at low opacity (`/10`, `/20`) for backgrounds; full-strength color is for text and borders only
- **Decorative animation** — Every animation must serve a purpose (feedback, status, ambient atmosphere)

---

