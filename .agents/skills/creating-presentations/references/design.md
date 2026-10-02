# Visual Design

Layout patterns, typography, and composition for bold, minimal presentations.

## Theme

High contrast, minimal. Dark or light depending on context.

### Dark Theme (tech, conference)

| Element | Value |
|---------|-------|
| Background | #000000 or #09090b |
| Primary text | #FFFFFF |
| Secondary text | #9CA3AF |
| Accents | Section-specific colors |

### Light Theme (corporate, print)

| Element | Value |
|---------|-------|
| Background | #FFFFFF or #fafafa |
| Primary text | #09090b |
| Secondary text | #6B7280 |
| Accents | Section-specific colors (darker variants for contrast) |

### Shared

| Element | Value |
|---------|-------|
| Font | Sans-serif (e.g. Geist Sans), light weights at large sizes |
| Letter spacing | Tight (-0.035em to -0.015em) |

## Typography

Impact comes from **scale, not weight**. Light/regular weights (400-600) at massive sizes.

| Element | Style |
|---------|-------|
| Section label | Small caps, section color, tracked wide. e.g. "THE PROBLEM" |
| Headline | Massive, primary color, weight 400-500, fluid sizing, 1-5 words per line |
| Subtitle | Smaller, secondary/muted color, regular weight, 1-2 lines max |
| Body/Bullets | Medium size, bold lead-ins (600 weight) when used |

### Text Contrast Levels

Use 4 levels of contrast to create depth:

| Level | Purpose | Example |
|-------|---------|---------|
| Primary | Headlines, key content | White / #FFFFFF |
| Secondary | Subtitles, supporting text | Light gray |
| Muted | Labels, metadata | Medium gray |
| Faint | Background elements | Dark gray |

## Section Colors

| Color | Hex | Use |
|-------|-----|-----|
| Teal | #14b8a6 | Opening, recap |
| Red | #f87171 | Problems, tension |
| Purple | #a78bfa | Solutions, tools |
| Amber | #fbbf24 | Data, caveats |
| Green | #34d399 | Best practices |
| Blue | #60a5fa | Technical |
| Pink | #f472b6 | Highlights |

Section colors appear in: section labels, gradient backgrounds, progress bars, and accent elements.

## Layouts

### Full Statement (most common)
```
+-------------------------------------------+
| SECTION LABEL                             |
|                                           |
| Massive Headline                          |
| Here                                      |
|                                           |
| Subtitle text in muted color              |
|                                   [ref] > |
+-------------------------------------------+
```

### Big Statement (maximum impact)
```
+-------------------------------------------+
| SECTION LABEL                             |
|                                           |
|                                           |
|        Even Bigger                        |
|        Statement                          |
|                                           |
|                                           |
+-------------------------------------------+
```

### Split Layout
```
+-------------------------------------------+
| SECTION LABEL                             |
|                                           |
| Headline       |  - Point one             |
| Here           |  - Point two             |
|                |  - Point three           |
| Subtitle       |  - Point four            |
+-------------------------------------------+
```

### Section Divider (with gradient)
```
+--------------------+----------------------+
|                    | ░░░░░░░░░░░░░░░░░░░░ |
| Section            | ░░░ Gradient ░░░░░░░ |
| Title              | ░░░ Background ░░░░░ |
|                    | ░░░░░░░░░░░░░░░░░░░░ |
| Subtitle           | ░░░░░░░░░░░░░░░░░░░░ |
+--------------------+----------------------+
```

### Code Slide
```
+-------------------------------------------+
| SECTION LABEL                             |
| Headline                                  |
| Subtitle                                  |
|                                           |
| +---------------------------------------+ |
| | // syntax-highlighted code block      | |
| | const result = await generate()       | |
| |                                       | |
| +---------------------------------------+ |
+-------------------------------------------+
```

### Data/Metrics
```
+-------------------------------------------+
|     +--------+  +--------+  +--------+    |
|     |  $10M  |  |  ~10%  |  |  NPS   |   |
|     |  ARR   |  | GROWTH |  |   90   |   |
|     +--------+  +--------+  +--------+    |
| SECTION LABEL                             |
| Headline                                  |
| Subtitle                                  |
+-------------------------------------------+
```

### People/Photos Grid
```
+-------------------------------------------+
| Headline                                  |
| Subtitle                                  |
|                                           |
| +-----+ +-----+ +-----+ +-----+          |
| |photo| |photo| |photo| |photo|          |
| |Name | |Name | |Name | |Name |          |
| |TITLE| |TITLE| |TITLE| |TITLE|          |
| +-----+ +-----+ +-----+ +-----+          |
|                                           |
| Photo style: Rounded, B&W or consistent   |
+-------------------------------------------+
```

## Slide Type to Layout Mapping

| Slide Type | Layout |
|------------|--------|
| Title | Full statement, centered |
| Section divider | Split with gradient, section color |
| Statement | Full statement, left-aligned |
| Big statement | Big statement, maximum scale |
| Question | Full statement, centered |
| Goals/Agenda | Split layout, bullets right |
| Data | Metrics boxes top |
| Code | Headline + syntax-highlighted block |
| Quote | Centered, large quotation marks |
| People | Photos grid |
| Recap | Split layout, labeled bullets |
| Resources | Grouped reference links by section |
| Next steps | Timeline or labeled bullets |

## Embedded Content

Slides can embed rich media alongside headlines:

- **Code blocks** - syntax-highlighted, dark surface background
- **Terminal output** - monospace with ANSI color support
- **Tweet cards** - styled quote cards with avatar and attribution
- **Video previews** - thumbnail with play button
- **Article previews** - link cards with title and description

## Visual Elements

- **Section labels**: top-left, uppercase, section color
- **Progress bar**: bottom edge, section color, thin (3px)
- **References**: bottom footer with clickable URLs
- **Gradients**: aurora-style background effects using section color
- **Icons**: simple line icons, white or accent color, used sparingly

## Avoid

- Dense paragraphs of text
- More than 4-5 bullet points
- Clip art or stock imagery
- Heavy font weights for headlines (use scale instead)
- Multiple competing focal points
- Animation for animation's sake
