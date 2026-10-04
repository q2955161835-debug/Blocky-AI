# Bento Grid Inspiration

Award-winning sites featuring asymmetric, Apple-style grids.

---

## Product Showcases

### Apple (Various Products)

**URL**: https://www.apple.com/iphone-16-pro/
**Standard**: Industry defining

**What to study**:

- Feature highlight cards
- Icon + text + visual balance
- Responsive grid reflow
- Scroll-triggered animations per card

**Technique**: CSS Grid, scroll-driven animations, video optimization

---

### Linear

**URL**: https://linear.app
**Award**: Awwwards Honorable Mention

**What to study**:

- SaaS feature grid
- Dark theme execution
- Card depth and shadows
- Feature demo videos in cards

**Technique**: CSS Grid, Framer Motion, video lazy loading

---

### Raycast

**URL**: https://www.raycast.com
**Award**: Multiple design awards

**What to study**:

- Clean bento for features
- Interactive demo cards
- Gradient backgrounds
- Smooth hover states

**Technique**: CSS Grid, React, WebGL accents

---

## Dashboard Style

### Vercel

**URL**: https://vercel.com
**Award**: Awwwards Honorable Mention

**What to study**:

- Metrics and stats cards
- Code preview cards
- Integration logos grid
- Dark/light theme handling

**Technique**: CSS Grid, Tailwind, Next.js

---

### Stripe

**URL**: https://stripe.com
**Award**: Multiple awards

**What to study**:

- Payment flow illustrations
- Animated product demos
- Developer tool cards
- Global availability map card

**Technique**: CSS Grid, GSAP, SVG animations

---

### Notion

**URL**: https://www.notion.so
**Award**: Awwwards Honorable Mention

**What to study**:

- Feature blocks layout
- Template gallery grid
- Use case cards
- Interactive previews

**Technique**: CSS Grid, React, intersection observer

---

## Portfolio/Agency Style

### Basic/Dept

**URL**: https://www.basicagency.com
**Award**: Awwwards SOTD

**What to study**:

- Case study grid
- Image hover effects
- Staggered reveal animations
- Filter/sort with FLIP

**Technique**: CSS Grid, GSAP Flip, custom cursor

---

### Pentagram

**URL**: https://www.pentagram.com
**Award**: Design classic

**What to study**:

- Project grid masonry
- Category filtering
- Image quality handling
- Load more pattern

**Technique**: CSS Grid, lazy loading, masonry layout

---

### Fantasy

**URL**: https://fantasy.co
**Award**: Awwwards SOTD

**What to study**:

- Work showcase grid
- Video previews
- Smooth filtering
- Responsive behavior

**Technique**: CSS Grid, GSAP, video optimization

---

## E-commerce Style

### Allbirds

**URL**: https://www.allbirds.com
**Award**: Awwwards Honorable Mention

**What to study**:

- Product category grid
- Sustainability feature cards
- Image optimization
- Quick shop integration

**Technique**: CSS Grid, React, image CDN

---

### Glossier

**URL**: https://www.glossier.com
**Award**: Design recognition

**What to study**:

- Product feature grid
- UGC integration cards
- Pink brand consistency
- Mobile-first grid

**Technique**: CSS Grid, Next.js

---

## Key Patterns Observed

### Grid Structure

```
Common column counts:
- Desktop: 4 columns
- Tablet: 3 columns
- Mobile: 2 columns (or 1)

Common spans:
- Hero card: 2x2
- Feature card: 2x1 (wide)
- Stat card: 1x1
- Tall content: 1x2
```

### Animation Patterns

```
Entry animations:
- Stagger from grid position
- Scale up + fade
- Reveal from bottom

Hover states:
- Lift with shadow
- Background shift
- Content reveal
- Video preview play
```

### Card Anatomy

```
Typical card structure:
┌─────────────────────┐
│  Icon/Visual        │
│                     │
│  Title              │
│  Description        │
│                     │
│  [Optional: CTA]    │
└─────────────────────┘
```

---

## Implementation Reference

### Basic Bento Structure

```css
.bento-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: minmax(200px, auto);
  gap: 1rem;
}

.card.featured {
  grid-column: span 2;
  grid-row: span 2;
}
```

### Apple-Style Card

```css
.bento-card {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 24px;
  padding: 2rem;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

### Staggered Reveal

```javascript
gsap.from(".bento-card", {
  opacity: 0,
  y: 50,
  scale: 0.95,
  stagger: {
    amount: 0.8,
    grid: "auto",
    from: "start",
  },
  scrollTrigger: {
    trigger: ".bento-grid",
    start: "top 80%",
  },
});
```

---

## Questions to Ask

When studying these sites:

1. How many card sizes/types do they use?
2. What content goes in which size card?
3. How do they handle uneven content lengths?
4. What's the mobile grid fallback?
5. How do hover states differ by card type?
6. Are there interactive elements within cards?
