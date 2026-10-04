# Micro-interaction Inspiration

Subtle animations that bring interfaces to life.

---

## Button Interactions

### Stripe

**URL**: https://stripe.com
**What to study**:

- Button hover states
- Loading indicators
- Success animations
- Gradient button effects

**Patterns**:

```css
/* Stripe-style button */
.btn {
  background: linear-gradient(135deg, #667eea, #764ba2);
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn:active {
  transform: translateY(0);
}
```

---

### Linear

**URL**: https://linear.app
**What to study**:

- Subtle hover lifts
- Icon animations in buttons
- Loading spinners
- Toggle switches

---

### Vercel

**URL**: https://vercel.com
**What to study**:

- Deploy button states
- Copy code feedback
- Navigation highlights
- Toast notifications

---

## Form Interactions

### Typeform

**URL**: https://www.typeform.com
**What to study**:

- Field focus states
- Input validation feedback
- Progress indication
- Multi-step transitions

---

### Stripe Elements

**URL**: https://stripe.com/docs/payments/elements
**What to study**:

- Card input formatting
- Real-time validation
- Error messaging
- Success feedback

---

### Framer

**URL**: https://www.framer.com
**What to study**:

- Placeholder animations
- Label transitions
- Dropdown menus
- Color pickers

---

## Navigation Interactions

### Apple

**URL**: https://www.apple.com
**What to study**:

- Nav hover underlines
- Dropdown reveals
- Mega menu animations
- Mobile menu transitions

---

### Stripe (Nav)

**URL**: https://stripe.com
**What to study**:

- Products dropdown
- Hover timing
- Background transitions
- Mobile adaptation

---

### Linear (Nav)

**URL**: https://linear.app
**What to study**:

- Minimal nav hover
- Command palette (⌘K)
- Keyboard navigation
- Focus indicators

---

## Feedback & States

### Notion

**URL**: https://www.notion.so
**What to study**:

- Drag and drop feedback
- Checkbox animations
- Page loading states
- Collaborative presence

---

### Figma

**URL**: https://www.figma.com
**What to study**:

- Cursor multiplayer
- Selection feedback
- Tool switching
- Zoom transitions

---

### GitHub

**URL**: https://github.com
**What to study**:

- Contribution graph hover
- Diff highlighting
- Copy feedback
- Loading skeletons

---

## Key Patterns Observed

### Hover States

```
Common patterns:
- Lift (translateY -2px to -4px)
- Scale (1.02 to 1.05)
- Shadow increase
- Background shift
- Border/outline appear
- Icon animation

Timing:
- Duration: 150-300ms
- Easing: ease-out or power2.out
```

### Focus States

```
Accessibility-first:
- Visible outline
- Color contrast
- Motion for enhancement

Implementation:
.element:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

### Loading States

```
Types:
- Skeleton screens
- Spinner (use sparingly)
- Progress bar
- Shimmer effect
- Optimistic UI

Skeleton example:
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-bg-secondary) 25%,
    var(--color-bg-tertiary) 50%,
    var(--color-bg-secondary) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

### Success/Error States

```
Success:
- Green accent
- Checkmark animation
- Brief celebration
- Auto-dismiss

Error:
- Red accent
- Shake animation (subtle)
- Clear messaging
- Recovery path
```

---

## Implementation Reference

### Hover Lift

```css
.card {
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.1);
}
```

### Button Loading

```javascript
async function handleSubmit(btn) {
  btn.classList.add("loading");
  btn.disabled = true;

  try {
    await submitForm();
    btn.classList.remove("loading");
    btn.classList.add("success");

    // Reset after delay
    setTimeout(() => {
      btn.classList.remove("success");
      btn.disabled = false;
    }, 2000);
  } catch (error) {
    btn.classList.remove("loading");
    btn.classList.add("error");
    // Handle error
  }
}
```

```css
.btn {
  position: relative;
}

.btn.loading .btn-text {
  opacity: 0;
}

.btn.loading::after {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

### Checkbox Animation

```css
.checkbox-custom {
  width: 20px;
  height: 20px;
  border: 2px solid var(--color-border);
  border-radius: 4px;
  position: relative;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.checkbox-custom::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: 2px solid white;
  border-top: none;
  border-left: none;
  transform: rotate(45deg) scale(0);
  transition: transform 0.2s ease;
}

input:checked + .checkbox-custom {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

input:checked + .checkbox-custom::after {
  transform: rotate(45deg) scale(1);
}
```

### Toast Notification

```javascript
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Animate in
  gsap.fromTo(
    toast,
    { opacity: 0, y: 20 },
    { opacity: 1, y: 0, duration: 0.3 },
  );

  // Auto dismiss
  setTimeout(() => {
    gsap.to(toast, {
      opacity: 0,
      y: -20,
      duration: 0.3,
      onComplete: () => toast.remove(),
    });
  }, 3000);
}
```

### Copy to Clipboard

```javascript
async function copyToClipboard(text, button) {
  await navigator.clipboard.writeText(text);

  const originalText = button.textContent;
  button.textContent = "Copied!";
  button.classList.add("copied");

  setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove("copied");
  }, 2000);
}
```

---

## Timing Guidelines

### By Interaction Type

| Interaction     | Duration  | Easing      |
| --------------- | --------- | ----------- |
| Hover           | 150-200ms | ease-out    |
| Click feedback  | 100ms     | ease-out    |
| Page transition | 300-500ms | ease-in-out |
| Loading appear  | 200ms     | ease-out    |
| Toast enter     | 300ms     | ease-out    |
| Toast exit      | 200ms     | ease-in     |

### Rule of Thumb

```
Faster = More responsive (hovers, clicks)
Slower = More dramatic (page changes, reveals)

Never exceed 500ms for UI feedback
```

---

## Questions to Ask

When studying these sites:

1. What triggers the animation?
2. What's the duration and easing?
3. Does it provide clear feedback?
4. Does it work without motion?
5. Is it consistent across the site?
6. Does it feel purposeful or decorative?

---

## Production Micro-Interaction Patterns

Real-world micro-interactions from a modern digital studio site, showing the timing and easing values that create premium feel.

### Rolling Text Nav Hover

Dual-layer text where the bottom label slides up as the top slides away. Pure CSS, no JavaScript. Uses `cubic-bezier(0.22, 1, 0.36, 1)` at 0.35s for a snappy-but-smooth feel.

### Condensing Navbar on Scroll

Nav pill shrinks from 5rem to 3.25rem height with backdrop blur appearing. Transitions use `cubic-bezier(0.22, 1, 0.36, 1)` at 0.8s — intentionally slow for a premium, unhurried feel.

### Grid-Template-Rows Accordion

FAQ accordion using `grid-template-rows: 0fr → 1fr` for smooth height animation without JavaScript height calculation. Plus icon rotates 45° to become an X. Both at 300ms with `cubic-bezier(0.22, 1, 0.36, 1)`.

### Icon Rotation on Hover

Star icon on button rotates 90° on hover. 0.35s with `cubic-bezier(0.4, 0, 0.2, 1)`. Subtle enough to notice, fast enough to feel responsive.

### Form Input Underline Focus

Border-bottom transitions from muted to accent color on focus. 0.3s, simple ease. Clean feedback that the field is active.

### Key Timing Principles

- **0.2-0.35s**: Interactive elements (buttons, links, icons) — fast, responsive
- **0.3s**: State changes (focus, active, selected) — noticeable but not sluggish
- **0.5-0.8s**: Layout transitions (navbar, accordion) — deliberate, premium
- **Two easings cover everything**: `cubic-bezier(0.22, 1, 0.36, 1)` for layout, `cubic-bezier(0.4, 0, 0.2, 1)` for interaction

→ See **elite-css-animations/visual-effects.md** for complete CSS implementations.
