# Agency Portfolio Inspiration

Award-winning creative agency and studio portfolio sites.

---

## Horizontal Navigation

### Studio Freight

**URL**: https://www.studiofreight.com
**Award**: Awwwards SOTD

**What to study**:

- Horizontal project showcase
- Project preview on hover
- Custom cursor integration
- Minimal, type-focused design

**Technique**: GSAP ScrollTrigger, Locomotive Scroll, WebGL

---

### Active Theory

**URL**: https://activetheory.net
**Award**: Multiple awards

**What to study**:

- WebGL-enhanced navigation
- Immersive project entries
- Sound design integration
- Technical showcase

**Technique**: Three.js, custom scroll, GSAP

---

### Resn

**URL**: https://resn.co.nz
**Award**: Multiple FWA, Awwwards

**What to study**:

- Playful, experimental navigation
- Project card interactions
- Personality through motion
- New Zealand character

**Technique**: Custom JS, WebGL, GSAP

---

## Grid-Based

### Basic/Dept

**URL**: https://www.basicagency.com
**Award**: Awwwards SOTD

**What to study**:

- Clean grid layout
- Filter/sort with FLIP
- Project hover reveals
- Professional polish

**Technique**: CSS Grid, GSAP Flip, clean aesthetic

---

### Huge

**URL**: https://www.hugeinc.com
**Award**: Multiple awards

**What to study**:

- Enterprise-scale portfolio
- Case study depth
- Clear categorization
- Brand consistency

**Technique**: React, GSAP, video integration

---

### Fantasy

**URL**: https://fantasy.co
**Award**: Awwwards SOTD

**What to study**:

- Work grid with video previews
- Smooth filtering
- Case study transitions
- Dark theme execution

**Technique**: GSAP, video, grid layouts

---

## Immersive/Experimental

### Locomotive

**URL**: https://locomotive.ca
**Award**: Awwwards SOTD

**What to study**:

- Smooth scroll feel
- Typography hierarchy
- Subtle animations
- Tool showcase (their scroll library)

**Technique**: Locomotive Scroll, GSAP

---

### Lusion

**URL**: https://lusion.co
**Award**: Awwwards SOTD, FWA

**What to study**:

- WebGL integration
- Sound design
- Immersive project entries
- Technical excellence

**Technique**: Three.js, GSAP, audio

---

### Aristide Benoist

**URL**: https://aristidebenoist.com
**Award**: Awwwards SOTD

**What to study**:

- Personal portfolio style
- Typography as hero
- Character animations
- Creative expression

**Technique**: GSAP SplitText, custom interactions

---

## Minimal/Type-Focused

### Rally

**URL**: https://rallyinteractive.com
**Award**: Awwwards SOTD

**What to study**:

- Clean, minimal design
- Strong typography
- Subtle motion
- Case study structure

**Technique**: GSAP, clean code

---

### Pentagram

**URL**: https://www.pentagram.com
**Award**: Design classic

**What to study**:

- Design firm standard
- Project archive system
- Partner showcases
- Timeless approach

**Technique**: Clean, focused on content

---

### Ueno

**URL**: https://ueno.co
**Award**: Multiple awards

**What to study**:

- Brand personality
- Case study depth
- Team culture showcase
- International presence

**Technique**: React, GSAP, playful details

---

## Key Patterns Observed

### Navigation Styles

```
Horizontal scroll:
- Pin main area
- Scroll through projects
- Click to detail page

Grid with filters:
- Category filters
- Animated filtering (FLIP)
- Load more / infinite scroll

List view:
- Hover reveals project
- Video/image previews
- Click to full case study
```

### Project Preview Patterns

```
On hover:
- Image/video reveal
- Title animation
- Cursor change
- Background shift

Preview content:
- Hero image/video
- Project title
- Client name
- Category/year
```

### Case Study Structure

```
Typical flow:
1. Hero image/video
2. Project overview (client, role, year)
3. Challenge/brief
4. Solution narrative
5. Visual showcase (images, video)
6. Results/metrics
7. Next project navigation
```

---

## Implementation Reference

### Project Hover Preview

```javascript
const projects = document.querySelectorAll(".project-item");
const preview = document.querySelector(".project-preview");

projects.forEach((project) => {
  project.addEventListener("mouseenter", () => {
    const image = project.dataset.image;
    preview.style.backgroundImage = `url(${image})`;

    gsap.to(preview, {
      opacity: 1,
      scale: 1,
      duration: 0.4,
      ease: "power2.out",
    });
  });

  project.addEventListener("mouseleave", () => {
    gsap.to(preview, {
      opacity: 0,
      scale: 0.95,
      duration: 0.3,
    });
  });
});
```

### Custom Cursor

```javascript
const cursor = document.querySelector(".custom-cursor");

document.addEventListener("mousemove", (e) => {
  gsap.to(cursor, {
    x: e.clientX,
    y: e.clientY,
    duration: 0.15,
    ease: "power2.out",
  });
});

// Cursor states
document.querySelectorAll("[data-cursor]").forEach((el) => {
  el.addEventListener("mouseenter", () => {
    cursor.classList.add(el.dataset.cursor);
  });
  el.addEventListener("mouseleave", () => {
    cursor.classList.remove(el.dataset.cursor);
  });
});
```

### Project Filter

```javascript
const filterBtns = document.querySelectorAll(".filter-btn");
const projects = document.querySelectorAll(".project");

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const filter = btn.dataset.filter;

    // Capture state
    const state = Flip.getState(projects);

    // Apply filter
    projects.forEach((project) => {
      const show = filter === "all" || project.dataset.category === filter;
      project.style.display = show ? "" : "none";
    });

    // Animate
    Flip.from(state, {
      duration: 0.5,
      ease: "power2.inOut",
      stagger: 0.02,
      absolute: true,
    });
  });
});
```

### Page Transition

```javascript
// Using View Transitions API
function navigateToProject(url) {
  if (document.startViewTransition) {
    document.startViewTransition(async () => {
      const response = await fetch(url);
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      document.querySelector("main").replaceWith(doc.querySelector("main"));
      history.pushState({}, "", url);
    });
  } else {
    window.location = url;
  }
}
```

---

## Agency Site Checklist

### Must-Haves

- [ ] Clear work showcase
- [ ] Case study depth
- [ ] About/team section
- [ ] Contact information
- [ ] Fast loading
- [ ] Mobile optimized

### Nice-to-Haves

- [ ] Custom cursor
- [ ] Page transitions
- [ ] Sound design
- [ ] WebGL elements
- [ ] Award badges
- [ ] Blog/insights

---

## Questions to Ask

When studying these sites:

1. How do they present their best work?
2. What's the project detail depth?
3. How do they show personality?
4. What's the navigation structure?
5. How do they handle many projects?
6. What makes their approach unique?
