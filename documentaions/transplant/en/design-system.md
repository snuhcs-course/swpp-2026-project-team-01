# Design system (AI-facing)

Source: `apps/web/src/app/globals.css`, `apps/web/src/components/ui/*`, introduced in commit `a51ee0a` ("whole-app redesign with design tokens, shared primitives and Pretendard") of the predecessor repo and carried into `team-01`.

## 1. Direction
`globals.css` header: **"시간표 노트 (timetable ledger)" — a calm, cool-paper working surface with one deep teal "calendar ink" accent. Times are always tabular figures; time ranges are drawn on a 24h track.**

## 2. Tokens (`:root`, dark values under `prefers-color-scheme: dark`)
| Token | Light | Dark | Use |
|---|---|---|---|
| canvas | #f3f5f7 | #0f1419 | page background |
| surface / surface-sunken / surface-raised | #fff / #eef1f4 / #fff | #161d24 / #11171d / #1c242d | cards / wells / popovers |
| ink / ink-soft / muted / subtle | #131a22 / #33404d / #5b6876 / #687482 | #e7edf2 / #c5cfd8 / #9aa7b4 / #7f8c99 | text hierarchy |
| border / border-strong | #dbe1e7 / #808d9b | #2a3540 / #64727f | |
| primary (+hover, ink, soft, soft-ink) | #0b6670 (#08525a, #fff, #e3f1f2, #0a4c53) | #4fb8c1 (#74cad1, #04252a, #143036, #9adbe0) | the single accent |
| success / warn / danger (+soft, ink) | #1f7a45 / #9a5800 / #b4232f | #5cc48a / #e2a64a / #f07a83 | status |
| track-work | #c9d2db | #34414e | work-hours bar in week chart |
| focus | = primary | #74cad1 | 2 px focus outline |

Exposed to Tailwind via `@theme inline` as `bg-surface`, `text-ink`, `border-border`, `bg-primary-soft` …

## 3. Type, radius, shadow
- Font: Pretendard Variable, self-hosted from `node_modules/pretendard` (dynamic subset; no CDN). `word-break: keep-all` for Korean; headings `letter-spacing -0.015em`, `text-wrap: balance`.
- Scale (rem): caption .8125 · small .875 · body .9375 · lead 1.0625 · h3 1.125 · h2 1.25 · h1 1.625 · display 2 (with paired line-heights).
- Radius: control 8 px, card 12 px, sheet 16 px.
- Shadows: `card` (hairline), `raised` (popover/sticky bar), `bar`.
- `.tabular` utility = tabular-nums; used for every time, date and count.
- `prefers-reduced-motion` disables transitions.

## 4. Primitives (`components/ui`, barrel `index.ts`)
| Component | Notes |
|---|---|
| `Button`, `buttonClass(variant,size)` | variants primary / secondary / ghost / danger / link; sizes sm 36 px, md 40 px, lg 48 px min-height; links styled with `buttonClass` |
| `Badge` `Tone` | neutral / primary / success / warn / danger soft pills |
| `Alert`, `StatusPill` | boxed message with tone icon; `role` must be passed explicitly (alert/status); StatusPill shows saved/unsaved/busy |
| `Card`, `SectionHeader`, `cardClass` | |
| `PageHeader` | eyebrow + title + description + actions |
| `EmptyState` | icon, title, description, actions; `compact` |
| `Field`, `Input`, `Textarea`, `Select`, `labelClass` | label + hint + error wiring |
| `Checkbox`, `ToggleChip` | ToggleChip = pressed button used for weekday chips |
| `Stepper` | numbered linear steps, done = filled check |
| `ChatBubble`, `ChatPending` | assistant left with black "AI" disc on quiet surface; user right in primary; pending = dashed bubble with spinner |
| icons | inline SVG set (Check, Alert, Info, Chevron*, Plus, X, Trash, Calendar, Clock, Menu, Search, Users, Send) + `Spinner` |

## 5. Signature patterns
- **Week chart** (`WeekSchedule`): Mon-first rows; 24 h track with 6/12/18 h ticks; work bar thin top (track-work), meeting-window bar thicker bottom (primary); text list under each bar.
- **Weekly window editor**: one row = time range + weekday chips + "평일에 적용" + delete.
- **Chips with source**: inherited = neutral outline; this-search = primary tint; text "· 기본 선호 / · 이번 예약"; × to disable.
- **Candidate line**: `M월 D일(요일) HH:MM · 장소 · 양식`, clock icon, pressed = primary-soft + check.
- **Sticky action bar** on long editors (save status + progress + primary action).
- **Right-side detail sheet** (`<dialog>`, max-w-md, focus returns to trigger).
- **Inline delete confirm** ("삭제할까요? [삭제] [취소]") instead of modal dialogs (only invite-link renewal uses `confirm()`).
- Calendar entry colour = source: imported (primary-soft), confirmed meeting (success-soft), app/busy (sunken grey); left 3 px rule.

## 6. Accessibility rules applied
Skip link "본문으로 건너뛰기"; `aria-current` on nav and today; `role="log"` chat regions; `aria-pressed` on chips/candidates; labelled inputs everywhere; errors with `role="alert"`; dialogs keyboard closable; min target 40 px (36 px for sm); status never conveyed by colour alone (badges carry text).

## 7. Copy rules (observed across UI strings)
- Polite 해요체, short sentences, Korean UI only (`<html lang="ko">`).
- Say what was kept on failure: "기존 일정은 그대로 유지했어요", "미저장 입력을 보존하고 있어요".
- Name the scope of an action: "이 앱에만 적용돼요", "Google 일정은 바뀌지 않아요", "확정하기 전까지는 현재 적용 중인 프로필이 바뀌지 않아요".
- Estimates are labelled: "짐작", "경향", "추정".
- Never claim automation that does not happen: "자동으로 취소되지 않아요", "직접 확인해야 확정돼요".

## Transplant unit
Copy `globals.css` tokens + `components/ui` as a block if the target uses Tailwind v4. If the target uses shadcn/ui, map tokens to its CSS variables (`--primary` etc.) and keep only the signature patterns in §5.
