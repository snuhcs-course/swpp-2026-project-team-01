---
title: Find Me a Time — Visual Design
date: 2026-10-29
status: Ink direction for the whole app; the landing and the iMessage link step implement it, the rest of the app still runs the Thyme theme
colors:
  canvas: "#F6F7F9"
  surface: "#FFFFFF"
  ink: "#1E2430"
  muted-ink: "#586172"
  primary: "#2C3E63"
  primary-hover: "#243453"
  primary-pressed: "#1C2A44"
  on-primary: "#FFFFFF"
  soft-surface: "#E7EAF0"
  botanical: "#7B8BA8"
  hairline: "#D4D9E2"
  input-border: "#7B8BA8"
  focus: "#2C3E63"
  logo: "#4A5E85"
  destructive: "#9B3F35"
  warning: "#77591F"
  success: "#3F6142"
typography:
  wordmark: "Big Shoulders 800, opsz 72"
  display: "Big Shoulders 800, opsz 72, system-ui, sans-serif"
  body: "Geist, system-ui, sans-serif"
  mono: "Geist Mono, ui-monospace, monospace"
rounded:
  small: 6px
  google-button: 8px
  control: 10px
  card: 12px
  composer: 14px
  window: 16px
  pill: 9999px
spacing: [4, 8, 12, 16, 24, 32, 48, 64, 96]
material:
  background: cool matte paper
  grain-opacity: 0.03
  grain-opacity-max: 0.04
  surface: clean white
---

# Find Me a Time — Visual Design

## Scope and ownership

This document defines the visual direction taken from the approved landing prototype (the "랜딩 볼드 시안" artifact), the landing redesign on `feat/web-language-switch` and the "iMessage 연결 화면 시안" canvas. It replaces the botanical olive (Thyme) direction of 2026-10-13 for the whole app. The 2026-10-12 kickoff gave the design system and UX flow to 은우, who chose on 2026-10-29 to make ink the direction for every screen.

**Find Me a Time** is the product; **Thyme** is its scheduling assistant. The [design principles](documentations/03_design_principles.md) own interaction direction. The [one-pager](documentations/01_one_pager.md), [PRD](documentations/02_product_requirements.md), and [capability specifications](openspec/specs/) own product scope and behavior. Visual styling must preserve their consent, privacy, and booking rules.

For component structure, message and composer interactions and responsive polish, study the Vercel chatbot and the eve chat template listed in the [reference repositories](documentations/technical_specification/02_frontend_architecture.md#reference-repositories) and adapt their shapes to this palette.

**Where it is implemented.** The public landing (`/` and `/?flow=imessage`) and the iMessage link step in `/app` use these tokens in `apps/web/app/_components/ink/ink.css`, scoped under `.ink` ([`host-imessage-channel` D18](openspec/changes/host-imessage-channel/proposal.md#decisions)). The rest of the app (`/app`'s conversation, host pages, booking, privacy) still uses the earlier Thyme tokens in `apps/web/app/globals.css` until it is migrated. See [Known gaps](#known-gaps).

## Mood

Calm, precise, and quietly bold. Pair a condensed heavy wordmark and headlines with plain, readable product UI, cool off-white paper, and generous space. The experience should feel like a clear message from a capable assistant: direct, trustworthy, and easy to act on.

Use deep ink blue, cool grey-blue neutrals, fine lines, and bold condensed headings. Keep the conversation itself the main visual; scheduling reviews need clarity more than decoration.

## Logo

The current mark is served as an alpha mask (`apps/web/public/logo-mask.png`) and tinted with the `logo` color, so it follows the palette without a separate colored file. The ink header shows it at 20px on wide screens, 17px up to 960px and 10px on phones, next to the wordmark.

A new logo is in progress (2026-10-14 meeting): a calligraphic mark, an SVG favicon, and a chat profile picture that takes character references such as moonie. Until it lands:

- Keep the mark and the wordmark as separate elements. The wordmark is live text in the wordmark face.
- Use `logo` on light surfaces. A single-color `ink` version is suitable when contrast or printing requires it.
- Do not stretch, rotate, add shadows, enclose the mark in a decorative badge, or animate it as a loading indicator.
- When the logo is the only content of a home link, give the link an accessible product-name label. When nearby text already identifies it, treat the image as decorative.

## Colors

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Paper | `canvas` | `#F6F7F9` | Main page background beneath subtle grain |
| Clean surface | `surface` | `#FFFFFF` | Inputs, composer, chat window, cards, menus |
| Ink | `ink` | `#1E2430` | Body text, headings, important details |
| Secondary ink | `muted-ink` | `#586172` | Supporting copy, metadata, captions |
| Action ink blue | `primary` | `#2C3E63` | Primary buttons, links, own messages, selected controls |
| Hover | `primary-hover` | `#243453` | Primary hover state |
| Pressed | `primary-pressed` | `#1C2A44` | Primary pressed state |
| Light action text | `on-primary` | `#FFFFFF` | Text and icons on primary fills |
| Soft wash | `soft-surface` | `#E7EAF0` | Assistant messages, code blocks, secondary fills |
| Slate line | `botanical` | `#7B8BA8` | Field and composer boundaries, quote rules |
| Decorative line | `hairline` | `#D4D9E2` | Dividers and nonessential card edges |
| Field boundary | `input-border` | `#7B8BA8` | Input and unselected control outlines |
| Focus | `focus` | `#2C3E63` | Keyboard focus outlines |
| Logo | `logo` | `#4A5E85` | Logo mark and wordmark |
| Error | `destructive` | `#9B3F35` | Error copy and destructive actions |
| Attention | `warning` | `#77591F` | Warnings and unresolved conditions |
| Success | `success` | `#3F6142` | Confirmed successful outcomes |

The token name `botanical` is kept from the earlier palette so code and this document keep matching; its value is now a muted slate. `warning` and `success` carry over unchanged because no ink screen uses them yet; check them against the ink palette when status badges are built.

Use semantic roles throughout the app. Slate line has 3.21:1 contrast on the canvas, enough for essential control boundaries but not for ordinary small text. Decorative hairlines have 1.32:1 and cannot be the sole boundary of an interactive control.

For the flat token pairs, ink/canvas is 14.51:1, muted-ink/canvas is 5.82:1, muted-ink/soft-surface is 5.17:1, on-primary/primary is 10.63:1 and logo/canvas is 6.06:1. Error, warning and success text each exceed 6:1 on the canvas. Verify actual combinations again after adding texture, state fills or transparency.

**Exceptions:** the Google sign-in button follows Google's dark button specification (fill `#131314`, stroke `#8E918F`, label `#E3E3E3`, colored G) instead of the palette. The iMessage screens show Messages' own colors where they depict Messages: the green glyph and the blue bubble of the message preview.

## Paper material and texture

The page background is a **cool matte paper** with fine grain. `ink.css` draws it as a 180px inline SVG noise tile (`feTurbulence`, fractal noise) on a separate `::before` layer at 3% opacity, capped at 4%, with `pointer-events: none`.

- Keep text, inputs, buttons, chat messages, proposal details, calendars and overlays on clean surfaces. Grain shows only in the surrounding canvas.
- Do not apply transparency to the page container or its content.
- Use texture only to suggest material. Avoid stains, creases, ruled lines, heavy noise or fake folded-paper controls.
- Keep texture static. No animated grain, parallax or scrolling material effects.
- In forced-colors mode and for printing, omit the texture. `ink.css` does not do this yet.

## Typography

Use **Big Shoulders** (weight 800, `opsz` 72) for the wordmark and display headings, **Geist** for body and interface text, and **Geist Mono** for prompts, links and technical labels. Preserve system fallbacks.

Big Shoulders is condensed, so headings are multiplied by a heading scale of **1.19**. That makes the widest headline line about as wide as it would be in Geist. Big Shoulders sets Latin only, so Korean headings use a scale of 1.

| Role | Face | Size | Weight | Line height | Usage |
| --- | --- | --- | --- | --- | --- |
| Wordmark | Big Shoulders | `clamp(26px, 3.2cqi, 33px)`; × 0.78 on phones | 800 | 1 | Header brand |
| Display | Big Shoulders | `clamp(32px, 4.6cqi, 56px)` × 1.19; 26px × 1.19 on phones | 800 | 1.04 | Landing headline |
| Page heading | Big Shoulders | `clamp(30px, 4cqi, 42px)` × 1.19 | 800 | 1.08 | Link step and handoff screens |
| Section heading | Big Shoulders | `clamp(21px, 2.4cqi, 27px)` × 1.19 | 800 | 1.2 | Landing sections |
| Component title | Geist | 16–18px | 700 | 1.3–1.4 | Card titles, step titles |
| Lede | Geist | 18px; 16–17px on phones and later screens | 400 | 1.6 | Text under a headline |
| Body and conversation | Geist | 16px; 15px in the landing example | 400 | 1.65; 1.5 in bubbles | Paragraphs and messages |
| Controls | Geist | 14–16px | 500–600 | 1.4 | Buttons, navigation, labels |
| Supporting text | Geist | 13–14px | 400 | 1.5 | Descriptions, help and metadata |
| Compact metadata | Geist | 12px | 500 | 1.5 | Timestamps, captions, fine print |
| Code and links | Geist Mono | 11–15px | 400 | 1.6 | Agent prompt, link message, thread tags |

Keep display tracking between -0.04em and 0; use normal tracking for body text. Avoid script fonts, heavily tracked paragraphs and the display face in dense controls. Inputs use at least 16px text so iOS does not zoom. Display dates with an explicit timezone when relevant, and use tabular numerals for phone numbers, codes, aligned times and step numbers.

## Layout and spacing

Use a 4px spacing foundation with the frontmatter scale. Default gaps are 8–12px within controls, 16–24px within sections, and 28–44px between sections. `ink.css` also uses a few in-between values (10, 14, 22px) for optical fit.

Center content within 1120px. Use a side gutter of `clamp(20px, 5cqi, 56px)`. Keep the chat column at 720px, compact forms and handoff screens at about 460px, the landing example thread at 384px, and ledes at about 46 characters per line.

Layout responds to the width of the page container (container queries), not the window:

- **600px and below:** phone layout. The example chat sits right under the headline as swipe cards, and the Google button is full width.
- **601px and above:** desktop placement, with the pitch on the left and the example thread on the right.
- **960px and below:** the header mark shrinks; the hero insets collapse to zero.

The host conversation should keep the current exchange and composer easy to reach. Give scheduling proposals a clear order: meeting context, proposed date and timezone, duration, location, current state, and permitted next actions. Styling does not change which details or actions each actor may access.

## Shapes, lines, and elevation

Use 6px radii for small buttons and phone swipe cards, 8px for the Google button, menu items and QR and copy rows, 10px for buttons, inputs and code blocks, 12px for cards, bubbles and menus, 14px for the composer, the message preview and the way cards, and 16px for the chat window, the example thread and the popup. Message bubbles cut the corner nearest the speaker to 4px. Reserve fully rounded shapes for avatars, the language button, counters and carousel dots.

Default to flat surfaces and 1px lines. Floating surfaces get a restrained shadow: `0 8px 24px rgb(48 54 43 / 0.08)` for the example thread and the in-page panel, `0 12px 32px rgb(30 36 48 / 0.14)` for menus, and `0 24px 60px rgb(30 36 48 / 0.22)` for the popup. Do not add glossy highlights, glass effects or simulated stacks of paper.

## Component recipes

| Component | Treatment |
| --- | --- |
| Primary action | Ink-blue fill, white 16px/600 label, 48px height, 10px radius, darker hover and press |
| Secondary action | Clean surface, hairline border, ink-blue 15px/600 label, 44px height, 10px radius |
| Google sign-in | Google's dark button spec, 8px radius, 44px height (48px and full width on phones) |
| Text link | Action ink blue with an underline (4px offset); a faint muted variant for low-priority exits such as "Set up here in web chat" |
| Input | Clean surface, slate boundary, 10px radius, 48px height, persistent label, 16px+ text, inline help that turns into the error |
| Composer | Clean surface, slate boundary, 14px radius, 44px ink-blue send button with a disabled state |
| Assistant message | Soft-wash bubble, ink text; the window head shows the avatar and "Thyme" |
| User message | Ink-blue bubble with white text, aligned right |
| Agent prompt | Code block: soft wash, hairline border, 10px radius, 13px mono, copy button, scrolls past eight lines |
| Send panel and popup | The link message in a Messages-style preview, then one way card per route (Open Messages, the QR code, **Copy**); on a computer it opens as a popup, on a phone as a full screen |
| Account and language menus | A button opens a clean-surface menu with 44px items |
| Conversation card | One open at a time, after the latest message; once answered it collapses into a one-line receipt (value, source badge, **Edit**) that stays in the history; one question as a 16px heading, the proposed value with its source badge, one short reason, then actions; 16px horizontal and 12px vertical padding; fits a phone viewport above the composer, with long editors scrolling inside the card ([one thing at a time](documentations/03_design_principles.md#4-one-thing-to-think-about-at-once)) |
| Proposal card | Not yet in ink. Compact heading and structured details, prominent current action, visible status text |
| Status badge | Not yet in ink. Short explicit state label, restrained tint, optional icon; never color alone |
| Dialog | Clean surface, 16px radius, accessible title, clear action order, preserved focus behavior |

Use the selected shadcn and conversation-component direction for the app. Prefer their variants; update shared recipes rather than scattering color and typography overrides at call sites. Keep information density appropriate to each task: an airy landing page should not make calendar review cumbersome.

## Voice and motion

Use direct, warm copy: "Send Thyme one message," "Set up here in web chat," or "Your calendar is connected." Show Thyme as the assistant identity and Find Me a Time as the product identity. Describe pending, proposed, approved and booked states accurately; only report success once the service confirms it.

Use 150ms color transitions on controls. The received code slides in over 320ms, a spinner turns while the page waits for the message, and the status mark draws once. Preserve a stable reading position while messages stream. Respect reduced-motion preferences: `ink.css` turns these off under `prefers-reduced-motion`.

## Responsive and accessible behavior

- Use at least 44px touch targets for primary controls, menu items and icon actions on phones. Give icon-only buttons accessible names.
- Keep a visible 2px solid focus outline with a 3px offset.
- Target 4.5:1 contrast for normal text and 3:1 for large text and essential control boundaries. Verify rendered states, including textured areas.
- Allow text to wrap, labels to expand, and long names and links to break. Avoid horizontal page scrolling at 320px and at 200% zoom.
- Stack proposal details and actions on small screens; keep timezone labels visible. Account for the mobile keyboard and safe-area inset around the composer.
- Pair status color with text, preserve semantic headings and field labels, and announce relevant pending and error states without interrupting reading.

## Do's and don'ts

**Do:** use bold condensed headings, cool neutrals, ink-blue actions, subtle paper grain, spacious reading columns and explicit scheduling state.

**Don't:** put texture behind detailed task content, use slate line color for small text, set dense controls in the display face, use a monochrome palette to hide errors, or substitute visual calm for clear confirmation.

## Proposed implementation mapping

The ink screens implement these tokens as plain CSS variables under `.ink` (`apps/web/app/_components/ink/ink.css`). The app keeps the Next.js, Tailwind/shadcn and accessible conversation UI direction, so migrating the rest of the app means moving these tokens into the shadcn theme variables in `apps/web/app/globals.css`, after which `.ink` can shrink to the screen-specific rules.

Map canvas/ink to background/foreground, surface to card/popover, primary/on-primary to primary/primary-foreground, soft wash to secondary/muted/accent, muted ink to muted-foreground, decorative line to border, field boundary to input and focus to ring. Keep hover/pressed/logo/warning/success roles explicit. Map the radius scale as sm 6px, md 10px, lg 12px and xl 16px. Point the display and heading fonts at Big Shoulders 800 (`opsz` 72) and the sans font at Geist. Keep the decorative paper layer separate from clean controls and content.

## Iteration guide

When applying the design, start with the canvas, paper layer, text contrast and typography. Then update shared controls, conversation surfaces and proposal cards. Finish with brand assets and responsive polish.

Review a landing page, a conversation with long messages, a proposal awaiting host approval, validation errors and a keyboard-focused dialog. Check 375px, 800px and 1280px widths, 200% zoom, reduced motion and forced colors. Run the app checks relevant to changed code; documentation validation alone cannot verify a rendered theme.

## Known gaps

- Only the landing and the iMessage link step use this direction. `/app`'s conversation, host pages, booking and the privacy page still run the Thyme tokens in `apps/web/app/globals.css` (olive on warm ivory, Merriweather headings); `apps/web/app/theme.test.ts` and `tests/e2e/theme.test.ts` check those Thyme values until the migration replaces them.
- The logo mask is shown at 10–20px with no simplified small-size version. The new calligraphic logo, SVG favicon and chat profile picture are in progress.
- The example thread's shadow still uses the earlier olive ink color (`rgb(48 54 43)`); the menu and popup shadows use ink (`rgb(30 36 48)`). Align them when the shadows are tokenized.
- The ink paper texture is not removed in forced-colors mode or for printing yet.
- `warning` and `success` are carried over from the olive palette without being used; recheck them in status badges.
- There is no dark theme. It needs its own contrast and visual review; do not invert the palette or texture automatically.
