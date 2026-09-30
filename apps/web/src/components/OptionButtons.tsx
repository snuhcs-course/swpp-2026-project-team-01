"use client"

import type { OptionView } from "@/server/repos/conversations"

export function OptionButtons({ options, onPick }: { options: OptionView[]; onPick: (o: OptionView) => void }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {options.map((o) => (
        <button
          key={`${o.startMs}-${o.placeId}-${o.meetingTypeId}`}
          type="button"
          onClick={() => onPick(o)}
          className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-left text-sm font-medium text-indigo-900 hover:bg-indigo-50"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
