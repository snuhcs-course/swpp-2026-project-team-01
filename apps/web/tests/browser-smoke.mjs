import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdir } from "node:fs/promises"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright")
const origin = process.env.WEB_TEST_URL ?? "http://127.0.0.1:5176"
if (!process.env.WEB_TEST_URL) {
  const server = spawn(
    process.execPath,
    [
      join(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5176",
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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
})
const page = await context.newPage()
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
const mutations = []
let activeGuestToken = "protected-fixture-token"
let rejectStaleException = true
let delayNextRead = false
let delayedReadComplete
const delayedRead = new Promise((resolve) => {
  delayedReadComplete = resolve
})
let request = {
  id: "fixture-request",
  hostId: "fixture-host",
  revision: 1,
  status: "negotiating",
  contactVerified: false,
  calendarConnected: false,
  privateMessages: [
    {
      id: "private-fixture",
      role: "host",
      text: "Private host discussion",
      createdAt: "2026-10-05T00:00:00Z",
    },
  ],
  details: {
    requesterName: "Alex",
    requesterEmail: "alex@example.com",
    purpose: "Discuss a product idea",
    durationMinutes: 30,
    timezone: "Asia/Seoul",
    mode: "online",
    location: "",
    windows: [],
  },
  candidates: [
    { start: "2026-11-05T04:00:00.000Z", end: "2026-11-05T04:30:00.000Z" },
  ],
  proposal: null,
  requesterAgreed: false,
  hostApproved: false,
  event: null,
  nextAction: "Choose a time",
  messages: [],
  privateNotes: "Host secret preference",
}
await context.route(
  "https://example.supabase.co/functions/v1/api/**",
  async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace("/functions/v1/api", "")
    const headers = req.headers()
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
    if (req.method() === "POST") {
      assert.match(headers["idempotency-key"], /^[a-f0-9-]{36}$/)
      mutations.push({ path, headers, body: req.postDataJSON() })
    }
    if (path === "/waitlist")
      return respond(
        { error: { code: "UNAVAILABLE", message: "Please try again later." } },
        503
      )
    if (path === "/hosts/dodo")
      return respond({
        id: "fixture-host",
        handle: "dodo",
        displayName: "Dodo",
        durationMinutes: 30,
        timezone: "Asia/Seoul",
        ready: true,
      })
    if (path === "/hosts/dodo/requests") {
      request.details = req.postDataJSON()
      return respond({ request, token: "protected-fixture-token" })
    }
    if (path.endsWith("/recover")) {
      assert.equal(headers["x-request-token"], undefined)
      return respond({ status: "pending" })
    }
    if (path.endsWith("/recovery/redeem")) {
      assert.equal(headers["x-request-token"], undefined)
      assert.equal(req.postDataJSON().token, "one-time-recovery")
      activeGuestToken = "rotated-fixture-token"
      return respond({ request, token: activeGuestToken })
    }
    if (path.startsWith("/requests/fixture-request")) {
      assert.equal(headers["x-request-token"], activeGuestToken)
      assert.equal(
        headers.authorization,
        undefined,
        "Guest must not send host authorization"
      )
      if (req.method() === "GET") {
        if (delayNextRead) {
          delayNextRead = false
          const stale = structuredClone(request)
          await new Promise((resolve) => setTimeout(resolve, 800))
          await respond(stale)
          delayedReadComplete()
          return
        }
        return respond(request)
      }
      const body = req.postDataJSON()
      assert.equal(body.expectedRevision, request.revision)
      if (path.endsWith("/details")) {
        request = {
          ...request,
          revision: request.revision + 1,
          details: body.details,
          contactVerified: false,
          requesterAgreed: false,
          hostApproved: false,
          proposal: null,
          candidates: [],
          status: "negotiating",
        }
      }
      if (path.endsWith("/evaluate")) {
        request = {
          ...request,
          revision: request.revision + 1,
          candidates: [
            {
              start: "2026-11-05T04:00:00.000Z",
              end: "2026-11-05T04:30:00.000Z",
            },
          ],
        }
      }
      if (path.endsWith("/verification/start")) {
        request = { ...request, revision: request.revision + 1 }
        return respond({ status: "pending", request })
      }
      if (path.endsWith("/verification/confirm")) {
        assert.equal(body.code, "A".repeat(43))
        request = {
          ...request,
          revision: request.revision + 1,
          contactVerified: true,
        }
      }
      if (path.endsWith("/proposal")) {
        request = {
          ...request,
          revision: request.revision + 1,
          proposal: {
            ...request.details,
            start: body.start,
            end: body.end,
            version: 1,
          },
          nextAction: "Agree to the proposal",
        }
      }
      if (path.endsWith("/agree")) {
        assert.equal(body.proposalVersion, 1)
        request = {
          ...request,
          revision: request.revision + 1,
          status: "awaiting_approval",
          requesterAgreed: true,
          nextAction: "Awaiting host approval",
        }
      }
      return respond(request)
    }
    return respond(
      { error: { code: "NOT_FOUND", message: "Fixture route missing" } },
      404
    )
  }
)
await page.goto(origin)
await page.getByRole("heading", { name: /Good meetings/ }).waitFor()
await page.getByLabel("Email address").fill("alex@example.com")
await page.getByRole("button", { name: "Join the waitlist" }).click()
await page.getByText("Please try again later.", { exact: true }).waitFor()
await page.getByRole("button", { name: "Join the waitlist" }).click()
await page.getByText("Please try again later.", { exact: true }).waitFor()
assert.equal(
  mutations[0].headers["idempotency-key"],
  mutations[1].headers["idempotency-key"],
  "An uncertain retry must reuse its idempotency key"
)
assert.equal(
  await page.getByText("You’re on the waitlist.", { exact: false }).count(),
  0
)
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false
)
await mkdir("test-results", { recursive: true })
await page.screenshot({
  path: "test-results/landing-mobile.png",
  fullPage: true,
})
await page.goto(`${origin}/dodo`)
await page.getByRole("heading", { name: "Plan with Dodo" }).waitFor()
await page.getByRole("button", { name: "Request details" }).click()
const intakeDialog = page.getByRole("dialog", { name: "Request details" })
await intakeDialog.getByLabel("Your name", { exact: true }).fill("Alex")
await intakeDialog.getByLabel("Email address").fill("alex@example.com")
await intakeDialog
  .getByLabel("What would you like to discuss?")
  .fill("Discuss a product idea")
await intakeDialog.getByLabel("Window 1 starts").fill("2026-11-05T12:00")
await intakeDialog.getByLabel("Window 1 ends").fill("2026-11-05T17:00")
await intakeDialog
  .getByRole("button", { name: "Start a meeting request" })
  .click()
await page.waitForURL("**/requests/fixture-request")
await page.getByRole("heading", { name: "Your meeting request" }).waitFor()
assert.equal(
  await page.evaluate(() =>
    localStorage.getItem("fmat-request:fixture-request")
  ),
  "protected-fixture-token"
)
await page.getByRole("button", { name: "Request settings" }).click()
await page
  .getByRole("button", { name: "Edit details and availability" })
  .click()
await page.getByLabel("Meeting purpose").fill("Discuss a wider product idea")
await page.getByRole("button", { name: "Save updated details" }).click()
await page.getByText("Discuss a wider product idea", { exact: true }).waitFor()
await page.getByRole("button", { name: "Close" }).click()
await page.getByRole("button", { name: "Check availability" }).click()
await page.getByLabel("Feasible options").waitFor()
await page.getByLabel("Feasible options").selectOption("0")
await page.getByRole("button", { name: "Review this time" }).click()
await page.getByRole("button", { name: "Agree and send to host" }).waitFor()
assert.equal(
  await page
    .getByRole("button", { name: "Agree and send to host" })
    .isDisabled(),
  true
)
await page.getByRole("button", { name: "Request settings" }).click()
await page.getByRole("button", { name: "Request verification code" }).click()
await page
  .getByText("Verification delivery is pending.", { exact: false })
  .waitFor()
await page.goto(`${origin}/requests/fixture-request#verify=${"A".repeat(43)}`)
await page.waitForFunction(() => location.hash === "")
assert.equal(
  await page.getByLabel("Verification code").inputValue(),
  "A".repeat(43)
)
await page.getByRole("button", { name: "Verify contact" }).click()
await page.getByText("Contact verified", { exact: true }).waitFor()
await page.getByRole("button", { name: "Close" }).click()
await page
  .getByRole("checkbox", {
    name: "I agree to proposal 1 with this exact time, format, location, and purpose.",
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
    name: "I agree to proposal 1 with this exact time, format, location, and purpose.",
  })
  .check()
delayNextRead = true
await page.getByRole("button", { name: "Refresh status" }).click()
await page.getByRole("button", { name: "Agree and send to host" }).click()
await page
  .getByText("Awaiting host approval", { exact: true })
  .first()
  .waitFor()
await delayedRead
await page.getByText(/You agreed to proposal 1. The host must still/).waitFor()
assert.equal(await page.getByText("Booked", { exact: true }).count(), 0)
assert.equal(
  await page.getByText("Private review notes", { exact: true }).count(),
  0
)
assert.equal(
  await page.getByText("Private host discussion", { exact: true }).count(),
  0
)
assert.equal(
  await page.getByText("Host secret preference", { exact: true }).count(),
  0
)
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false
)
await page.screenshot({
  path: "test-results/request-mobile.png",
  fullPage: true,
})
await page.goto(`${origin}/host`)
await page.getByText("Welcome back.", { exact: true }).waitFor()
assert.equal(
  await page.getByRole("button", { name: "Approve this proposal" }).count(),
  0
)

const hostContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
})
const hostJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: "host-user", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.fixture`
await hostContext.addInitScript(
  ({ hostJwt }) =>
    localStorage.setItem(
      "sb-example-auth-token",
      JSON.stringify({
        access_token: hostJwt,
        refresh_token: "fixture-refresh",
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
  { hostJwt }
)
await hostContext.route(
  "https://example.supabase.co/functions/v1/api/**",
  async (route) => {
    const req = route.request()
    const headers = req.headers()
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
    assert.equal(headers.authorization, `Bearer ${hostJwt}`)
    assert.equal(headers["x-request-token"], undefined)
    if (req.method() === "POST") {
      const body = req.postDataJSON()
      mutations.push({ path: new URL(req.url()).pathname, headers, body })
      assert.equal(body.expectedRevision, request.revision)
      assert.match(headers["idempotency-key"], /^[a-f0-9-]{36}$/)
      if (new URL(req.url()).pathname.endsWith("/private-messages")) {
        assert.equal(body.text, "Only the host should see this question")
        request = {
          ...request,
          revision: request.revision + 1,
          privateMessages: [
            ...request.privateMessages,
            {
              id: "private-new",
              role: "host",
              text: body.text,
              createdAt: new Date().toISOString(),
            },
          ],
        }
      } else if (
        new URL(req.url()).pathname.endsWith("/preference-exception")
      ) {
        assert.equal(body.proposalVersion, request.proposal.version)
        assert.equal(body.confirmed, true)
        if (rejectStaleException) {
          rejectStaleException = false
          request = {
            ...request,
            revision: request.revision + 1,
            proposal: { ...request.proposal, version: 2 },
            requesterAgreed: false,
            hostApproved: false,
          }
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            headers: {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
            body: JSON.stringify({
              error: {
                code: "proposal_conflict",
                message: "This proposal changed. Refresh and review it.",
              },
            }),
          })
        }
        assert.equal(body.reason, "Private preference exception fixture reason")
        request = {
          ...request,
          revision: request.revision + 1,
          hostApproved: false,
          privateSchedulingContext: {
            ...request.privateSchedulingContext,
            preferenceException: {
              reason: body.reason,
              proposalVersion: body.proposalVersion,
              rulesVersion: 7,
            },
          },
        }
      } else if (new URL(req.url()).pathname.endsWith("/context")) {
        assert.equal(body.candidatePhysicalLocation, "SNU campus, Seoul")
        assert.equal(body.physicalContext[0].location, "Seoul Station")
        assert.ok(Number.isFinite(Date.parse(body.physicalContext[0].at)))
        request = {
          ...request,
          revision: request.revision + 1,
          requesterAgreed: false,
          hostApproved: false,
          status: "negotiating",
          privateSchedulingContext: {
            physicalContext: body.physicalContext,
            candidatePhysicalLocation: body.candidatePhysicalLocation,
          },
        }
      } else if (new URL(req.url()).pathname.endsWith("/travel-allowances")) {
        assert.equal(body.edge, "before")
        assert.equal(body.durationMinutes, 25)
        assert.equal(body.confirmed, true)
        assert.equal(body.start, request.proposal.start)
        assert.equal(body.end, request.proposal.end)
        request = {
          ...request,
          revision: request.revision + 1,
          requesterAgreed: false,
          hostApproved: false,
          status: "negotiating",
        }
      } else {
        assert.equal(body.proposalVersion, 1)
        assert.equal(body.confirmed, true)
        request = {
          ...request,
          status: "booking",
          revision: request.revision + 1,
          hostApproved: true,
          nextAction: "Booking pending",
        }
      }
    }
    return route.fulfill({
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(request),
    })
  }
)
const hostPage = await hostContext.newPage()
hostPage.on("pageerror", (error) => errors.push(error.message))
await hostPage.goto(`${origin}/host/requests/fixture-request`)
await hostPage.getByRole("heading", { name: "Meeting with Alex" }).waitFor()
assert.equal(
  await hostPage.getByText("Host secret preference", { exact: true }).count(),
  0
)
await hostPage.getByRole("button", { name: "Private", exact: true }).click()
await hostPage
  .getByLabel("Private message", { exact: true })
  .fill("Only the host should see this question")
await hostPage
  .getByRole("button", { name: "Send message", exact: true })
  .click()
await hostPage
  .getByText("Only the host should see this question", { exact: true })
  .waitFor()
await hostPage.getByRole("button", { name: "Shared", exact: true }).click()
assert.equal(
  await hostPage
    .getByRole("button", { name: "Approve this proposal" })
    .isDisabled(),
  true
)
await hostPage
  .getByRole("checkbox", {
    name: "I approve booking proposal 1 with these exact details.",
  })
  .check()
await hostPage.getByRole("button", { name: "Approve this proposal" }).click()
await hostPage.getByText("Booking is pending.", { exact: false }).waitFor()
assert.equal(
  await hostPage
    .getByText("Your meeting is confirmed.", { exact: false })
    .count(),
  0
)
assert.equal(
  await hostPage.getByRole("button", { name: "Approve this proposal" }).count(),
  0
)
assert.equal(
  await hostPage.evaluate(
    () => document.documentElement.scrollWidth > innerWidth
  ),
  false
)
await hostPage.getByRole("button", { name: "Private", exact: true }).click()
await hostPage
  .getByText("Only the host should see this question", { exact: true })
  .scrollIntoViewIfNeeded()
await hostPage
  .getByText("Only the host should see this question", { exact: true })
  .waitFor()
await hostPage.screenshot({
  path: "test-results/host-review-mobile.png",
  fullPage: true,
})

await page.goto(`${origin}/requests/fixture-request`)
assert.equal(
  await page.getByText("Private host discussion", { exact: true }).count(),
  0
)
assert.equal(
  await page
    .getByText("Only the host should see this question", { exact: true })
    .count(),
  0
)
await page.evaluate(() =>
  localStorage.removeItem("fmat-request:fixture-request")
)
await page.reload()
await page.getByText("This request is private.", { exact: false }).waitFor()
assert.equal(
  await page.getByRole("heading", { name: "Your meeting request" }).count(),
  0
)
assert.equal(await page.getByRole("textbox").count(), 0)
const recoveryRedeemsBefore = mutations.filter((mutation) =>
  mutation.path.endsWith("/recovery/redeem")
).length
await page.goto(`${origin}/requests/fixture-request#recovery=one-time-recovery`)
await page.getByRole("heading", { name: "Your meeting request" }).waitFor()
assert.equal(
  mutations.filter((mutation) => mutation.path.endsWith("/recovery/redeem"))
    .length,
  recoveryRedeemsBefore + 1,
  "A protected recovery link must be redeemed exactly once"
)
assert.equal(
  await page.evaluate(() =>
    localStorage.getItem("fmat-request:fixture-request")
  ),
  "rotated-fixture-token"
)
assert.equal(new URL(page.url()).hash, "")
request = {
  ...request,
  status: "awaiting_approval",
  requesterAgreed: true,
  hostApproved: false,
}
await hostPage.goto(`${origin}/host/requests/fixture-request`)
await hostPage.getByRole("button", { name: "Request settings" }).click()
await hostPage
  .getByRole("button", { name: "Review private travel details" })
  .click()
assert.equal(
  await hostPage
    .getByRole("button", { name: "Confirm specific travel allowance" })
    .isDisabled(),
  true
)
await hostPage.getByLabel("Confirmed travel time (minutes)").fill("20")
await hostPage
  .getByRole("checkbox", {
    name: "I confirm 20 minutes for the trip to this specific meeting.",
  })
  .check()
await hostPage.getByLabel("Confirmed travel time (minutes)").fill("25")
assert.equal(
  await hostPage
    .getByRole("checkbox", {
      name: "I confirm 25 minutes for the trip to this specific meeting.",
    })
    .isChecked(),
  false
)
assert.equal(
  await hostPage
    .getByRole("button", { name: "Confirm specific travel allowance" })
    .isDisabled(),
  true
)
await hostPage
  .getByRole("checkbox", {
    name: "I confirm 25 minutes for the trip to this specific meeting.",
  })
  .check()
await hostPage
  .getByRole("button", { name: "Confirm specific travel allowance" })
  .click()
await hostPage
  .getByRole("button", { name: "Review private travel details" })
  .waitFor()
await hostPage
  .getByRole("button", { name: "Review private travel details" })
  .click()
await hostPage
  .getByLabel("Where you’ll physically be during this meeting")
  .fill("SNU campus, Seoul")
await hostPage.getByRole("button", { name: "Add a confirmed location" }).click()
await hostPage.getByLabel("Location 1 at").fill("2026-11-05T12:00")
await hostPage.getByLabel("Location 1 address").fill("Seoul Station")
await hostPage.getByRole("button", { name: "Save private whereabouts" }).click()
await hostPage
  .getByRole("button", { name: "Review private travel details" })
  .waitFor()
assert.equal(
  await hostPage.getByRole("button", { name: "Approve this proposal" }).count(),
  0
)
assert.equal(
  await hostPage.evaluate(
    () => document.documentElement.scrollWidth > innerWidth
  ),
  false
)
await hostPage
  .getByLabel("Private reason for this preference exception")
  .fill("Initial private preference reason")
await hostPage
  .getByRole("checkbox", {
    name: "I confirm this private preference exception for proposal 1 with these exact details.",
  })
  .check()
await hostPage
  .getByLabel("Private reason for this preference exception")
  .fill("Changed private preference reason")
assert.equal(
  await hostPage
    .getByRole("button", { name: "Confirm preference exception" })
    .isDisabled(),
  true
)
await hostPage
  .getByRole("checkbox", {
    name: "I confirm this private preference exception for proposal 1 with these exact details.",
  })
  .check()
await hostPage
  .getByRole("button", { name: "Confirm preference exception" })
  .click()
await hostPage
  .getByText("This proposal changed. Refresh and review it.", { exact: false })
  .waitFor()
assert.equal(
  await hostPage.getByText("Saved for proposal", { exact: false }).count(),
  0
)
await hostPage.getByRole("button", { name: "Close" }).click()
await hostPage.getByRole("button", { name: "Refresh status" }).click()
await hostPage.getByRole("button", { name: "Request settings" }).click()
await hostPage
  .getByRole("checkbox", {
    name: "I confirm this private preference exception for proposal 2 with these exact details.",
  })
  .waitFor()
assert.equal(
  await hostPage
    .getByRole("checkbox", {
      name: "I confirm this private preference exception for proposal 2 with these exact details.",
    })
    .isChecked(),
  false
)
await hostPage
  .getByLabel("Private reason for this preference exception")
  .fill("Private preference exception fixture reason")
await hostPage
  .getByRole("checkbox", {
    name: "I confirm this private preference exception for proposal 2 with these exact details.",
  })
  .check()
await hostPage
  .getByRole("button", { name: "Confirm preference exception" })
  .click()
await hostPage
  .getByText(
    "Saved for proposal 2, rules version 7: Private preference exception fixture reason",
    { exact: true }
  )
  .waitFor()
assert.equal(request.hostApproved, false)
assert.equal(request.requesterAgreed, false)
await hostPage
  .getByRole("heading", { name: "Private preference exception" })
  .scrollIntoViewIfNeeded()
assert.equal(
  await hostPage.evaluate(
    () => document.documentElement.scrollWidth > innerWidth
  ),
  false
)
await hostPage.screenshot({
  path: "test-results/private-preference-mobile.png",
  fullPage: true,
})
await page.goto(`${origin}/requests/fixture-request`)
await page.getByRole("heading", { name: "Your meeting request" }).waitFor()
assert.equal(
  await page
    .getByText("Private preference exception fixture reason", { exact: false })
    .count(),
  0
)
assert.equal(
  await page
    .getByRole("heading", { name: "Private preference exception" })
    .count(),
  0
)
request = {
  ...request,
  revision: request.revision + 1,
  proposal: null,
  candidates: [],
  nextAction: "resolve_availability",
}
await page.reload()
await page.getByText("Clarify availability", { exact: true }).waitFor()
await page.getByRole("heading", { name: "Find a time", exact: true }).waitFor()
await page
  .getByRole("button", { name: "Check availability", exact: true })
  .waitFor()
assert.equal(
  await page.getByText("resolve_availability", { exact: true }).count(),
  0
)
const loginContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
})
let identityRedirect
await loginContext.route(
  "https://example.supabase.co/auth/v1/authorize**",
  async (route) => {
    identityRedirect = new URL(route.request().url())
    assert.equal(identityRedirect.searchParams.get("provider"), "google")
    assert.equal(
      identityRedirect.searchParams.get("redirect_to"),
      `${origin}/host`
    )
    assert.equal(
      identityRedirect.searchParams.get("scopes"),
      null,
      "Identity login must not request Calendar scopes"
    )
    assert.ok(
      identityRedirect.searchParams.get("code_challenge"),
      "Identity login uses configured PKCE"
    )
    await route.fulfill({
      contentType: "text/html",
      body: "<h1>Identity provider fixture</h1>",
    })
  }
)
const loginPage = await loginContext.newPage()
loginPage.on("pageerror", (error) => errors.push(error.message))
await loginPage.goto(`${origin}/host`)
await loginPage.getByRole("button", { name: "Continue with Google" }).waitFor()
assert.equal(
  await loginPage
    .getByRole("button", { name: "Email me a sign-in link" })
    .count(),
  1
)
const mutationsBeforeLogin = mutations.length
await loginPage.getByRole("button", { name: "Continue with Google" }).click()
await loginPage
  .getByRole("heading", { name: "Identity provider fixture" })
  .waitFor()
assert.ok(identityRedirect)
assert.equal(
  mutations.length,
  mutationsBeforeLogin,
  "Identity redirect grants no admission or scheduling authority"
)
assert.deepEqual(errors, [])
console.log(
  JSON.stringify(
    {
      passed: [
        "waitlist errors stay errors",
        "uncertain mutation retry reuses idempotency key",
        "late poll cannot overwrite newer agreement revision",
        "mobile layout fits viewport",
        "account-free intake saves protected credential",
        "guest sends scoped credential only",
        "mutations have idempotency UUID and current revision",
        "explicit manual details update clears decisions and rechecks availability",
        "recovery remains pending until one-time credential redeemed and rotated",
        "private host messages stay in host-only UI",
        "verification uses current returned revision and becomes verified only after confirm",
        "required contact verification precedes the disabled agreement action",
        "exact proposal agreement requires checkbox",
        "agreement remains pending host approval",
        "private host notes absent in guest",
        "host workspace requires authentication",
        "Google identity login redirects with PKCE and no Calendar scopes or admission mutation",
        "host uses JWT only",
        "host approval binds exact version and needs checkbox",
        "approval stays booking pending until provider confirmation",
        "private preference exception requires renewed reason/proposal confirmation and rejects stale saves",
        "private exception stays host-only and never grants agreement or approval",
        "unresolved availability asks for clarification without declaring impossibility",
        "manual travel allowance confirmation resets when its bound details change",
        "private whereabouts save uses host authority and invalidates old decisions",
      ],
      mutations: mutations.length,
      screenshots: [
        "test-results/landing-mobile.png",
        "test-results/request-mobile.png",
        "test-results/host-review-mobile.png",
        "test-results/private-preference-mobile.png",
      ],
    },
    null,
    2
  )
)
await browser.close()
