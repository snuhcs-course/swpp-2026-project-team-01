import { emptyDb } from './helpers'
import { afterEach, describe, expect, it } from "vitest"
import { makeContext } from "@/server/runtime"
import { createDraft, patchDraft, confirmProfile, getProfile, getDraft } from "@/server/services/profile"
const open: Awaited<ReturnType<typeof emptyDb>>[]=[]
const setup=async ()=>{const c=await emptyDb();open.push(c);(await c.sqlite.exec("INSERT INTO users(id,name) VALUES ('u','User'),('v','Other')"));return {...c,ctx:makeContext(c.db,{now:()=>1000})}}
afterEach(()=>{open.splice(0).forEach(c=>c.sqlite.close())})
describe("personal profile lifecycle",()=>{
 it("draft does not change active profile and confirmation replays once",async()=>{
  const {ctx,sqlite}=(await setup())
  const draft=await createDraft(ctx,"u",{purpose:"onboarding"},{key:"new"})
  expect((await getProfile(ctx.db,"u"))).toBeNull()
  const updated=await patchDraft(ctx,"u",{draftId:draft.draftId,expectedRevision:0,patch:{meetingWindows:[{weekday:2,startMin:600,endMin:720},{weekday:2,startMin:840,endMin:1080}]},topicConfirmations:{work:"confirmed",meetingWindows:"confirmed",preferences:"confirmed"}},{key:"edit"})
  expect((await getProfile(ctx.db,"u"))).toBeNull()
  const input={draftId:draft.draftId,expectedRevision:updated.revision,baseProfileVersion:null}
  const saved=await confirmProfile(ctx,"u",input,{key:"confirm"})
  expect(saved.values.meetingWindows).toHaveLength(2)
  expect(await confirmProfile(ctx,"u",input,{key:"confirm"})).toEqual(saved)
  expect((await sqlite.prepare("SELECT count(*) n FROM profile_versions").get())).toEqual({n:1})
  await expect(confirmProfile(ctx,"u",input,{key:"other-confirm"})).rejects.toMatchObject({code:"profile_version_conflict"})
  await expect(async () => await getDraft(ctx.db,"v",draft.draftId)).rejects.toThrow()
 })
 it("preserves direct edit on stale revision and requires topic confirmation",async()=>{
  const {ctx}=(await setup());const draft=await createDraft(ctx,"u",{purpose:"onboarding"},{key:"new"})
  await expect(confirmProfile(ctx,"u",{draftId:draft.draftId,expectedRevision:0,baseProfileVersion:null},{key:"early"})).rejects.toMatchObject({code:"invalid_input"})
  await patchDraft(ctx,"u",{draftId:draft.draftId,expectedRevision:0,patch:{work:{mode:"fixed",windows:[{weekday:1,startMin:540,endMin:1080}]}}},{key:"edit"})
  await expect(patchDraft(ctx,"u",{draftId:draft.draftId,expectedRevision:0,patch:{meetingWindows:[]}},{key:"late"})).rejects.toMatchObject({code:"revision_conflict"})
  expect((await getDraft(ctx.db,"u",draft.draftId)).values.work.windows[0].endMin).toBe(1080)
 })
})

describe('draft view serialization boundary', () => {
  it('returns a plain-object fieldErrors so Server Components can pass it to Client Components', async () => {
    const { createDb } = await import('@/server/db/client')
    const { makeContext } = await import('@/server/runtime')
    const { createDraft } = await import('@/server/services/profile')
    const store = await emptyDb(); (await store.sqlite.exec("INSERT INTO users(id,name) VALUES ('u','U')"))
    try {
      const draft = await createDraft(makeContext(store.db), 'u', { purpose: 'onboarding' }, { key: 'k' })
      expect(Object.getPrototypeOf(draft.fieldErrors)).toBe(Object.prototype)
    } finally { store.sqlite.close() }
  })
})
