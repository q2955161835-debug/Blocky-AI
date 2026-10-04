# Text Animation Inspiration

Award-winning sites with exceptional typography in motion.

---

## Character-Level Animation

### Obys Agency

**URL**: https://obys.agency
**Award**: Awwwards SOTD, multiple awards

**What to study**:

- Character-by-character reveals
- Scroll-linked text animation
- Typography as hero element
- Mixed case styling

**Technique**: GSAP SplitText, custom easing, scroll-driven

---

### Locomotive

**URL**: https://locomotive.ca
**Award**: Awwwards SOTD

**What to study**:

- Smooth character stagger
- Masked text reveals
- Section title animations
- Font weight transitions

**Technique**: SplitText + Locomotive Scroll integration

---

### Aristide Benoist

**URL**: https://aristidebenoist.com
**Award**: Awwwards SOTD

**What to study**:

- Large display typography
- Character scatter effects
- Hover-triggered animations
- Creative font pairing

**Technique**: GSAP SplitText, random values, physics-based

---

## Word-Level Animation

### Basic/Dept

**URL**: https://www.basicagency.com
**Award**: Awwwards SOTD

**What to study**:

- Word-by-word reveals
- Clean, professional feel
- Scroll-triggered timing
- Hierarchy through motion

**Technique**: GSAP SplitText (words), intersection observer

---

### Rally

**URL**: https://rallyinteractive.com
**Award**: Awwwards SOTD

**What to study**:

- Word cascade animations
- Playful timing
- Portfolio item titles
- Navigation text effects

**Technique**: GSAP timelines, SplitText

---

## Line-Level Animation

### Apple

**URL**: https://www.apple.com/apple-intelligence/
**Award**: Industry standard

**What to study**:

- Line-by-line reveals
- Scroll-synchronized timing
- Headline hierarchy
- Subtext fade in

**Technique**: Native intersection observer, CSS animations

---

### Stripe

**URL**: https://stripe.com
**Award**: Multiple awards

**What to study**:

- Headline reveals
- Gradient text animation
- Code block animations
- Professional pacing

**Technique**: CSS animations, intersection observer, GSAP

---

## Masked Reveals

### Elegant Seagulls

**URL**: https://www.elegantseagulls.com
**Award**: Awwwards SOTD

**What to study**:

- Text clip-path reveals
- Scroll-linked masks
- Creative typography
- Color reveals

**Technique**: CSS clip-path + GSAP

---

### Monopo London

**URL**: https://monopo.london
**Award**: Awwwards Honorable Mention

**What to study**:

- Vertical mask reveals
- Staggered timing
- Bold typography choices
- Section transitions

**Technique**: Overflow hidden + transform

---

## Kinetic Typography

### Resn

**URL**: https://resn.co.nz
**Award**: Multiple FWA

**What to study**:

- Playful character physics
- Interactive text
- Experimental layouts
- Sound integration

**Technique**: Custom JS, WebGL text, GSAP

---

### Active Theory

**URL**: https://activetheory.net
**Award**: Multiple awards

**What to study**:

- Text distortion effects
- WebGL-enhanced type
- Responsive typography
- Performance optimization

**Technique**: Three.js text, GSAP

---

## Key Patterns Observed

### Entry Animation Types

```
Character level:
- Fade up stagger
- Rotation in
- Scale from center
- Random scatter → organized
- Typewriter effect

Word level:
- Slide up mask
- Fade stagger
- Scale pulse
- Blur → sharp

Line level:
- Y translate up
- Opacity fade
- Clip-path reveal
```

### Timing Patterns

```
Fast reads (headlines):
- Total duration: 0.6-1s
- Stagger: 0.02-0.05s

Slow reads (body text):
- Total duration: 1-2s
- Stagger: 0.05-0.1s

Scroll-linked:
- Start: entry 0%
- End: cover 30-50%
```

### Easing Choices

```
Premium feel:
- power3.out (most common)
- power4.out (dramatic)
- expo.out (very smooth)
- custom cubic-bezier

Playful feel:
- back.out (bounce)
- elastic.out (spring)
```

---

## Implementation Reference

### Character Stagger

```javascript
const split = new SplitText(".hero-title", { type: "chars" });

gsap.from(split.chars, {
  opacity: 0,
  y: 50,
  rotationX: -90,
  stagger: 0.02,
  duration: 0.8,
  ease: "power3.out",
});
```

### Masked Line Reveal

```javascript
const split = new SplitText(".text", {
  type: "lines",
  linesClass: "line-wrapper",
});

// Wrap each line for mask
split.lines.forEach((line) => {
  const wrapper = document.createElement("div");
  wrapper.className = "line-mask";
  line.parentNode.insertBefore(wrapper, line);
  wrapper.appendChild(line);
});

gsap.from(".line-wrapper > *", {
  yPercent: 100,
  stagger: 0.1,
  duration: 0.8,
  ease: "power3.out",
  scrollTrigger: {
    trigger: ".text",
    start: "top 80%",
  },
});
```

### Gradient Text Animation

```css
.gradient-text {
  background: linear-gradient(90deg, #667eea, #764ba2, #667eea);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: gradient-shift 3s ease infinite;
}

@keyframes gradient-shift {
  0%,
  100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}
```

---

## Questions to Ask

When studying these sites:

1. Is animation character, word, or line based?
2. What's the total animation duration?
3. How does it interact with scroll?
4. What's the easing curve?
5. How does it handle responsive text?
6. Does the animation reveal meaning or just look cool?
