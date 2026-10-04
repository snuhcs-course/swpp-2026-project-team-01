import { emptyDb } from './helpers'
import { afterEach, describe, expect, it } from 'vitest'
import { seed, SEED_USERS } from '@/server/db/seed'
import { PERSONA_PROFILES, seedPersonaProfiles } from '@/server/db/persona-profiles'
import { makeContext } from '@/server/runtime'
import { getProfile, profileReadiness } from '@/server/services/profile'
import { computeBookable } from '@/server/services/schedule'
import { kstParts } from '@/core/time'
import { validateProfile } from '@/core/profile'

const NOW = Date.parse('2026-10-05T00:00:00+09:00')   // a Monday
const stores: Awaited<ReturnType<typeof emptyDb>>[] = []
afterEach(() => { stores.splice(0).forEach(s => s.sqlite.close()) })
async function setup() {
  const store = await emptyDb(); stores.push(store); (await seed(store.db, NOW)); (await seedPersonaProfiles(store.db, NOW))
  return { ...store, ctx: makeContext(store.db, { now: () => NOW }, { mode: 'demo',  allowReset: false }) }
}
const ids = Object.values(SEED_USERS).map(u => u.id)
const hosts = [SEED_USERS.minjun.id, SEED_USERS.seoyeon.id], clients = [SEED_USERS.jiho.id, SEED_USERS.hana.id]

describe('demo account profiles', () => {
  it('gives every demo account a valid, confirmed profile', async () => {
    const { ctx } = (await setup())
    for (const id of ids) {
      expect(validateProfile(PERSONA_PROFILES[id].values).valid).toBe(true)
      expect((await getProfile(ctx.db, id))).toMatchObject({ version: 1, origin: 'user' })
      expect((await profileReadiness(ctx.db, id)).ready).toBe(true)
    }
  })
  it('makes the accounts genuinely different, not four copies of one profile', () => {
    const json = ids.map(id => JSON.stringify(PERSONA_PROFILES[id].values))
    expect(new Set(json).size).toBe(ids.length)
    expect(new Set(ids.map(id => JSON.stringify(PERSONA_PROFILES[id].values.meetingWindows))).size).toBe(ids.length)
    expect(new Set(ids.map(id => JSON.stringify(PERSONA_PROFILES[id].values.preferences))).size).toBe(ids.length)
  })
  it('still lets every client book every host, and the candidates differ by pair', async () => {
    const { db } = (await setup())
    const firstSlots: number[] = []
    for (const host of hosts) for (const client of clients) {
      const { slots } = (await computeBookable(db, client, host, NOW))
      expect(slots.length).toBeGreaterThan(0)
      // Every candidate lies inside both people's confirmed meeting windows.
      const windows = (id: string) => PERSONA_PROFILES[id].values.meetingWindows
      for (const s of slots.slice(0, 200)) {
        const p = kstParts(s.startMs), q = kstParts(s.endMs - 1)
        for (const id of [host, client]) expect(windows(id).some(w => w.weekday === p.weekday && p.minuteOfDay >= w.startMin && q.minuteOfDay < w.endMin)).toBe(true)
      }
      firstSlots.push(slots[0].startMs)
    }
    expect(new Set(firstSlots).size).toBeGreaterThan(1)
  })
})
