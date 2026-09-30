"use client"

import type { Chip } from "@/core/chips"
import type { FilterKey } from "@/core/types"

export function FilterChips({ chips, onRemove, disabled }: { chips: Chip[]; onRemove: (key: FilterKey) => void; disabled: boolean }) {
  if (chips.length === 0) return <p className="text-sm text-slate-400">아직 적용된 조건이 없어요. 원하는 시간을 말씀해 보세요.</p>
  return (
    <ul className="flex flex-wrap gap-2" aria-label="적용된 조건">
      {chips.map((c) => (
        <li key={c.key} className="flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-sm text-indigo-900">
          <span>{c.label}</span>
          <button
            type="button"
            disabled={disabled}
            aria-label={`${c.label} 조건 지우기`}
            onClick={() => onRemove(c.key)}
            className="flex h-5 w-5 items-center justify-center rounded-full text-indigo-500 hover:bg-indigo-100 disabled:opacity-40"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
