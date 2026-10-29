---
title: Find Me a Time — Thyme Visual Design
date: 2026-10-19
status: Visual direction; Phase 1 theme implemented
colors:
  canvas: "#FAF8F2"
  surface: "#FFFDF8"
  ink: "#30362B"
  muted-ink: "#636755"
  primary: "#4E593C"
  primary-hover: "#414B32"
  primary-pressed: "#354029"
  on-primary: "#FFFDF8"
  soft-surface: "#EEEDE3"
  botanical: "#858665"
  hairline: "#D8D8C9"
  input-border: "#858665"
  focus: "#4E593C"
  destructive: "#9B3F35"
  warning: "#77591F"
  success: "#3F6142"
typography:
  display: "Merriweather, Georgia, serif"
  body: "Geist, system-ui, sans-serif"
  mono: "Geist Mono, ui-monospace, monospace"
rounded:
  small: 4px
  control: 8px
  card: 12px
  overlay: 16px
  pill: 9999px
spacing: [4, 8, 12, 16, 24, 32, 48, 64, 96]
material:
  background: warm matte paper
  grain-opacity: 0.025
  grain-opacity-max: 0.04
  surface: smooth uncoated paper
---

# Find Me a Time — Visual Design

## Scope and ownership

This document defines the visual direction developed from the Thyme logo exploration and the [botanical reference board](https://kr.pinterest.com/callmejustdodo/thyme/). It guides future brand and web styling. The exact tokens below are implementation choices derived from that mood, rather than colors sampled from the references.

**Find Me a Time** is the product; **Thyme** is its scheduling assistant. The [design principles](documentations/03_design_principles.md) own interaction direction. The [one-pager](documentations/01_one_pager.md), [PRD](documentations/02_product_requirements.md), and [capability specifications](openspec/specs/) own product scope and behavior. Visual styling must preserve their consent, privacy, and booking rules.

The selected logo and uncropped reference are retained as documentation assets. For component structure, message and composer interactions and responsive polish, study the Vercel chatbot and the eve chat template listed in the [reference repositories](documentations/technical_specification/02_frontend_architecture.md#reference-repositories) and adapt their shapes to this palette. The Phase 1 theme lives in `apps/web/app/globals.css` (tokens mapped onto the shadcn roles as described under [Proposed implementation mapping](#proposed-implementation-mapping)), the root layout's fonts and the shared `components/ui` and `components/chat` recipes. See [Known gaps](#known-gaps).

**Exception: the ink screens.** The public landing (`/` and `/?flow=imessage`) and the iMessage link step in `/app` use the landing redesign's ink palette (`#2C3E63` on `#F6F7F9`), Big Shoulders headings and Geist body, by the user's decision on 2026-10-23 ([`host-imessage-channel` D18](openspec/changes/host-imessage-channel/proposal.md#decisions)). Their styles live in `apps/web/app/_components/ink/ink.css`, scoped under `.ink`, so this document's Thyme theme still holds everywhere else. Whether the whole app moves to ink is a separate team decision.

## Mood

Calm, thoughtful, botanical, and quietly editorial. Pair delicate plant forms with readable product UI, warm paper, and generous space. The experience should feel like a considered note on good stationery: welcoming, tactile, and easy to act on.

Use muted olive, warm ivory, dark natural ink, fine lines, and restrained serif headings. Keep illustration concentrated around brand moments and empty states; active conversations and scheduling reviews need visual clarity.

## Logo

![Thyme botanical clock logo](documentations/assets/thyme-logo.png)

The selected logo asset is [documentations/assets/thyme-logo.png](documentations/assets/thyme-logo.png), a 380 × 380px square crop of the original generated artwork. It retains the original pixels and ivory background without stretching the mark. The [uncropped reference](documentations/assets/thyme-logo-concept.png) remains available for provenance. Future application asset paths and serving behavior require implementation and visual verification.

The mark is a thyme sprig curving along the left and bottom of an open clock circle. The hands read **10:10**, with a shorter hour hand pointing upper left and a longer minute hand pointing upper right. Preserve the slender organic stems, small leaves, open arc, and understated central hub.

- The symbol contains no text. Product names can appear as separate interface text.
- Use olive on ivory. A single-color dark-ink version is suitable when contrast or printing requires it.
- Allow clear space of at least one fifth of the visible mark's width on every side. Add that space in the layout; the saved logo asset is tightly cropped.
- Keep the full botanical mark at least 48px wide in UI. At 16–32px, use a deliberately simplified version with fewer leaves and stronger strokes; prepare and verify that asset before use.
- Do not stretch, rotate, add shadows, enclose the mark in a decorative badge, or animate the hands as a loading indicator.
- When the logo is the only content of a home link, give the link an accessible product-name label. When nearby text already identifies it, treat the image as decorative.

The selected PNG has an opaque ivory background and raster detail; it is not a transparent or vector asset. Preserve its aspect ratio when displaying it. Do not copy logos from the moodboard.

## Colors

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Warm paper | `canvas` | `#FAF8F2` | Main page background beneath subtle grain |
| Smooth paper | `surface` | `#FFFDF8` | Inputs, composer, dialogs, cards |
| Natural ink | `ink` | `#30362B` | Body text, headings, important details |
| Secondary ink | `muted-ink` | `#636755` | Supporting copy and metadata |
| Action olive | `primary` | `#4E593C` | Primary buttons, links, selected controls |
| Hover olive | `primary-hover` | `#414B32` | Primary hover state |
| Pressed olive | `primary-pressed` | `#354029` | Primary pressed state |
| Light action ink | `on-primary` | `#FFFDF8` | Text and icons on primary buttons |
| Soft wash | `soft-surface` | `#EEEDE3` | Secondary actions and subtle grouping |
| Botanical olive | `botanical` | `#858665` | Logo, illustration, and control boundaries |
| Decorative line | `hairline` | `#D8D8C9` | Dividers and nonessential card edges |
| Field boundary | `input-border` | `#858665` | Input and unselected control outlines |
| Focus | `focus` | `#4E593C` | Keyboard focus outlines |
| Error | `destructive` | `#9B3F35` | Error copy and destructive actions |
| Attention | `warning` | `#77591F` | Warnings and unresolved conditions |
| Success | `success` | `#3F6142` | Confirmed successful outcomes |

Use semantic theme roles throughout the app. Keep botanical olive for illustration and borders; its 3.53:1 contrast on the canvas is insufficient for ordinary small text. Decorative hairlines have only 1.36:1 contrast and cannot be the sole boundary of an interactive control.

For the flat token pairs, ink/canvas is 11.71:1, muted-ink/canvas is 5.49:1, and on-primary/primary is 7.33:1. Error, warning, and success text each exceed 6:1 on the canvas. Verify actual combinations again after adding texture, state fills, or transparency.

## Paper material and texture

The main background should resemble **warm matte uncoated paper** with fine, irregular grain. Start with the canvas token, then add a neutral texture layer at 2.5% opacity, capped at 4%. Texture should become apparent on closer inspection without competing with reading.

- Use one small, seamless, locally served texture tile. Keep its scale consistent across screen widths so it resembles fine fibers rather than large mottled patches.
- Keep text, inputs, buttons, chat messages, proposal details, calendars, and overlays on clean surfaces. Show grain mainly in the page's surrounding space and generous brand areas.
- Do not apply transparency to the page container or its content. Place grain in a separate decorative background layer, with `pointer-events: none`, behind all interactive content.
- Use texture only to suggest material. Avoid stains, creases, torn edges, ruled lines, heavy noise, parchment yellow, or fake folded-paper controls.
- Keep texture static. No animated grain, parallax, or scrolling material effects.
- Keep a solid-color fallback while the texture loads. In forced-colors mode, omit the texture and honor system colors; omit it for printing as well.
- Check the tile for visible seams at mobile and desktop widths and at 200% zoom. Recheck text and focus contrast on the darkest textured area.

The logo reference's ivory backdrop conveys the palette. A future original paper tile should use a fixed fine-grain scale and 2.5% opacity; do not tile the logo image or use it as the page background.

## Typography

Use **Merriweather** for editorial display headings, **Geist** for body and interface text, and **Geist Mono** for technical identifiers where needed. Preserve system fallbacks. The app should load these fonts with system fallbacks and use Geist for body text.

| Role | Size | Weight | Line height | Usage |
| --- | --- | --- | --- | --- |
| Display | `clamp(40px, 6vw, 72px)` | 400 | 1.12 | Landing-page headline |
| Page heading | `clamp(28px, 4vw, 40px)` | 400 | 1.2 | Access and overview pages |
| Section heading | 22–28px | 400 | 1.3 | Editorial section introductions |
| Component title | 16–18px | 600 | 1.4 | Sans-serif card and dialog titles |
| Body and conversation | 16px | 400 | 1.65 | Paragraphs and messages |
| Controls | 14–16px | 500 | 1.4 | Buttons, navigation, labels |
| Supporting text | 14px | 400 | 1.5 | Descriptions and metadata |
| Compact metadata | 12px | 500 | 1.5 | Brief timestamps and ancillary labels |

Keep display tracking between -0.02em and 0; use normal tracking for body text. Avoid script fonts, heavily tracked paragraphs, and decorative serif text in dense controls. Inputs and textareas use at least 16px text. Display dates with an explicit timezone when relevant, and use tabular numerals for aligned times.

## Layout and spacing

Use a 4px spacing foundation with the frontmatter scale. Default gaps are 8–12px within controls, 16–24px within sections, and 32–64px between sections. Marketing sections can use 64–96px when the content warrants it.

Center marketing content within approximately 1120px. Keep conversational reading columns around 680–720px, compact forms around 420–480px, and prose around 60–70 characters per line. Use 16–24px mobile gutters and 32–64px desktop gutters. Let layout respond to content instead of reserving space for ornamental imagery.

The host conversation should keep the current exchange and composer easy to reach. Give scheduling proposals a clear order: meeting context, proposed date and timezone, duration, location, current state, and permitted next actions. Styling does not change which details or actions each actor may access.

## Shapes, lines, and elevation

Use 4px radii for small elements, 8px for buttons and inputs, 12px for cards and composer surfaces, and 16px for dialogs. Reserve fully rounded shapes for avatars and short status badges.

Default to flat surfaces and 1px lines. Paper texture supplies the material character; ordinary cards do not need shadows. For floating menus and dialogs, use a restrained shadow such as `0 8px 24px rgb(48 54 43 / 0.08)`. Do not add glossy highlights, glass effects, or simulated stacks of paper.

## Component recipes

| Component | Treatment |
| --- | --- |
| Primary action | Dark olive fill, ivory label, 44px minimum target height, darker hover and press |
| Secondary action | Soft wash or smooth-paper fill, dark ink, visible boundary when needed |
| Text link | Action olive with underline or another persistent non-color cue |
| Input | Smooth surface, olive field boundary, persistent label, 16px text, inline validation |
| Composer | Smooth surface, 12px radius, restrained border, clear send and pending states |
| Assistant message | Open reading layout, dark text, Thyme speaker label; no decorative paper effects |
| User message | Subtle surface distinction and actor label; keep long content readable |
| Proposal card | Compact heading and structured details, prominent current action, visible status text |
| Conversation card | One open at a time, after the latest message; once answered it collapses into a one-line receipt (value, source badge, **Edit**) that stays in the history; one question as a 16px heading, the proposed value with its source badge, one short reason, then actions; 16px horizontal and 12px vertical padding; fits a phone viewport above the composer, with long editors scrolling inside the card ([one thing at a time](documentations/03_design_principles.md#4-one-thing-to-think-about-at-once)) |
| Status badge | Short explicit state label, restrained tint, optional icon; never color alone |
| Empty state | One clear explanation and next action; optional small botanical illustration |
| Dialog | Smooth paper surface, accessible title, clear action order, preserved focus behavior |

Use the selected shadcn and conversation-component direction after fresh dependency setup. Prefer their variants; update shared recipes rather than scattering color and typography overrides at call sites. Keep information density appropriate to each task: an airy landing page should not make calendar review cumbersome.

## Voice and motion

Use direct, warm copy: “Let’s find a time,” “Review this suggestion,” or “Your calendar is connected.” Show Thyme as the assistant identity and Find Me a Time as the product identity. Describe pending, proposed, approved, and booked states accurately; only report success once the service confirms it.

Use brief 120–180ms color and opacity transitions. Preserve a stable reading position while messages stream. Respect reduced-motion preferences, and keep decorative botanical elements and the clock hands still.

## Responsive and accessible behavior

- Use at least 44px touch targets for primary controls and icon actions. Give icon-only buttons accessible names.
- Keep a visible 2px solid focus outline with a 3px offset. Ensure it remains clear against paper, clean surfaces, and adjacent controls.
- Target 4.5:1 contrast for normal text and 3:1 for large text and essential control boundaries. Verify rendered states, including textured areas.
- Allow text to wrap, labels to expand, and long names and links to break. Avoid horizontal page scrolling at 320px and at 200% zoom.
- Stack proposal details and actions on small screens; keep timezone labels visible. Account for the mobile keyboard and safe-area inset around the composer.
- Pair status color with text, preserve semantic headings and field labels, and announce relevant pending and error states without interrupting reading.

## Do's and don'ts

**Do:** use subtle paper grain, botanical linework, warm neutrals, darker olive actions, spacious reading columns, and explicit scheduling state.

**Don't:** put texture behind detailed task content, use pale botanical color for small text, spread leaves across every control, use a monochrome palette to hide errors, or substitute visual calm for clear confirmation.

## Proposed implementation mapping

Use the shared stylesheet, root layout and component recipes as implementation owners once the foundation change creates them. Preserve the selected Next.js, Tailwind/shadcn and accessible conversation UI direction, with dependency versions/preset chosen in the foundation slice.

Map canvas/ink to background/foreground, surface to card/popover, action olive/ivory to primary roles, soft wash to secondary/muted/accent, decorative line to border, field boundary to input and focus to ring. Keep additional hover/pressed/warning/success roles explicit. Apply the radius scale deliberately, load fonts before switching family, and keep the decorative paper layer separate from clean controls/content.

## Iteration guide

When applying the design, start with the canvas, paper layer, text contrast, and typography. Then update shared controls, conversation surfaces, and proposal cards. Finish with brand assets and responsive polish.

Review a landing page, a conversation with long messages, a proposal awaiting host approval, validation errors, and a keyboard-focused dialog. Check 375px and 1280px widths, 200% zoom, reduced motion, and forced colors. Run the app checks relevant to changed code; documentation validation alone cannot verify a rendered theme.

## Known gaps

- The light theme, fonts, paper layer, focus outline and reduced-motion handling are implemented. `apps/web/app/theme.test.ts` checks the documented contrast pairs, including text on the darkest textured area, and `tests/e2e/theme.test.ts` checks the rendered paper layer, its omission in print and forced colors, fonts, focus outlines and reduced motion. Proposal cards, dialogs and status badges get their recipes when they are built.
- The cropped PNG and uncropped original are retained under documentation assets. A vector master, simplified small-size mark and export variants still need preparation and verification.
- The paper tile is [documentations/assets/paper-grain.svg](documentations/assets/paper-grain.svg), served as `apps/web/public/paper-grain.svg`: a 128px stitched fractal-noise tile at 2.5% opacity, disabled in print and forced colors. A visual seam check at 200% zoom on hardware displays is still open.
- A botanical dark theme requires separate contrast/visual review; do not invert the texture automatically.
- Moodboard references inform visual direction only. Use original artwork and typography; they do not grant rights to reuse source brand assets.
