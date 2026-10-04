# Product Configurator Inspiration

Award-winning product customization and configuration experiences.

---

## Automotive

### Porsche Configurator

**URL**: https://www.porsche.com/configurator
**Award**: UX awards, industry standard

**What to study**:

- 3D model real-time updates
- Color/option switching
- Interior/exterior views
- Summary and sharing

**Technique**: Three.js, real-time rendering, state management

---

### Tesla Design Studio

**URL**: https://www.tesla.com/model3/design
**Award**: Industry benchmark

**What to study**:

- Streamlined option flow
- Price updates
- Image-based vs 3D
- Mobile optimization

**Technique**: Image swapping, React, progressive loading

---

### BMW Configurator

**URL**: https://www.bmw.com/configurator
**Award**: Multiple UX awards

**What to study**:

- 3D rotation controls
- Layer-based customization
- Accessory addition
- Save and share

**Technique**: WebGL, complex state management

---

## Fashion/Apparel

### Nike By You

**URL**: https://www.nike.com/nike-by-you
**Award**: Design innovation

**What to study**:

- 3D shoe customization
- Color picker UX
- Material selection
- Real-time preview

**Technique**: Three.js, custom shaders

---

### Vans Custom

**URL**: https://www.vans.com/custom-shoes
**Award**: E-commerce excellence

**What to study**:

- Part-by-part customization
- Pattern/text addition
- Sharing features
- Add to cart flow

**Technique**: Canvas-based, image composition

---

## Technology

### Apple (iPhone, MacBook)

**URL**: https://www.apple.com/shop/buy-iphone
**Award**: Industry standard

**What to study**:

- Clean option selection
- Size/color comparison
- Price building
- Accessory additions

**Technique**: React, image sets, smooth transitions

---

### Framework Laptop

**URL**: https://frame.work/products/laptop
**Award**: Product innovation

**What to study**:

- Module selection
- DIY vs pre-built paths
- Spec building
- Educational tooltips

**Technique**: React, component-based configuration

---

## Home/Interior

### Sonos

**URL**: https://www.sonos.com
**Award**: Design awards

**What to study**:

- Room visualization
- Multi-product systems
- Audio preview
- Compatibility guidance

**Technique**: SVG-based room layouts, audio integration

---

### Herman Miller

**URL**: https://www.hermanmiller.com/products/seating/office-chairs/aeron-chairs/
**Award**: UX excellence

**What to study**:

- Material selection
- Size guidance
- Color coordination
- Professional vs home use

**Technique**: Image switching, guided configuration

---

## Key Patterns Observed

### Configuration Flow

```
Common patterns:
1. Hero product view
2. Category selection (Color, Size, Options)
3. Detail customization
4. Summary/review
5. Add to cart/save

Progressive disclosure:
- Show popular options first
- Group related options
- Reveal advanced options
```

### Visual Feedback

```
Immediate feedback:
- Color changes instantly
- Price updates in real-time
- 3D model rotates to show change
- Thumbnail updates in summary

Transition types:
- Crossfade (simple)
- FLIP animation (layout changes)
- 3D morph (model updates)
```

### State Management

```
Configuration state:
{
  baseModel: 'model-a',
  color: 'midnight-black',
  size: 'medium',
  options: {
    wheels: 'sport',
    interior: 'leather-tan'
  },
  accessories: ['case', 'charger'],
  price: 1299
}

Update pattern:
- Optimistic UI updates
- Validate on change
- Persist to session/URL
- Share via deep link
```

---

## Implementation Reference

### Option Selector

```javascript
// FLIP-based option change
function selectOption(optionId) {
  const state = Flip.getState(".product-image");

  // Update state
  config.selectedOption = optionId;
  updateProductImage();

  // Animate change
  Flip.from(state, {
    duration: 0.4,
    ease: "power2.inOut",
  });
}
```

### Color Swatch

```html
<div class="color-swatches">
  <button
    class="swatch"
    style="--swatch-color: #1a1a1a"
    data-color="midnight-black"
    aria-label="Midnight Black"
  >
    <span class="swatch-inner"></span>
  </button>
  <!-- More swatches -->
</div>
```

```css
.swatch {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid transparent;
  background: var(--swatch-color);
  cursor: pointer;
  transition:
    border-color 0.2s,
    transform 0.2s;
}

.swatch.selected {
  border-color: var(--color-accent);
  transform: scale(1.1);
}

.swatch:hover {
  transform: scale(1.05);
}
```

### Price Animation

```javascript
// Animate price changes
function updatePrice(newPrice) {
  const priceEl = document.querySelector(".price-value");
  const currentPrice = parseInt(priceEl.textContent);

  gsap.to(
    { value: currentPrice },
    {
      value: newPrice,
      duration: 0.5,
      ease: "power2.out",
      onUpdate: function () {
        priceEl.textContent = Math.round(this.targets()[0].value);
      },
    },
  );
}
```

### Deep Link State

```javascript
// Encode config to URL
function saveToUrl(config) {
  const params = new URLSearchParams();
  params.set("model", config.model);
  params.set("color", config.color);
  params.set("options", JSON.stringify(config.options));

  history.replaceState(null, "", `?${params.toString()}`);
}

// Load from URL
function loadFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    model: params.get("model") || defaultModel,
    color: params.get("color") || defaultColor,
    options: JSON.parse(params.get("options") || "{}"),
  };
}
```

---

## 3D Considerations

### When to Use 3D

```
Use 3D when:
- Product has complex geometry
- Viewing from multiple angles matters
- Real-time material changes needed
- Immersive experience required

Use images when:
- Limited customization options
- Performance is critical
- Mobile-first audience
- Budget constraints
```

### Performance Tips

```
3D configurator optimization:
- LOD (Level of Detail) models
- Compressed textures (basis universal)
- Lazy load non-visible options
- Pre-render common configurations
- Fallback to images on low-end
```

---

## Questions to Ask

When studying these sites:

1. How many configuration steps are there?
2. What's the visual feedback speed?
3. How do they handle many options?
4. What's the mobile experience?
5. How is state persisted/shared?
6. Is it 3D, image-based, or hybrid?
