import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright")
const origin = process.env.WEB_SETUP_TEST_URL ?? "http://127.0.0.1:5181"
let server

if (!process.env.WEB_SETUP_TEST_URL) {
  server = spawn(
    process.execPath,
    [
      join(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5181",
      "--strictPort",
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
        VITE_API_ORIGIN: "https://example.supabase.co/functions/v1/api",
      },
      stdio: "ignore",
    }
  )
  server.unref()
  process.on("exit", () => server?.kill())

  let started = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(origin)).ok) {
        started = true
        break
      }
    } catch {
      // Wait for the isolated Vite fixture.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(started, "Workspace fixture Vite server must start")
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
})
const errors = []
const mutations = []

const rules = {
  timezone: "Asia/Seoul",
  durationMinutes: 30,
  availability: [{ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }],
  focusBlocks: [],
  bufferMinutes: 15,
  travelMode: "TRANSIT",
  homeLocation: "Seoul",
  preferences: "Prefer afternoons",
}
const profile = {
  id: "fixture-host",
  handle: "dodo",
  displayName: "Dodo",
  timezone: "Asia/Seoul",
  ready: false,
  durationMinutes: 30,
}
const states = {
  unadmitted: {
    admitted: false,
    profile: null,
    rules: null,
    calendarConnected: false,
    conflictCalendarIds: [],
    bookingCalendarId: null,
    nextAction: "redeem_invitation",
  },
  admitted: {
    admitted: true,
    profile,
    rules,
    calendarConnected: false,
    conflictCalendarIds: [],
    bookingCalendarId: null,
    nextAction: "connect_calendar",
  },
  ready: {
    admitted: true,
    profile: { ...profile, ready: true },
    rules,
    calendarConnected: true,
    conflictCalendarIds: ["primary", "team"],
    bookingCalendarId: "primary",
    nextAction: "share_link",
  },
}
let setupState = structuredClone(states.unadmitted)

let conversation = {
  id: "fixture-conversation",
  revision: 1,
  turns: [
    {
      id: "welcome",
      sequence: 1,
      role: "assistant",
      channel: "system",
      text: "Let’s set your preferences. What name and timezone should we use?",
      createdAt: "2026-10-05T05:00:00Z",
    },
  ],
  draft: null,
  review: null,
  setup: {
    ...states.admitted,
    profile: null,
    rules: null,
    nextAction: "save_rules",
  },
  channelLink: null,
}
setupState = conversation.setup
let failNext = true,
  staleNext = false
let linkAvailable = false,
  channelLink = null,
  linkChallenge = null
const continuationId = "11111111-1111-4111-8111-111111111111"
const continuationSecret = "fixture-continuation-secret-0123456789"
const challengeId = "22222222-2222-4222-8222-222222222222"
const browserProof = "fixture-browser-proof-0123456789012345"
const requests = []
const message =
  "I’m Dodo in Asia/Seoul. Weekdays 2–5 PM, 30 minutes, 15-minute buffer."
const errorText = "The assistant is temporarily unavailable. Please retry."
const staleText =
  "The settings changed in another channel. Refresh and review the current summary."
function fulfill(route, json, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify(json),
  })
}
async function fixture(viewport) {
  const context = await browser.newContext({ viewport })
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: "host-user", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.fixture`
  await context.addInitScript(
    ({ jwt }) =>
      localStorage.setItem(
        "sb-example-auth-token",
        JSON.stringify({
          access_token: jwt,
          refresh_token: "fixture",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: "host-user",
            email: "host@example.com",
            aud: "authenticated",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        })
      ),
    { jwt }
  )
  await context.route(
    "https://example.supabase.co/functions/v1/api/**",
    async (route) => {
      const req = route.request()
      if (req.method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          },
        })
      assert.equal(req.headers().authorization, `Bearer ${jwt}`)
      const path = new URL(req.url()).pathname.replace("/functions/v1/api", "")
      const body = req.method() === "POST" ? req.postDataJSON() : null
      if (body)
        requests.push({ path, body, key: req.headers()["idempotency-key"] })
      if (path === "/host/setup") return fulfill(route, setupState)
      if (path === "/host/setup/conversation")
        return fulfill(route, conversation)
      if (path === "/host/imessage/link")
        return fulfill(route, {
          available: linkAvailable,
          link: channelLink,
          challenge: linkChallenge,
        })
      if (path === "/host/imessage/link/start") {
        assert.equal(body.continuationId, continuationId)
        assert.equal(body.continuationSecret, continuationSecret)
        linkChallenge = {
          id: challengeId,
          expiresAt: "2030-10-05T05:20:00Z",
          claimed: true,
          senderLabel: "•••2625",
        }
        return fulfill(route, {
          challengeId,
          provider: "imessage",
          expiresAt: linkChallenge.expiresAt,
          challengeText: `LINK ${challengeId} fixture-one-use-code`,
          browserProof,
        })
      }
      if (path === "/host/imessage/link/confirm") {
        assert.equal(body.challengeId, challengeId)
        assert.equal(body.browserProof, browserProof)
        channelLink = {
          id: "fixture-link",
          provider: "imessage",
          linkedAt: "2026-10-05T05:05:00Z",
        }
        linkChallenge = null
        return fulfill(route, { ok: true })
      }
      if (path === "/host/imessage/unlink") {
        assert.equal(body.linkId, "fixture-link")
        channelLink = null
        return fulfill(route, { ok: true })
      }
      if (path === "/host/setup/conversation/messages") {
        if (failNext) {
          failNext = false
          return fulfill(
            route,
            { error: { code: "MODEL_UNAVAILABLE", message: errorText } },
            503
          )
        }
        assert.match(body.clientTurnId, /^[a-f0-9-]{36}$/)
        assert.equal(body.expectedRevision, conversation.revision)
        const settings = { handle: "dodo", displayName: "Dodo", rules }
        conversation = {
          ...conversation,
          revision: conversation.revision + 1,
          turns: [
            ...conversation.turns,
            {
              id: "host-turn",
              sequence: 2,
              role: "host",
              channel: "web",
              text: body.text,
              createdAt: "2026-10-05T05:01:00Z",
            },
            {
              id: "assistant-turn",
              sequence: 3,
              role: "assistant",
              channel: "web",
              text: "Here is your proposed setup. Review it before saving.",
              createdAt: "2026-10-05T05:01:01Z",
            },
          ],
          draft: {
            revision: 1,
            baseRulesVersion: 0,
            settings,
            unresolved: [],
            status: "active",
            createdAt: "2026-10-05T05:01:01Z",
          },
          review: {
            revision: 1,
            draftRevision: 1,
            settings,
            status: "pending",
            createdAt: "2026-10-05T05:01:01Z",
          },
        }
        return fulfill(route, conversation)
      }
      if (path === "/host/setup/conversation/confirm") {
        if (staleNext) {
          staleNext = false
          conversation = {
            ...conversation,
            revision: conversation.revision + 1,
            review: { ...conversation.review, revision: 2, draftRevision: 2 },
            draft: { ...conversation.draft, revision: 2 },
          }
          return fulfill(
            route,
            { error: { code: "REVISION_CONFLICT", message: staleText } },
            409
          )
        }
        assert.equal(body.reviewRevision, conversation.review.revision)
        assert.equal(body.expectedDraftRevision, conversation.draft.revision)
        assert.equal(body.expectedRulesVersion, 0)
        assert.equal(body.expectedRevision, conversation.revision)
        setupState = { ...states.admitted }
        conversation = {
          ...conversation,
          revision: conversation.revision + 1,
          setup: setupState,
          review: { ...conversation.review, status: "confirmed" },
          draft: { ...conversation.draft, status: "confirmed" },
        }
        return fulfill(route, conversation)
      }
      if (path === "/host/google/connect")
        return fulfill(route, { url: `${origin}/host/setup?google=connected` })
      if (path === "/host/calendars")
        return fulfill(route, {
          calendars: [
            {
              id: "primary",
              summary: "Personal calendar",
              accessRole: "owner",
              primary: true,
            },
            { id: "team", summary: "Team calendar", accessRole: "reader" },
          ],
        })
      if (path === "/host/calendar-settings") {
        assert.deepEqual(body.conflictCalendarIds, ["primary", "team"])
        assert.equal(body.bookingCalendarId, "primary")
        setupState = { ...states.ready }
        conversation = {
          ...conversation,
          revision: conversation.revision + 1,
          setup: setupState,
        }
        return fulfill(route, setupState)
      }
      return fulfill(
        route,
        { error: { code: "NOT_FOUND", message: `Missing fixture ${path}` } },
        404
      )
    }
  )
  return context
}
await mkdir("test-results/setup-conversation", { recursive: true })
try {
  const context = await fixture({ width: 1440, height: 1000 }),
    page = await context.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(`${origin}/host/setup`)
  await page.getByText(conversation.turns[0].text).waitFor()
  const input = page.getByRole("textbox", {
    name: "Message about your host setup",
  })
  assert.equal(
    await page.getByRole("button", { name: "Send setup message" }).isDisabled(),
    true
  )
  await page
    .getByRole("button", { name: "I’m in Asia/Seoul", exact: true })
    .click()
  assert.equal(await input.inputValue(), "I’m in Asia/Seoul")
  await input.fill(message)
  await input.press("Shift+Enter")
  assert.equal(requests.length, 0)
  await input.fill(message)
  await input.press("Enter")
  await page.getByText(errorText, { exact: true }).waitFor()
  assert.equal(await input.inputValue(), message)
  await input.press("Enter")
  await page
    .getByRole("heading", { name: "Review your proposed settings" })
    .waitFor()
  assert.equal(await input.inputValue(), "")
  const attempts = requests.filter((r) => r.path.endsWith("/messages"))
  assert.equal(attempts.length, 2)
  assert.equal(attempts[0].key, attempts[1].key)
  assert.equal(attempts[0].body.clientTurnId, attempts[1].body.clientTurnId)
  assert.equal(setupState.rules, null)
  await page.screenshot({
    path: "test-results/setup-conversation/review-desktop.png",
    fullPage: true,
  })
  await page.reload()
  await page
    .getByRole("heading", { name: "Review your proposed settings" })
    .waitFor()
  await page.getByText(message, { exact: true }).waitFor()
  staleNext = true
  await page
    .getByRole("button", { name: "Confirm and save proposed settings" })
    .click()
  await page.getByText(staleText, { exact: true }).waitFor()
  assert.equal(setupState.rules, null)
  await page.getByRole("button", { name: "Refresh setup state" }).click()
  await page.waitForTimeout(200)
  await page
    .getByRole("button", { name: "Confirm and save proposed settings" })
    .click()
  await page
    .getByRole("button", { name: "Connect Google Calendar", exact: true })
    .waitFor()
  assert.equal(setupState.profile.handle, "dodo")
  assert.equal(conversation.review.status, "confirmed")
  await page
    .getByRole("button", { name: "Connect Google Calendar", exact: true })
    .click()
  await page.waitForURL("**?google=connected")
  setupState = {
    ...setupState,
    calendarConnected: true,
    nextAction: "select_calendars",
  }
  conversation = {
    ...conversation,
    revision: conversation.revision + 1,
    setup: setupState,
  }
  await page.reload()
  await page.getByRole("combobox", { name: "Booking destination" }).waitFor()
  await page
    .getByRole("checkbox", { name: "Personal calendar", exact: true })
    .check()
  await page
    .getByRole("checkbox", { name: "Team calendar", exact: true })
    .check()
  await page
    .getByRole("combobox", { name: "Booking destination" })
    .selectOption("primary")
  assert.equal(
    await page
      .getByRole("combobox", { name: "Booking destination" })
      .locator('option[value="team"]')
      .count(),
    0
  )
  await page.getByRole("button", { name: "Save calendar selection" }).click()
  await page
    .getByText("Your booking link is ready to share.", { exact: true })
    .waitFor()
  await page.getByRole("button", { name: "Open your booking link" }).waitFor()
  await page.getByRole("button", { name: "Setup settings" }).click()
  await page.getByText("Not available yet", { exact: true }).waitFor()
  assert.equal(
    await page
      .getByRole("button", { name: "Link iMessage", exact: true })
      .count(),
    0
  )
  await page.getByRole("heading", { name: "Your scheduling rules" }).waitFor()
  await page.getByRole("button", { name: "Close" }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.screenshot({
    path: "test-results/setup-conversation/ready-desktop.png",
    fullPage: true,
  })
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  )
  linkAvailable = true
  await page.goto(
    `${origin}/host/setup#imessage=${continuationId}&proof=${continuationSecret}`
  )
  await page.getByRole("button", { name: "Setup settings" }).click()
  await page
    .getByRole("button", { name: "Link iMessage", exact: true })
    .waitFor()
  assert.equal(
    await page.evaluate(() => location.hash),
    "",
    "Continuation secret must be removed from URL"
  )
  await page.getByRole("button", { name: "Link iMessage", exact: true }).click()
  await page
    .getByText("Confirm linking •••2625 to this host account.", { exact: true })
    .waitFor()
  assert.equal(
    await page.evaluate(
      (id) => sessionStorage.getItem(`fmat-imessage-proof:${id}`),
      challengeId
    ),
    browserProof
  )
  assert.equal(
    conversation.turns.some((turn) => turn.text.includes(continuationSecret)),
    false
  )
  await page.reload()
  await page.getByRole("button", { name: "Setup settings" }).click()
  await page
    .getByRole("button", { name: "Confirm this iMessage account", exact: true })
    .click()
  await page.getByText("Linked", { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      (id) => sessionStorage.getItem(`fmat-imessage-proof:${id}`),
      challengeId
    ),
    null
  )
  await page
    .getByRole("button", { name: "Unlink iMessage", exact: true })
    .click()
  await page
    .getByText("iMessage was unlinked. Continue setup here.", { exact: true })
    .waitFor()
  linkAvailable = false
  await context.close()
  for (const width of [390, 320]) {
    const context = await fixture({ width, height: 844 }),
      page = await context.newPage()
    page.on("pageerror", (e) => errors.push(e.message))
    await page.goto(`${origin}/host/setup`)
    await page
      .getByRole("textbox", { name: "Message about your host setup" })
      .waitFor()
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false,
      `${width}px must not overflow`
    )
    await page.screenshot({
      path: `test-results/setup-conversation/ready-mobile-${width}.png`,
      fullPage: true,
    })
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify(
      {
        passed: [
          "durable transcript/draft reload",
          "keyboard submit/newline",
          "failure retains input and retry identity",
          "all confirmation revisions",
          "stale review conflict",
          "Google browser return",
          "writable calendar selection",
          "ready link",
          "honest offline iMessage",
          "structured recovery",
          "desktop/mobile 320px",
          "reverse iMessage browser handoff clears URL",
          "link proof survives refresh and confirm removes proof",
          "explicit observed identity confirmation and unlink",
        ],
        mutations: requests.length,
        screenshots: "test-results/setup-conversation",
      },
      null,
      2
    )
  )
} finally {
  await browser.close()
  server?.kill()
}
