# Horizontal Scroll Inspiration

Award-winning sites featuring horizontal scroll sections.

---

## Portfolio Style

### Studio Freight

**URL**: https://www.studiofreight.com
**Award**: Awwwards SOTD

**What to study**:

- Smooth horizontal project gallery
- Project preview on hover
- Seamless transition to project detail
- Mobile fallback handling

**Technique**: GSAP ScrollTrigger with pin, custom cursor, Locomotive Scroll integration

---

### Lusion

**URL**: https://lusion.co
**Award**: Awwwards SOTD, FWA

**What to study**:

- WebGL-enhanced horizontal scroll
- Depth and parallax within sections
- Fluid project transitions
- Sound design integration

**Technique**: Three.js + GSAP, custom scroll management

---

### Active Theory

**URL**: https://activetheory.net
**Award**: Multiple Awwwards

**What to study**:

- Immersive horizontal case studies
- Project preview animations
- Navigation system for long scrolls
- Performance optimization

**Technique**: Custom scroll engine, WebGL backgrounds

---

## Storytelling Style

### Apple AirPods Pro

**URL**: https://www.apple.com/airpods-pro/
**Award**: Industry standard

**What to study**:

- Product features revealed horizontally
- Text and product sync
- Mobile adaptation
- Performance on low-end devices

**Technique**: Native scroll with transforms, intersection observer

---

### Locomotive

**URL**: https://locomotive.ca
**Award**: Awwwards SOTD

**What to study**:

- Smooth-as-butter scroll feel
- Subtle parallax within horizontal
- Typography hierarchy
- Progress indicator design

**Technique**: Locomotive Scroll library (which they created)

---

### Resn

**URL**: https://resn.co.nz
**Award**: Multiple FWA, Awwwards

**What to study**:

- Experimental horizontal navigation
- Project cards with depth
- Playful micro-interactions
- Sound integration

**Technique**: Custom WebGL, GSAP timelines

---

## Gallery Style

### ETQ Amsterdam

**URL**: https://www.etq-amsterdam.com
**Award**: Awwwards Honorable Mention

**What to study**:

- Product image gallery horizontal scroll
- Clean, minimal aesthetic
- E-commerce integration
- Quick add-to-cart from gallery

**Technique**: CSS scroll-snap with enhancements

---

### Moooi

**URL**: https://www.moooi.com
**Award**: Awwwards SOTD

**What to study**:

- Furniture showcases
- Image quality and loading
- Horizontal to vertical transitions
- Color theme changes per section

**Technique**: GSAP ScrollTrigger, lazy loading

---

## Key Patterns Observed

### Progress Indicators

```
Most sites include:
- Dot navigation (clickable)
- Progress bar
- Section counter (01/05)
- Scroll hint on first load
```

### Mobile Handling

```
Common approaches:
- Stack vertically on mobile (most common)
- Native horizontal scroll with snap
- Reduced animation on mobile
- Touch swipe gestures
```

### Performance

```
Best practices from these sites:
- Lazy load images per section
- Preload next section
- Use will-change sparingly
- Optimize for 60fps scroll
```

---

## Implementation Reference

Based on patterns from these sites:

### Basic Structure

```javascript
// Common to most sites
gsap.to(".track", {
  x: () => -(trackWidth - windowWidth),
  ease: "none",
  scrollTrigger: {
    trigger: ".container",
    pin: true,
    scrub: 1,
    end: () => `+=${trackWidth}`,
  },
});
```

### Parallax Within Horizontal

```javascript
// Used by Locomotive, Lusion
gsap.to(".section-bg", {
  x: -100,
  scrollTrigger: {
    trigger: ".section",
    containerAnimation: scrollTween, // Link to main horizontal
    scrub: true,
  },
});
```

### Progress Indicator

```javascript
// Common pattern
ScrollTrigger.create({
  trigger: ".container",
  onUpdate: (self) => {
    progressBar.style.transform = `scaleX(${self.progress})`;
  },
});
```

---

## Questions to Ask

When studying these sites:

1. How long is each section visible?
2. What triggers the content animations within sections?
3. How does the nav/header behave?
4. What's the scroll-to-pixel ratio?
5. How do they handle browser resize?
6. What's the mobile experience?
