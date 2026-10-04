import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const origin = process.env.WEB_TEST_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const mutations = []
let request = { id: 'fixture-request', hostId: 'fixture-host', revision: 1, status: 'negotiating', details: { requesterName: 'Alex', requesterEmail: 'alex@example.com', purpose: 'Discuss a product idea', durationMinutes: 30, timezone: 'Asia/Seoul', mode: 'online', location: '', windows: [] }, candidates: [{ start: '2026-11-05T04:00:00.000Z', end: '2026-11-05T04:30:00.000Z' }], proposal: null, requesterAgreed: false, hostApproved: false, event: null, nextAction: 'Choose a time', messages: [], privateNotes: 'Host secret preference' }
await context.route('https://example.supabase.co/functions/v1/api/**', async route => {
  const req = route.request(); const path = new URL(req.url()).pathname.replace('/functions/v1/api', ''); const headers = req.headers()
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } })
  const respond = (json, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify(json) })
  if (req.method() === 'POST') { assert.match(headers['idempotency-key'], /^[a-f0-9-]{36}$/); mutations.push({ path, headers, body: req.postDataJSON() }) }
  if (path === '/waitlist') return respond({ error: { code: 'UNAVAILABLE', message: 'Please try again later.' } }, 503)
  if (path === '/hosts/dodo') return respond({ id: 'fixture-host', handle: 'dodo', displayName: 'Dodo', timezone: 'Asia/Seoul', ready: true })
  if (path === '/hosts/dodo/requests') { request.details = req.postDataJSON(); return respond({ request, token: 'protected-fixture-token' }) }
  if (path.startsWith('/requests/fixture-request')) {
    assert.equal(headers['x-request-token'], 'protected-fixture-token')
    assert.equal(headers.authorization, undefined, 'Guest must not send host authorization')
    if (req.method() === 'GET') return respond(request)
    const body = req.postDataJSON(); assert.equal(body.expectedRevision, request.revision)
    if (path.endsWith('/proposal')) { request = { ...request, revision: request.revision+1, proposal: { ...request.details, start: body.start, end: body.end, version: 1 }, nextAction: 'Agree to the proposal' } }
    if (path.endsWith('/agree')) { assert.equal(body.proposalVersion,1); request = { ...request, revision: request.revision+1, status: 'awaiting_approval', requesterAgreed: true, nextAction: 'Awaiting host approval' } }
    return respond(request)
  }
  return respond({ error: { code: 'NOT_FOUND', message: 'Fixture route missing' } },404)
})
await page.goto(origin)
await page.getByRole('heading', { name: /Good meetings/ }).waitFor()
await page.getByLabel('Email address').fill('alex@example.com')
await page.getByRole('button', { name: 'Join the waitlist' }).click()
await page.getByText('Please try again later.', { exact: true }).waitFor()
assert.equal(await page.getByText('You’re on the waitlist.', { exact: false }).count(),0)
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false)
await mkdir('test-results', { recursive: true })
await page.screenshot({ path: 'test-results/landing-mobile.png', fullPage: true })
await page.goto(`${origin}/dodo`)
await page.getByRole('heading', { name: 'Meet with Dodo' }).waitFor()
await page.getByLabel('Your name', { exact: true }).fill('Alex')
await page.getByLabel('Email address').fill('alex@example.com')
await page.getByLabel('What would you like to discuss?').fill('Discuss a product idea')
await page.getByLabel('Window 1 starts').fill('2026-11-05T12:00')
await page.getByLabel('Window 1 ends').fill('2026-11-05T17:00')
await page.getByRole('button', { name: 'Start a meeting request' }).click()
await page.waitForURL('**/requests/fixture-request')
await page.getByRole('heading', { name: 'Your meeting request' }).waitFor()
assert.equal(await page.evaluate(() => localStorage.getItem('fmat-request:fixture-request')), 'protected-fixture-token')
await page.getByLabel('Feasible options').selectOption('0')
await page.getByRole('button', { name: 'Create proposal' }).click()
await page.getByRole('checkbox', { name: 'I agree to proposal 1 with these exact details.' }).waitFor()
assert.equal(await page.getByRole('button',{ name: 'Agree and send to host' }).isDisabled(),true)
await page.getByRole('checkbox', { name: 'I agree to proposal 1 with these exact details.' }).check()
await page.getByRole('button',{ name: 'Agree and send to host' }).click()
await page.getByText('Awaiting host approval',{ exact: true }).first().waitFor()
assert.equal(await page.getByText('Booked',{ exact: true }).count(),0)
assert.equal(await page.getByText('Private review notes',{ exact: true }).count(),0)
assert.equal(await page.getByText('Host secret preference',{ exact: true }).count(),0)
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false)
await page.screenshot({ path: 'test-results/request-mobile.png', fullPage: true })
await page.goto(`${origin}/host`)
await page.getByText('Welcome back.', { exact: true }).waitFor()
assert.equal(await page.getByRole('button', { name: 'Approve this proposal' }).count(),0)

const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
const hostJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: 'host-user', role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`
await hostContext.addInitScript(({ hostJwt }) => localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: hostJwt, refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user: { id: 'host-user', email: 'host@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } })), { hostJwt })
await hostContext.route('https://example.supabase.co/functions/v1/api/**', async route => {
  const req = route.request(); const headers = req.headers()
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } })
  assert.equal(headers.authorization, `Bearer ${hostJwt}`)
  assert.equal(headers['x-request-token'], undefined)
  if (req.method() === 'POST') {
    const body = req.postDataJSON(); assert.equal(body.expectedRevision, request.revision); assert.equal(body.proposalVersion, 1); assert.equal(body.confirmed,true); assert.match(headers['idempotency-key'], /^[a-f0-9-]{36}$/)
    request = { ...request, status: 'booking', revision: request.revision+1, hostApproved: true, nextAction: 'Booking pending' }
  }
  return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify(request) })
})
const hostPage = await hostContext.newPage()
hostPage.on('pageerror', error => errors.push(error.message))
await hostPage.goto(`${origin}/host/requests/fixture-request`)
await hostPage.getByRole('heading',{ name: 'Meeting with Alex' }).waitFor()
await hostPage.getByText('Host secret preference',{ exact: true }).waitFor()
assert.equal(await hostPage.getByRole('button',{ name: 'Approve this proposal' }).isDisabled(),true)
await hostPage.getByRole('checkbox',{ name: 'I approve booking proposal 1 with these exact details.' }).check()
await hostPage.getByRole('button',{ name: 'Approve this proposal' }).click()
await hostPage.getByText('Booking is pending.',{ exact: false }).waitFor()
assert.equal(await hostPage.getByText('Your meeting is confirmed.',{ exact: false }).count(),0)
assert.equal(await hostPage.getByRole('button',{ name: 'Approve this proposal' }).count(),0)
assert.equal(await hostPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),false)
await hostPage.screenshot({ path: 'test-results/host-review-mobile.png', fullPage: true })

assert.deepEqual(errors,[])
console.log(JSON.stringify({ passed: ['waitlist errors stay errors','mobile layout fits viewport','account-free intake saves protected credential','guest sends scoped credential only','mutations have idempotency UUID and current revision','exact proposal agreement requires checkbox','agreement remains pending host approval','private host notes absent in guest','host workspace requires authentication','host uses JWT only','host approval binds exact version and needs checkbox','approval stays booking pending until provider confirmation'], mutations: mutations.length, screenshots: ['test-results/landing-mobile.png','test-results/request-mobile.png'] }, null, 2))
await browser.close()
