import { profileValuesSchema } from "@/contracts/profile"
import type { ProfileValues } from "@/core/profile"
import { validateProfile } from "@/core/profile"
import { type Db, run } from "./client"
import { SEED_USERS } from "./seed"

const hm = (h: number, m = 0) => h * 60 + m
const days = (list: number[], startMin: number, endMin: number) => list.map(weekday => ({ weekday, startMin, endMin }))
const WEEKDAYS = [1, 2, 3, 4, 5]

/**
 * Confirmed profiles for the demo accounts. They deliberately differ — hours, which days, how strongly a preference is held —
 * so booking between two accounts gives visibly different candidates instead of every account behaving the same.
 * Every client still overlaps every host on some weekday afternoon or morning, so the demo scenarios keep working.
 */
export const PERSONA_PROFILES: Record<string, { summary: string; values: ProfileValues }> = {
  [SEED_USERS.minjun.id]: {
    summary: "벤처캐피탈 심사역: 평일 10–18시(점심 제외), 오후·온라인을 가볍게 선호",
    values: {
      work: { mode: "fixed", windows: days(WEEKDAYS, hm(10), hm(18)) },
      meetingWindows: [...days(WEEKDAYS, hm(10), hm(12)), ...days(WEEKDAYS, hm(13), hm(18))],
      preferences: { weekdays: null, startTime: { value: { startMin: hm(13), endMin: hm(18) }, strength: "weak" }, meetingMode: { value: "online", strength: "weak" }, slack: null },
    },
  },
  [SEED_USERS.seoyeon.id]: {
    // Her preset schedule already fills weekday 10–12 and 15–18, so her meeting hours sit in the gaps: lunchtime/early afternoon, plus Tue/Thu evenings.
    summary: "재택 디자이너: 점심·이른 오후(12–15시)에 만나고, 화·목은 저녁도 가능. 대면을 선호",
    values: {
      work: { mode: "fixed", windows: days(WEEKDAYS, hm(9), hm(18)) },
      meetingWindows: [...days(WEEKDAYS, hm(12), hm(15)), ...days([2, 4], hm(18), hm(20))],
      preferences: { weekdays: { value: [2, 4], strength: "weak" }, startTime: { value: { startMin: hm(12), endMin: hm(15) }, strength: "strong" }, meetingMode: { value: "offline", strength: "weak" }, slack: { strength: "weak" } },
    },
  },
  [SEED_USERS.jiho.id]: {
    summary: "저녁형 대학생: 평일 15–21시와 토요일 낮, 온라인을 강하게 선호",
    values: {
      work: { mode: "none", windows: [] },
      meetingWindows: [...days(WEEKDAYS, hm(15), hm(21)), ...days([6], hm(10), hm(15))],
      preferences: { weekdays: null, startTime: { value: { startMin: hm(15), endMin: hm(21) }, strength: "weak" }, meetingMode: { value: "online", strength: "strong" }, slack: { strength: "weak" } },
    },
  },
  [SEED_USERS.hana.id]: {
    summary: "프리랜서: 월·수·금 오후와 화·목 오전만, 요일을 강하게 선호하고 앞뒤 여유를 중시",
    values: {
      work: { mode: "none", windows: [] },
      meetingWindows: [...days([1, 3, 5], hm(14), hm(18)), ...days([2, 4], hm(10), hm(12))],
      preferences: { weekdays: { value: [1, 3, 5], strength: "strong" }, startTime: { value: { startMin: hm(14), endMin: hm(18) }, strength: "weak" }, meetingMode: null, slack: { strength: "strong" } },
    },
  },
}

/** Confirms a distinct profile (version 1) for each demo account. Run after `seed`; demo databases only. */
export async function seedPersonaProfiles(db: Db, nowMs: number): Promise<void> {
  await db.transaction(async tx => {
    for (const [userId, { values }] of Object.entries(PERSONA_PROFILES)) {
      const parsed = profileValuesSchema.parse(values)
      if (!validateProfile(parsed).valid) throw new Error(`Persona profile for ${userId} is not valid`)
      await run(tx, "INSERT INTO profile_versions(user_id, version, values_json, origin, confirmed_at) VALUES (?, 1, ?, 'user', ?)", [userId, JSON.stringify(parsed), nowMs])
      await run(tx, "UPDATE users SET current_profile_version = 1, setup_state = 'complete' WHERE id = ?", [userId])
    }
  })
}
