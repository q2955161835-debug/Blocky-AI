# Parallax Inspiration

Award-winning sites with depth and scroll-driven movement.

---

## Multi-Layer Parallax

### Apple iPhone

**URL**: https://www.apple.com/iphone/
**Standard**: Industry defining

**What to study**:

- Product depth layers
- Text and device sync
- Performance optimization
- Mobile handling

**Technique**: Transform-based, intersection observer, video fallback

---

### Porsche (Various)

**URL**: https://www.porsche.com
**Award**: Multiple awards

**What to study**:

- Car photography layers
- Dramatic reveal sequences
- Brand storytelling
- High-resolution handling

**Technique**: GSAP ScrollTrigger, optimized images

---

### Locomotive

**URL**: https://locomotive.ca
**Award**: Awwwards SOTD

**What to study**:

- Subtle parallax throughout
- Text/image layer separation
- Smooth scroll feel
- Consistent depth language

**Technique**: Locomotive Scroll (their library)

---

## Immersive Storytelling

### NASA (Various Projects)

**URL**: https://eyes.nasa.gov
**Award**: Multiple Webby Awards

**What to study**:

- Space exploration narratives
- Data visualization parallax
- Educational sequencing
- Accessibility considerations

**Technique**: WebGL, Three.js, scroll-linked

---

### The Boat

**URL**: https://www.sbs.com.au/theboat/
**Award**: FWA, Awwwards

**What to study**:

- Graphic novel scroll
- Illustration layers
- Emotional pacing
- Sound integration

**Technique**: Canvas-based, GSAP, audio sync

---

### Bear Creek Distillery

**URL**: https://bearcreekdistillery.com
**Award**: Awwwards SOTD

**What to study**:

- Rural landscape layers
- Product integration
- Atmospheric depth
- Scroll-based reveals

**Technique**: GSAP ScrollTrigger, layered images

---

## Sticky Section Parallax

### Zajno

**URL**: https://zajno.com
**Award**: Multiple Awwwards

**What to study**:

- Pinned section reveals
- Content within pinned areas
- Transition choreography
- Portfolio navigation

**Technique**: GSAP ScrollTrigger pin

---

### Fantasy

**URL**: https://fantasy.co
**Award**: Awwwards SOTD

**What to study**:

- Case study reveals
- Image/text parallax offset
- Smooth section transitions
- Clean execution

**Technique**: GSAP, pinned sections

---

## Product Showcase Parallax

### Apple AirPods

**URL**: https://www.apple.com/airpods-pro/
**Award**: Industry standard

**What to study**:

- Product floating in space
- Feature callouts sync
- 360° product rotation
- Scroll-to-feature mapping

**Technique**: Scroll-linked transforms, video sequences

---

### Google Pixel

**URL**: https://store.google.com/product/pixel_9_pro
**Award**: Design excellence

**What to study**:

- Device showcase
- Feature highlighting
- Color option changes
- Mobile adaptation

**Technique**: GSAP, video, intersection observer

---

## Key Patterns Observed

### Layer Configuration

```
Typical layer setup:
- Background (slowest): 0.2x scroll speed
- Midground: 0.5x scroll speed
- Content: 1x scroll speed
- Foreground: 1.2-1.5x scroll speed

Depth formula:
transform: translateY(scrollY * speedMultiplier)
```

### Scroll Speed Ratios

```
Subtle parallax: 0.9-1.1x (barely noticeable)
Moderate: 0.5-0.8x (clearly layered)
Dramatic: 0.2-0.4x (very separated)
Inverse: 1.2-1.5x (foreground elements)
```

### Common Compositions

```
Hero parallax:
┌──────────────────────┐
│ ░░░ Sky (0.3x) ░░░   │
│ ▓▓ Mountains (0.5x) ▓│
│ █ Content (1x) █████ │
│ ▀▀ Foreground (1.2x) │
└──────────────────────┘

Product parallax:
┌──────────────────────┐
│ Gradient bg (0.5x)   │
│     [Product]        │
│ Feature text (1x)    │
│ Detail element (1.5x)│
└──────────────────────┘
```

---

## Implementation Reference

### Basic Multi-Layer

```javascript
gsap.to(".layer-bg", {
  y: "-30%",
  ease: "none",
  scrollTrigger: {
    trigger: ".parallax-section",
    start: "top bottom",
    end: "bottom top",
    scrub: true,
  },
});

gsap.to(".layer-mid", {
  y: "-15%",
  ease: "none",
  scrollTrigger: {
    trigger: ".parallax-section",
    start: "top bottom",
    end: "bottom top",
    scrub: true,
  },
});
```

### CSS-Only Parallax

```css
.parallax-container {
  perspective: 1px;
  height: 100vh;
  overflow-x: hidden;
  overflow-y: auto;
}

.parallax-layer {
  position: absolute;
  inset: 0;
}

.layer-back {
  transform: translateZ(-1px) scale(2);
}

.layer-front {
  transform: translateZ(0);
}
```

### Scroll-Driven API

```css
/* Parallax is a vestibular trigger — gate it behind the motion query.
   The base state stays put (translateY(0)), so reduced-motion users and
   browsers without scroll-driven support get a static image, not a jump. */
@media (prefers-reduced-motion: no-preference) {
  .parallax-bg {
    animation: parallax linear;
    animation-timeline: scroll();
  }
}

@keyframes parallax {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-30%);
  }
}
```

---

## Performance Notes

### From Award Winners

```
What they do:
- Use transform only (GPU)
- Lazy load layer images
- Reduce layers on mobile
- Simplify for reduced motion
- Test on mid-range devices
```

### Mobile Handling

```
Common approaches:
- Reduce parallax intensity (0.5x desktop values)
- Remove some layers entirely
- Convert to scroll-snap sections
- Use static positioning
- Disable for low-end devices
```

---

## Questions to Ask

When studying these sites:

1. How many layers are there?
2. What's the speed ratio between layers?
3. How does content relate to parallax?
4. What happens on mobile?
5. Is there a reduced motion alternative?
6. How does it affect page performance?
