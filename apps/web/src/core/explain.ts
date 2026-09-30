import type { Chip } from "./chips"
import { matchesDimension } from "./filter"
import { MIN_BUTTON_GAP_MIN } from "./options"
import type { Filter, FilterKey, RankedSlot } from "./types"

const SOFT_WORD = { strong: "강하게 선호", weak: "약하게 선호" } as const
const DIMENSIONS: FilterKey[] = ["dateRange", "weekdays", "timeOfDay", "places", "meetingTypes"]

export function describeOrder(filter: Filter): string {
  if (filter.order === "earliest") return "날짜가 가까운 순, 같은 날은 이른 시각 순"
  if (filter.order === "latest") return "날짜가 가까운 순, 같은 날은 늦은 시각 순"
  return "조건 점수가 높은 순, 같으면 이른 시각 순"
}

export interface ChipChanges {
  added: string[]
  replaced: string[]
  removed: string[]
}

/** What this turn did to the conditions, by chip text (e.g. "월–목 · 반드시"). */
export function diffChips(before: Chip[], after: Chip[]): ChipChanges {
  const b = new Map(before.map((c) => [c.key, c]))
  const a = new Map(after.map((c) => [c.key, c]))
  const changes: ChipChanges = { added: [], replaced: [], removed: [] }
  for (const [key, chip] of a) {
    const old = b.get(key)
    if (!old) changes.added.push(chip.label)
    else if (old.label !== chip.label) changes.replaced.push(chip.label)
  }
  for (const [key, chip] of b) if (!a.has(key)) changes.removed.push(chip.label)
  return changes
}

export interface OptionBasis {
  label: string
  /** Soft preferences this slot satisfies / misses, by condition text. */
  matched: string[]
  missed: string[]
  slackMin: number
}

export interface SelectionBasis {
  /** Conditions every option satisfies (strength "must"). */
  must: string[]
  /** Soft conditions used for scoring, with how strongly they were asked for. */
  preferred: string[]
  order: string
  /** True when near-duplicate candidates were skipped so the picks are distinct times. */
  diversified: boolean
  minGapMin: number
  options: OptionBasis[]
}

/** Facts about why these options were chosen. Computed in code so the wording layer cannot invent reasons. */
export function selectionBasis(input: {
  top: RankedSlot[]
  ranked: RankedSlot[]
  filter: Filter
  chips: Chip[]
  label: (r: RankedSlot) => string
}): SelectionBasis {
  const { top, ranked, filter, chips } = input
  const soft = chips.filter((c) => DIMENSIONS.includes(c.key) && (c.strength === "strong" || c.strength === "weak"))
  const plain = ranked.slice(0, top.length)
  return {
    must: chips.filter((c) => c.strength === "must").map((c) => c.text),
    preferred: chips.filter((c) => c.strength === "strong" || c.strength === "weak").map((c) => `${c.text}(${SOFT_WORD[c.strength as "strong" | "weak"]})`),
    order: describeOrder(filter),
    diversified: top.some((t, i) => t !== plain[i]),
    minGapMin: MIN_BUTTON_GAP_MIN,
    options: top.map((r) => ({
      label: input.label(r),
      matched: soft.filter((c) => matchesDimension(r.slot, filter, c.key)).map((c) => c.text),
      missed: soft.filter((c) => !matchesDimension(r.slot, filter, c.key)).map((c) => c.text),
      slackMin: Math.round(r.slot.slackMin),
    })),
  }
}

/** Deterministic "how these were chosen" sentence; the wording used when the LLM is not available. */
export function basisSentence(basis: SelectionBasis, changes: ChipChanges, shown: number): string {
  const parts: string[] = []
  const changed = [...changes.added, ...changes.replaced].map((l) => `‘${l}’`)
  if (changed.length > 0) parts.push(`${changed.join(", ")} 조건을 반영해서`)
  if (changes.removed.length > 0) parts.push(`${changes.removed.map((l) => `‘${l}’`).join(", ")} 조건은 빼고`)
  if (basis.must.length > 0) parts.push(`${basis.must.map((t) => `‘${t}’`).join(", ")}은(는) 반드시 지키고`)
  if (basis.preferred.length > 0) parts.push(`${basis.preferred.join(", ")} 조건에 맞는 것을 앞에 두고`)
  const distinct = basis.diversified ? `서로 ${basis.minGapMin}분 이상 떨어진 ` : ""
  parts.push(`${basis.order} 기준으로 ${distinct}후보 ${shown}개를 골랐어요.`)
  return parts.join(" ")
}
