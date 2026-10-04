# Archetype Case Studies

Five production website archetypes, each demonstrating how design decisions work together to serve a specific audience and brand personality.

## Table of Contents

1. [Digital Studio — Modern/Bold](#digital-studio--modernbold)
2. [Luxury Fragrance E-commerce — Refined/Editorial](#luxury-fragrance-e-commerce--refinededitorial)
3. [Mental Health Clinic — Warm/Inclusive](#mental-health-clinic--warminclusive)
4. [Criminal Defense Firm — Authoritative/Editorial](#criminal-defense-firm--authoritativeeditorial)
5. [Community Pharmacy — Professional/Trustworthy](#community-pharmacy--professionaltrustworthy)

---

## Digital Studio — Modern/Bold

**Brand feel:** "We're technically excellent and unapologetically confident."

### Type Pairing

Space Grotesk (display) + Inter (body) + JetBrains Mono (labels). The geometric sans signals technical precision. Tight letter-spacing on display (-0.03em) creates density and impact. Mono labels in uppercase with 0.15em tracking provide rhythmic counterpoint.

### Color Strategy

Warm charcoal base (#1a1614) with coral (#f97316) and lime (#D5FA71) accents. The dark foundation feels premium; dual accent colors (warm + cool) create energy without chaos. Text uses warm whites (rgba overlays, not pure white).

### Key Layout Patterns

- Generous fluid spacing: `clamp(7rem, 14vw, 12rem)` between sections
- Horizontal scroll for project showcase (desktop pinned, mobile vertical fallback)
- Embedded scrollable viewport for work gallery with gradient hint overlay
- Condensing navbar (pill-shaped on scroll, `cubic-bezier(0.22, 1, 0.36, 1)`)

### Animation Strategy

Complete GSAP utility library: reveal, staggerReveal, batchReveal, splitReveal (with mask mode), parallax, horizontalScroll, countUp. Lenis smooth scroll (duration: 1.2, exponential easing). Every animation respects `prefers-reduced-motion` via `gsap.matchMedia()`.

### Unique Elements

- Rolling text hover on nav links (CSS-only dual-layer translateY)
- Film grain overlay (SVG feTurbulence, opacity 0.035)
- Decorative gradient rules (transparent → border → accent → border → transparent)
- Ticker/marquee component (40s infinite scroll)
- Accent glow effect (double box-shadow)

**Cross-references:**
→ GSAP utilities: **elite-gsap/utility-library.md**
→ Grain overlay: **elite-design-core/design-tokens.md**
→ Micro-interactions: **elite-css-animations/visual-effects.md**
→ Lenis: **elite-gsap/smooth-scroll.md**

---

## Luxury Fragrance E-commerce — Refined/Editorial

**Brand feel:** "Discover something rare and beautiful."

### Type Pairing

Cormorant Garamond (headings + italic accent) + Poppins (body). The high-contrast serif evokes luxury and editorial quality. Italic variant serves as an accent font for feature text and quotes. Poppins provides modern legibility at body size.

### Color Strategy

Ink on off-white (#fafafa) with Arabian gold (#b8956a) accent. Scent-family color coding maps colors to product categories: citrus (#d4a843), floral (#c47088), woody (#8b6e4e), oriental (#b85c3e), fresh (#5e9e9b), gourmand (#a0664b). This semantic color system helps users navigate by fragrance family.

### Key Layout Patterns

- 12-column named-line grid with full-bleed support
- Moderate fluid spacing: `clamp(4rem, 8vw, 8rem)`
- Product grid with `content-visibility: auto` for lazy rendering
- CSS scroll-driven reveal (no JavaScript needed)

### Animation Strategy

CSS-first approach: scroll progress bar (`animation-timeline: scroll()`), reveal-on-scroll (`animation-timeline: view()`), shimmer loading skeletons, hover-lift cards. View Transitions API for smooth page navigation. GSAP reserved for complex sequences.

### Unique Elements

- Scent-family color coding (colors = product taxonomy)
- Shimmer skeleton loading animation
- Scarcity badges with tiered urgency (critical/warning/low)
- Sticky add-to-cart bar (mobile, IntersectionObserver trigger)
- `content-visibility: auto` on sections for render performance

**Cross-references:**
→ Scroll-driven CSS: **elite-css-animations/scroll-driven-api.md**
→ Category colors: **elite-design-core/color-theory.md**
→ Scarcity patterns: **elite-ux-strategy/social-proof-trust.md**

---

## Mental Health Clinic — Warm/Inclusive

**Brand feel:** "This is a safe space. You're understood here."

### Type Pairing

Fraunces (headings, variable) + Inter (body). Fraunces uses `font-variation-settings: 'opsz' 32, 'WONK' 0, 'SOFT' 50` — literally softening the letterforms. The typography itself communicates safety. Inter provides clinical clarity without coldness.

### Color Strategy

Cream (#faf6f1) base with an expanded meaning-driven palette:

- **Plum** (primary) — wisdom, depth, calm
- **Lavender** (decorative) — softness, serenity
- **Sage** (secondary) — growth, healing
- **Rose** (warm) — empathy, human connection
- **Neutral** — warm-tinted greys (never pure grey)

Full 50-950 shade scales per color. Semantic token layer (`--color-text-primary: var(--color-plum-900)`) ensures components never reference raw values.

### Key Layout Patterns

- Balanced spacing: `clamp(4rem, 10vw, 7rem)`
- Generous border-radius (soft, rounded: `--radius-xl: 1rem`, `--radius-full: 9999px`)
- Plum-tinted shadows: `rgba(40, 33, 62, 0.06)` instead of black
- Tag system with semantic colors (sage tags, rose tags, lavender tags)

### Animation Strategy

GSAP with Lenis smooth scroll. DrawSVGPlugin for hand-drawn SVG arrow (organic, non-mechanical). Center-based stagger on specialty pills (`stagger: { each: 0.08, from: 'center' }`). Typewriter component (Svelte 5 runes) with reduced-motion fallback to static first word.

### Unique Elements

- Hand-drawn SVG arrow with DrawSVG animation
- Center-based stagger (pills expand outward from center)
- Typewriter effect (50ms type, 30ms delete, 2.5s hold)
- Quiz-based therapist matching (multi-phase flow)
- Trust strip with insurance provider logos
- `back.out(1.7)` easing for friendly spring-in effects

**Cross-references:**
→ DrawSVG pattern: **elite-gsap/morphsvg-drawsvg.md**
→ Dual-layer tokens: **elite-design-core/color-theory.md**
→ Quiz flow: **elite-ux-strategy/forms-ctas.md**
→ Plum-tinted shadows: **elite-accessibility/inclusive-aesthetics.md**

---

## Criminal Defense Firm — Authoritative/Editorial

**Brand feel:** "Serious representation. No fluff."

### Type Pairing

Gelasio (serif display) + Inter (sans body). Gelasio's sturdy serifs project authority and permanence. Headlines at `clamp(3rem, 2rem + 4vw, 5rem)` with -0.03em tracking create commanding presence. Gold-colored labels signal premium positioning.

### Color Strategy

Navy (#1E3A5F) and midnight (#0F1B2D) with gold (#C9A84C) accent. Traditional power colors: the navy/gold combination is universal shorthand for authority and premium quality. Warm white (#F8F6F0) softens what could otherwise feel cold.

### Key Layout Patterns

- Global sharp corners: `border-radius: 0 !important` — editorial, no softness
- Container-frame guides: fixed vertical lines at content edges for editorial precision
- Spacious sections: `clamp(5rem, 10vw, 9rem)`
- Gold accent line (2.5rem × 2px) as section punctuation

### Animation Strategy

GSAP with standard reveal/stagger utilities. Conservative motion — authority doesn't need flashy animation. Focus on precision timing and clean transitions.

### Unique Elements

- Global zero border-radius enforcement (strong brand signal)
- Fixed container-frame pseudo-element guides
- Gold accent line as decorative separator
- Grain texture (opacity 0.08 — more prominent than the studio's 0.035)
- Mobile bottom CTA bar (split grid: call + consultation buttons)

**Cross-references:**
→ Container-frame: **elite-layouts/editorial-patterns.md**
→ Sharp corners: **elite-layouts/editorial-patterns.md**
→ Mobile CTA bar: **elite-ux-strategy/mobile-conversion.md**

---

## Community Pharmacy — Professional/Trustworthy

**Brand feel:** "Expert care, modern convenience."

### Type Pairing

DM Serif Display (headings) + DM Sans (body). A built-to-pair combination from the same type family — zero tension between them. The serif adds warmth to headings without the coldness of clinical settings. DM Sans provides exceptional legibility.

### Color Strategy

Clean, functional palette with warm neutrals. No flashy accents — the design says "we're competent and reliable." Professional healthcare palette avoids the extremes of both clinical sterility and excessive warmth.

### Key Layout Patterns

- Higher density spacing: `clamp(3rem, 6vw, 5rem)` — information-efficient
- Service bento grid for quick scanning
- Standard container with moderate max-width
- Clear information hierarchy without decorative excess

### Animation Strategy

Minimal — standard scroll reveals. This archetype demonstrates that elite design doesn't require heavy animation. The restraint itself is the design choice.

### Unique Elements

- Matched type family (DM Serif Display + DM Sans)
- High information density with clear hierarchy
- Design restraint as brand signal — "we respect your time"

**Cross-references:**
→ Typography pairing: **elite-design-core/typography.md**
