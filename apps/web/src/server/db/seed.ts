import { randomUUID } from "node:crypto"
import { defaultRules } from "@/core/availability"
import { DAY_MS, HORIZON_DAYS, MIN_MS, kstDayStart, kstParts } from "@/core/time"
import type { LocationKind } from "@/core/types"
import type { Db } from "./client"
import { schema } from "./client"

export const SEED_USERS = {
  minjun: { id: "u-minjun", name: "김민준 (호스트)" },
  seoyeon: { id: "u-seoyeon", name: "이서연 (호스트)" },
  jiho: { id: "u-jiho", name: "박지호" },
  hana: { id: "u-hana", name: "최하나" },
} as const

interface Block {
  from: string
  to: string
  title: string
  kind: LocationKind
  placeRef?: string
}

const office = (from: string, to: string, title: string): Block => ({ from, to, title, kind: "office" })
const online = (from: string, to: string, title: string): Block => ({ from, to, title, kind: "online" })
const at = (from: string, to: string, title: string, placeRef: string): Block => ({ from, to, title, kind: "place", placeRef })

// weekday: 0 = Sunday … 6 = Saturday
const PATTERNS: Record<keyof typeof SEED_USERS, (weekday: number) => Block[]> = {
  minjun: (w) => {
    if (w === 1 || w === 3) return [office("10:00", "12:00", "팀 업무"), office("14:00", "17:00", "프로젝트 작업")]
    if (w === 2 || w === 4) return [office("09:30", "12:30", "팀 업무"), at("15:00", "17:30", "외부 미팅", "강남 스터디카페")]
    if (w === 5) return [online("10:00", "11:00", "온라인 회의"), office("13:00", "16:00", "팀 업무")]
    if (w === 6) return [at("10:00", "11:30", "운동", "헬스장")]
    return []
  },
  seoyeon: (w) => {
    if (w >= 1 && w <= 5) {
      const blocks = [office("10:00", "12:00", "팀 업무"), office("15:00", "18:00", "팀 업무")]
      if (w === 3) blocks.push(online("14:00", "15:00", "온라인 스터디"))
      return blocks
    }
    if (w === 6) return [at("13:00", "16:00", "작업", "홍대 작업실")]
    return []
  },
  jiho: (w) => {
    if (w === 2 || w === 4) return [at("10:00", "12:00", "수업", "캠퍼스"), at("13:00", "15:00", "수업", "캠퍼스")]
    if (w === 1 || w === 3 || w === 5) {
      const blocks = [online("10:00", "11:00", "온라인 수업")]
      blocks.push(at("19:00", "20:30", "운동", "헬스장"))
      return blocks
    }
    return []
  },
  hana: (w) => {
    if (w === 1 || w === 3) return [at("10:00", "13:00", "스튜디오 작업", "스튜디오")]
    if (w === 2 || w === 4) return [online("14:00", "15:30", "온라인 회의")]
    return []
  },
}

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number)
  return h * 60 + m
}

const HOSTING = {
  minjun: {
    places: [
      { kind: "office_near", name: "회사 근처 카페 (판교)" },
      { kind: "special", name: "강남 스터디카페" },
      { kind: "online", name: "온라인 (Zoom)" },
    ],
    types: [
      { name: "30분 커피챗", durationMin: 30 },
      { name: "60분 상담", durationMin: 60 },
    ],
  },
  seoyeon: {
    places: [
      { kind: "office_near", name: "회사 근처 카페 (여의도)" },
      { kind: "special", name: "홍대 작업실" },
      { kind: "online", name: "온라인 (Meet)" },
    ],
    types: [
      { name: "30분 미팅", durationMin: 30 },
      { name: "90분 워크숍", durationMin: 90 },
    ],
  },
} as const

/** Inserts demo data dated relative to `nowMs`. Expects empty tables (see `truncateAll`). */
export async function seed(db: Db, nowMs: number): Promise<void> {
  const today = kstDayStart(nowMs)
  await db.transaction(async (tx) => {
    for (const [key, u] of Object.entries(SEED_USERS) as [keyof typeof SEED_USERS, (typeof SEED_USERS)[keyof typeof SEED_USERS]][]) {
      await tx.insert(schema.users).values({ id: u.id, name: u.name })
      for (const r of defaultRules()) {
        await tx.insert(schema.availabilityRules).values({ userId: u.id, weekday: r.weekday, enabled: r.enabled, startMin: r.startMin, endMin: r.endMin })
      }
      for (let d = 0; d < HORIZON_DAYS; d += 1) {
        const dayStart = today + d * DAY_MS
        for (const b of PATTERNS[key](kstParts(dayStart).weekday)) {
          await tx.insert(schema.events).values({
            id: randomUUID(),
            userId: u.id,
            title: b.title,
            startAt: new Date(dayStart + hm(b.from) * MIN_MS).toISOString(),
            endAt: new Date(dayStart + hm(b.to) * MIN_MS).toISOString(),
            locationKind: b.kind,
            placeRef: b.placeRef ?? null,
            source: "seed",
            requestId: null,
          })
        }
      }
    }
    for (const key of ["minjun", "seoyeon"] as const) {
      const hostId = SEED_USERS[key].id
      for (const p of HOSTING[key].places) await tx.insert(schema.places).values({ id: randomUUID(), hostId, kind: p.kind, name: p.name })
      for (const t of HOSTING[key].types) await tx.insert(schema.meetingTypes).values({ id: randomUUID(), hostId, name: t.name, durationMin: t.durationMin })
    }
  })
}
