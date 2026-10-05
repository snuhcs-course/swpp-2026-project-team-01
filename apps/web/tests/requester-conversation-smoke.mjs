import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdir } from "node:fs/promises"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright")
const origin =
  process.env.WEB_REQUESTER_CHAT_TEST_URL ?? "http://127.0.0.1:5184"
if (!process.env.WEB_REQUESTER_CHAT_TEST_URL) {
  const server = spawn(
    process.execPath,
    [
      join(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5184",
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
  process.on("exit", () => server.kill())
  let started = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(origin)).ok) {
        started = true
        break
      }
    } catch {
      /* waiting for Vite */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(started, "Fixture Vite server must start")
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
})
const errors = []
const date = { start: "2026-10-06T05:00:00Z", end: "2026-10-06T05:30:00Z" }
const updatedDate = {
  start: "2026-10-06T06:00:00Z",
  end: "2026-10-06T06:30:00Z",
}
const base = {
  id: "chat-request",
  hostId: "fixture-host",
  revision: 1,
  status: "negotiating",
  contactVerified: true,
  calendarConnected: false,
  privateMessages: [],
  details: {
    requesterName: "Alex",
    requesterEmail: "alex@example.com",
    purpose: "Discuss a product idea",
    durationMinutes: 30,
    timezone: "Asia/Seoul",
    mode: "online",
    location: "",
    windows: [date],
  },
  candidates: [],
  proposal: null,
  requesterAgreed: false,
  hostApproved: false,
  event: null,
  nextAction: "provide_availability",
  messages: [],
}
const guestToken = "fixture-private-request-token"
let totalMutations = 0
async function runFlow(width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
  })
  await context.addInitScript(
    ({ guestToken }) =>
      localStorage.setItem("fmat-request:chat-request", guestToken),
    { guestToken }
  )
  let state = structuredClone(base),
    fail = true,
    evaluations = 0,
    revisedExternally = false
  const mutations = []
  await context.route(
    "https://example.supabase.co/functions/v1/api/**",
    async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname.replace("/functions/v1/api", "")
      const respond = (json, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
          body: JSON.stringify(json),
        })
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
      assert.equal(req.headers()["x-request-token"], guestToken)
      assert.equal(req.headers().authorization, undefined)
      if (req.method() === "GET") return respond(state)
      const body = req.postDataJSON()
      mutations.push({ path, body, key: req.headers()["idempotency-key"] })
      assert.match(req.headers()["idempotency-key"], /^[a-f0-9-]{36}$/)
      assert.equal(body.expectedRevision, state.revision)
      if (path.endsWith("/messages")) {
        if (fail) {
          fail = false
          return respond(
            {
              error: {
                code: "MODEL_UNAVAILABLE",
                message: "Please retry your message.",
              },
            },
            503
          )
        }
        const revision = state.revision + 1
        state = {
          ...state,
          revision,
          messages: [
            ...state.messages,
            {
              id: `message-${revision}`,
              role: "requester",
              text: body.text,
              createdAt: "2026-10-05T05:00:00Z",
            },
            {
              id: `assistant-${revision}`,
              role: "assistant",
              text: "Review the suggested change before applying it.",
              createdAt: "2026-10-05T05:00:01Z",
            },
          ],
        }
        if (!state.proposal)
          state.conversationReview = {
            reviewedRevision: revision,
            clarification:
              "I understood a new meeting purpose. Review before changing your request.",
            patch: { purpose: "Review the research plan" },
          }
        else if (revisedExternally) {
          state.proposal = { ...state.proposal, version: 2, ...updatedDate }
          delete state.conversationReview
        }
        return respond(state)
      }
      if (path.endsWith("/conversation-review")) {
        assert.equal(body.confirmed, true)
        assert.equal(body.reviewedRevision, state.revision)
        assert.deepEqual(body.patch, { purpose: "Review the research plan" })
        state = {
          ...state,
          revision: state.revision + 1,
          details: { ...state.details, ...body.patch },
          proposal: null,
          candidates: [],
          requesterAgreed: false,
          hostApproved: false,
        }
        delete state.conversationReview
      }
      if (path.endsWith("/evaluate")) {
        evaluations++
        state = {
          ...state,
          revision: state.revision + 1,
          candidates: [evaluations === 1 ? date : updatedDate],
        }
      }
      if (path.endsWith("/proposal")) {
        assert.equal(body.start, updatedDate.start)
        assert.equal(body.end, updatedDate.end)
        state = {
          ...state,
          revision: state.revision + 1,
          proposal: { ...state.details, ...updatedDate, version: 1 },
          nextAction: "review_proposal",
        }
      }
      if (path.endsWith("/agree")) {
        assert.equal(body.proposalVersion, 2)
        state = {
          ...state,
          revision: state.revision + 1,
          status: "awaiting_approval",
          requesterAgreed: true,
          nextAction: "await_host",
        }
      }
      assert.equal(
        path.endsWith("/approve") || path.endsWith("/book"),
        false,
        "Requester must not approve or book"
      )
      return respond(state)
    }
  )
  const page = await context.newPage()
  page.on("pageerror", (e) => errors.push(e.message))
  let releaseRouteModule
  const routeModuleReady = new Promise((resolve) => {
    releaseRouteModule = resolve
  })
  await context.route("**/src/Requests.tsx*", async (route) => {
    await routeModuleReady
    await route.continue()
  })
  const navigation = page.goto(`${origin}/requests/chat-request`)
  await page.locator("#main").getByLabel("Loading", { exact: true }).waitFor()
  assert.equal(await page.locator('a[href="#main"]').count(), 1)
  await page.getByRole("navigation", { name: "Main navigation" }).waitFor()
  releaseRouteModule()
  await navigation
  await page.getByRole("heading", { name: "Scheduling conversation" }).waitFor()
  const composer = page.getByRole("textbox", {
    name: "Your scheduling message",
  })
  await composer.fill(
    "Please update the purpose to reviewing the research plan."
  )
  await composer.press("Shift+Enter")
  assert.equal(mutations.length, 0)
  await composer.fill(
    "Please update the purpose to reviewing the research plan."
  )
  await composer.press("Enter")
  await page.getByText(/Please retry your message\./).waitFor()
  assert.equal(
    await composer.inputValue(),
    "Please update the purpose to reviewing the research plan."
  )
  await composer.press("Enter")
  await page
    .getByRole("heading", { name: "Suggested request changes" })
    .waitFor()
  assert.equal(await composer.inputValue(), "")
  assert.equal(
    state.details.purpose,
    "Discuss a product idea",
    "Sending must only create an inert review"
  )
  assert.equal(state.requesterAgreed, false)
  assert.equal(state.hostApproved, false)
  assert.equal(state.event, null)
  assert.equal(mutations[0].key, mutations[1].key)
  await page.screenshot({
    path: `test-results/requester-conversation/review-${width}.png`,
    fullPage: true,
  })
  await page
    .getByRole("button", { name: "Apply these changes", exact: true })
    .click()
  await page
    .getByText("Review the research plan", { exact: true })
    .first()
    .waitFor()
  assert.equal(state.details.purpose, "Review the research plan")
  await page
    .getByRole("button", { name: "Check availability", exact: true })
    .click()
  await page
    .getByRole("combobox", { name: "Feasible options" })
    .selectOption("0")
  assert.equal(
    await page
      .getByRole("button", { name: "Review this time", exact: true })
      .isDisabled(),
    false
  )
  await page
    .getByRole("button", { name: "Check availability", exact: true })
    .click()
  assert.equal(
    await page.getByRole("combobox", { name: "Feasible options" }).inputValue(),
    ""
  )
  assert.equal(
    await page
      .getByRole("button", { name: "Review this time", exact: true })
      .isDisabled(),
    true,
    "New candidate revision requires a new selection"
  )
  await page
    .getByRole("combobox", { name: "Feasible options" })
    .selectOption("0")
  await page
    .getByRole("button", { name: "Review this time", exact: true })
    .click()
  await page
    .getByRole("checkbox", {
      name: /I agree to proposal 1 with this exact time/,
    })
    .waitFor()
  assert.equal(
    await page
      .getByRole("button", { name: "Agree and send to host" })
      .isDisabled(),
    true
  )
  await page
    .getByRole("checkbox", {
      name: /I agree to proposal 1 with this exact time/,
    })
    .check()
  assert.equal(
    await page
      .getByRole("button", { name: "Agree and send to host" })
      .isDisabled(),
    false
  )
  revisedExternally = true
  await composer.fill("Has the host updated the proposal?")
  await composer.press("Enter")
  await page
    .getByRole("checkbox", {
      name: /I agree to proposal 2 with this exact time/,
    })
    .waitFor()
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: /I agree to proposal 2 with this exact time/,
      })
      .isChecked(),
    false
  )
  assert.equal(
    await page
      .getByRole("button", { name: "Agree and send to host" })
      .isDisabled(),
    true
  )
  await page
    .getByRole("checkbox", {
      name: /I agree to proposal 2 with this exact time/,
    })
    .check()
  await page.getByRole("button", { name: "Agree and send to host" }).click()
  await page
    .getByText(/You agreed to proposal 2. The host must still/)
    .waitFor()
  assert.equal(state.hostApproved, false)
  assert.equal(state.event, null)
  assert.equal(
    await page.getByRole("button", { name: "Approve this proposal" }).count(),
    0
  )
  assert.equal(await page.getByText("Booked", { exact: true }).count(), 0)
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  )
  await page.screenshot({
    path: `test-results/requester-conversation/awaiting-host-${width}.png`,
    fullPage: true,
  })
  totalMutations += mutations.length
  await context.close()
}
await mkdir("test-results/requester-conversation", { recursive: true })
try {
  for (const width of [1440, 390, 320]) await runFlow(width)
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify(
      {
        passed: [
          "lazy route loading preserves main landmark, navigation and skip link",
          "desktop/390px/320px conversation flow",
          "failure retains input and idempotency",
          "sending creates inert review only",
          "explicit reviewed patch application",
          "availability evaluation and selection",
          "new revision invalidates candidate selection",
          "explicit versioned agreement",
          "changed proposal clears previous agreement",
          "requester agreement never fakes booking or host approval",
        ],
        mutations: totalMutations,
        screenshots: "test-results/requester-conversation",
      },
      null,
      2
    )
  )
} finally {
  await browser.close()
}
