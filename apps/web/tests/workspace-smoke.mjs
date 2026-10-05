import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright")
const origin = process.env.WEB_WORKSPACE_TEST_URL ?? "http://127.0.0.1:5177"
let server

if (!process.env.WEB_WORKSPACE_TEST_URL) {
  server = spawn(
    process.execPath,
    [
      join(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5177",
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

const requests = [
  requestFixture({
    id: "request-alex",
    name: "Alex Morgan",
    email: "alex@example.com",
    purpose: "Review the product direction",
    status: "awaiting_approval",
    proposal: true,
  }),
  requestFixture({
    id: "request-jordan",
    name: "Jordan Lee",
    email: "jordan@example.com",
    purpose: "Plan the research interview",
    status: "negotiating",
  }),
  requestFixture({
    id: "request-min",
    name: "Min Park",
    email: "min@example.com",
    purpose: "Weekly project check-in",
    status: "booked",
    proposal: true,
  }),
  requestFixture({
    id: "request-taylor",
    name: "Taylor Kim",
    email: "taylor@example.com",
    purpose: "A finished design review",
    status: "declined",
  }),
]

function requestFixture({
  id,
  name,
  email,
  purpose,
  status,
  proposal = false,
}) {
  return {
    id,
    hostId: "fixture-host",
    revision: 1,
    status,
    contactVerified: true,
    calendarConnected: true,
    details: {
      requesterName: name,
      requesterEmail: email,
      purpose,
      durationMinutes: 30,
      timezone: "Asia/Seoul",
      mode: "online",
      location: "",
      windows: [],
    },
    candidates: [],
    proposal: proposal
      ? {
          version: 1,
          start: "2026-11-05T04:00:00.000Z",
          end: "2026-11-05T04:30:00.000Z",
          timezone: "Asia/Seoul",
          mode: "online",
          location: "",
          requesterName: name,
          requesterEmail: email,
          purpose,
        }
      : null,
    requesterAgreed: status === "awaiting_approval" || status === "booked",
    hostApproved: status === "booked",
    event:
      status === "booked"
        ? { id: "fixture-event", url: "https://calendar.example/event" }
        : null,
    nextAction: status === "awaiting_approval" ? "approve" : "none",
    messages: [],
  }
}

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

async function routeWorkspace(context, hostJwt) {
  await context.route(
    "https://example.supabase.co/functions/v1/api/**",
    async (route) => {
      const req = route.request()
      if (req.method() === "OPTIONS") {
        return route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          },
        })
      }
      assert.equal(req.headers().authorization, `Bearer ${hostJwt}`)
      assert.equal(req.headers()["x-request-token"], undefined)
      const path = new URL(req.url()).pathname.replace("/functions/v1/api", "")
      if (req.method() === "POST") {
        assert.match(req.headers()["idempotency-key"], /^[a-f0-9-]{36}$/)
        mutations.push({ path, body: req.postDataJSON() })
      }
      if (path === "/host/setup/conversation") {
        return fulfill(route, {
          id: "fixture-conversation",
          revision: 1,
          turns: [],
          draft: null,
          review: null,
          setup: setupState,
          channelLink: null,
        })
      }
      if (path === "/host/imessage/link")
        return fulfill(route, { available: false, link: null, challenge: null })
      if (path === "/host/setup" && req.method() === "GET") {
        return fulfill(route, setupState)
      }
      if (path === "/host/setup" && req.method() === "POST") {
        const body = req.postDataJSON()
        setupState = {
          ...setupState,
          admitted: true,
          profile: {
            ...profile,
            handle: body.handle,
            displayName: body.displayName,
            timezone: body.rules.timezone,
            durationMinutes: body.rules.durationMinutes,
          },
          rules: body.rules,
        }
        return fulfill(route, setupState)
      }
      if (path === "/host/invitations/redeem") {
        setupState = structuredClone(states.admitted)
        return fulfill(route, setupState)
      }
      if (path === "/host/calendars") {
        return fulfill(route, {
          calendars: [
            {
              id: "primary",
              summary: "Primary calendar",
              accessRole: "owner",
              primary: true,
            },
            { id: "team", summary: "Team calendar", accessRole: "reader" },
          ],
        })
      }
      if (path === "/host/requests") {
        return fulfill(route, { requests })
      }
      return fulfill(
        route,
        { error: { code: "NOT_FOUND", message: `Missing fixture: ${path}` } },
        404
      )
    }
  )
}

async function authenticatedContext(options = {}) {
  const context = await browser.newContext(options)
  const hostJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
    JSON.stringify({
      sub: "host-user",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url")}.fixture`
  const email =
    options.email ??
    "host-with-a-very-long-workspace-address@calendar-coordination.example"
  await context.addInitScript(
    ({ hostJwt, email }) => {
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
            email,
            aud: "authenticated",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-01-01T00:00:00Z",
          },
        })
      )
    },
    { hostJwt, email }
  )
  await routeWorkspace(context, hostJwt)
  return context
}

function watchErrors(page) {
  page.on("pageerror", (error) => errors.push(error.message))
}

async function assertNoOverflow(page, label) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false,
    `${label} must fit the viewport`
  )
}

await mkdir("test-results/workspace", { recursive: true })

try {
  const loginDesktopContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  })
  const loginDesktop = await loginDesktopContext.newPage()
  watchErrors(loginDesktop)
  await loginDesktop.goto(`${origin}/host`)
  await loginDesktop.getByRole("heading", { name: "Welcome back." }).waitFor()
  await loginDesktop.getByText("Set your rules", { exact: true }).waitFor()
  await loginDesktop
    .getByRole("button", { name: "Continue with Google" })
    .waitFor()
  await loginDesktop
    .getByRole("button", { name: "Email me a sign-in link" })
    .waitFor()
  await assertNoOverflow(loginDesktop, "Desktop sign-in")
  await loginDesktop.screenshot({
    path: "test-results/workspace/sign-in-desktop.png",
  })
  await loginDesktopContext.close()

  const loginMobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const loginMobile = await loginMobileContext.newPage()
  watchErrors(loginMobile)
  await loginMobile.goto(`${origin}/host`)
  await loginMobile.getByRole("heading", { name: "Welcome back." }).waitFor()
  assert.equal(
    await loginMobile.getByText("Set your rules", { exact: true }).isVisible(),
    false,
    "The supporting panel should not crowd the mobile sign-in form"
  )
  await assertNoOverflow(loginMobile, "Mobile sign-in")
  await loginMobile.screenshot({
    path: "test-results/workspace/sign-in-mobile.png",
    fullPage: true,
  })
  await loginMobileContext.close()

  const darkContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
  })
  const darkPage = await darkContext.newPage()
  watchErrors(darkPage)
  await darkPage.goto(`${origin}/host`)
  await darkPage.getByRole("heading", { name: "Welcome back." }).waitFor()
  await darkPage.waitForFunction(() =>
    document.documentElement.classList.contains("dark")
  )
  await darkPage.screenshot({
    path: "test-results/workspace/sign-in-dark.png",
  })
  await darkContext.close()

  const desktopContext = await authenticatedContext({
    viewport: { width: 1440, height: 1000 },
    email: "host@example.com",
  })
  const desktop = await desktopContext.newPage()
  watchErrors(desktop)
  setupState = structuredClone(states.unadmitted)
  await desktop.goto(`${origin}/host/setup`)
  await desktop
    .getByRole("heading", { name: "Your calendar, in conversation" })
    .waitFor()
  await desktop.getByText("0 of 5 steps complete.", { exact: false }).waitFor()
  await desktop
    .getByRole("heading", { name: "A spot for your calendar" })
    .waitFor()
  assert.equal(
    await desktop
      .getByRole("link", { name: "Meeting inbox" })
      .getAttribute("href"),
    "/host/inbox"
  )
  assert.equal(
    await desktop
      .getByRole("link", { name: "Scheduling setup" })
      .getAttribute("href"),
    "/host/setup"
  )

  setupState = structuredClone(states.admitted)
  await desktop.reload()
  await desktop.getByText("2 of 5 steps complete.", { exact: false }).waitFor()
  await desktop.getByRole("button", { name: "Setup settings" }).click()
  await desktop
    .getByRole("heading", { name: "Your scheduling rules" })
    .waitFor()
  await desktop
    .getByRole("heading", { name: "Your calendars" })
    .first()
    .waitFor()
  await desktop
    .getByRole("button", { name: "Connect Google Calendar" })
    .first()
    .waitFor()
  await desktop.getByLabel("Display name").fill("Dodo Park")
  const setupMutationsBeforeSave = mutations.filter(
    (mutation) => mutation.path === "/host/setup"
  ).length
  await desktop.getByRole("button", { name: "Confirm and save rules" }).click()
  await desktop.getByText("Your settings have been saved.").waitFor()
  assert.equal(
    mutations.filter((mutation) => mutation.path === "/host/setup").length,
    setupMutationsBeforeSave + 1,
    "The redesigned setup form must still save exactly once"
  )
  await desktop.getByRole("button", { name: "Close" }).click()
  assert.equal(
    mutations.at(-1).body.displayName,
    "Dodo Park",
    "Setup changes must preserve the edited form value"
  )

  setupState = structuredClone(states.ready)
  await desktop.reload()
  await desktop.getByText("5 of 5 steps complete.", { exact: false }).waitFor()
  await desktop.getByText("Booking link ready", { exact: true }).waitFor()
  await desktop.getByRole("button", { name: "Setup settings" }).click()
  await desktop.getByText(`${origin}/dodo`, { exact: true }).waitFor()
  const bookingDestination = desktop.getByLabel("Booking destination")
  await bookingDestination.waitFor()
  assert.equal(await bookingDestination.inputValue(), "primary")
  assert.equal(
    await bookingDestination.locator('option[value="primary"]').textContent(),
    "Primary calendar"
  )
  await desktop.getByRole("button", { name: "Close" }).click()
  await assertNoOverflow(desktop, "Ready desktop workspace")
  await desktop.screenshot({
    path: "test-results/workspace/setup-ready-desktop.png",
    fullPage: true,
  })

  const setupMutationsBeforeNavigation = mutations.filter(
    (mutation) => mutation.path === "/host/setup"
  ).length
  await desktop.getByRole("link", { name: "Meeting inbox" }).click()
  await desktop.waitForURL("**/host/inbox")
  await desktop.getByRole("heading", { name: "Your meeting inbox" }).waitFor()
  await desktop.getByText("Alex Morgan", { exact: true }).waitFor()
  await desktop.getByText("Jordan Lee", { exact: true }).waitFor()
  await desktop.getByText("Min Park", { exact: true }).waitFor()
  await desktop.getByText("Taylor Kim", { exact: true }).waitFor()
  assert.equal(
    mutations.filter((mutation) => mutation.path === "/host/setup").length,
    setupMutationsBeforeNavigation,
    "Workspace navigation must not submit the setup form"
  )
  const search = desktop.getByLabel("Search requests")
  await search.fill("taylor")
  await desktop.getByText("Taylor Kim", { exact: true }).waitFor()
  assert.equal(
    await desktop.getByText("Alex Morgan", { exact: true }).count(),
    0
  )
  await search.fill("no-person-matches-this")
  await desktop.getByText("No matching requests", { exact: true }).waitFor()
  await desktop.getByRole("button", { name: "Clear search" }).click()
  await desktop.getByText("Alex Morgan", { exact: true }).waitFor()
  await assertNoOverflow(desktop, "Desktop meeting inbox")
  await desktop.screenshot({
    path: "test-results/workspace/inbox-desktop.png",
    fullPage: true,
  })
  await desktopContext.close()

  const mobileContext = await authenticatedContext({
    viewport: { width: 390, height: 844 },
  })
  const mobile = await mobileContext.newPage()
  watchErrors(mobile)
  setupState = structuredClone(states.ready)
  await mobile.goto(`${origin}/host/setup`)
  await mobile
    .getByRole("heading", { name: "Your calendar, in conversation" })
    .waitFor()
  const sidebarToggle = mobile.getByRole("button", { name: "Toggle Sidebar" })
  await sidebarToggle.click()
  const sidebarDialog = mobile.getByRole("dialog", { name: "Sidebar" })
  await sidebarDialog.waitFor()
  await sidebarDialog.getByRole("link", { name: "Meeting inbox" }).waitFor()
  await mobile.waitForTimeout(300)
  await mobile.screenshot({
    path: "test-results/workspace/sidebar-mobile.png",
    animations: "disabled",
  })
  await mobile.keyboard.press("Escape")
  await sidebarDialog.waitFor({ state: "hidden" })
  assert.equal(
    await sidebarToggle.evaluate(
      (element) => element === document.activeElement
    ),
    true,
    "Closing the mobile workspace menu must return focus to its trigger"
  )
  await assertNoOverflow(mobile, "Mobile ready workspace")
  await mobile.screenshot({
    path: "test-results/workspace/setup-ready-mobile.png",
    fullPage: true,
  })
  await mobile.goto(`${origin}/host/inbox`)
  await mobile.getByRole("heading", { name: "Your meeting inbox" }).waitFor()
  await assertNoOverflow(mobile, "Mobile meeting inbox")
  await mobile.screenshot({
    path: "test-results/workspace/inbox-mobile.png",
    fullPage: true,
  })
  await mobileContext.close()

  const narrowContext = await authenticatedContext({
    viewport: { width: 320, height: 700 },
  })
  const narrow = await narrowContext.newPage()
  watchErrors(narrow)
  setupState = structuredClone(states.ready)
  await narrow.goto(`${origin}/host/setup`)
  await narrow
    .getByRole("heading", { name: "Your calendar, in conversation" })
    .waitFor()
  await narrow.getByRole("button", { name: "Toggle Sidebar" }).click()
  await narrow
    .getByTitle(
      "host-with-a-very-long-workspace-address@calendar-coordination.example"
    )
    .waitFor()
  await assertNoOverflow(narrow, "320px workspace with a long email address")
  await narrowContext.close()

  for (const fixture of [
    {
      name: "Requester desktop",
      viewport: { width: 1440, height: 1000 },
      screenshot: "requester-intake-desktop.png",
      fullPage: false,
    },
    {
      name: "Requester mobile",
      viewport: { width: 390, height: 844 },
      screenshot: "requester-intake-mobile.png",
      fullPage: true,
    },
  ]) {
    const requesterContext = await browser.newContext({
      viewport: fixture.viewport,
    })
    await requesterContext.route(
      "https://example.supabase.co/functions/v1/api/hosts/dodo",
      (route) =>
        fulfill(route, {
          id: "fixture-host",
          handle: "dodo",
          displayName: "Dodo",
          durationMinutes: 30,
          timezone: "Asia/Seoul",
          ready: true,
        })
    )
    const requester = await requesterContext.newPage()
    watchErrors(requester)
    await requester.goto(`${origin}/dodo`)
    await requester.getByRole("heading", { name: "Meet with Dodo" }).waitFor()
    await requester.getByRole("button", { name: "Request details" }).click()
    await requester.getByLabel("Your name", { exact: true }).waitFor()
    await requester.getByLabel("Email address").waitFor()
    await requester
      .getByRole("button", { name: "Start a meeting request" })
      .waitFor()
    await assertNoOverflow(requester, fixture.name)
    await requester.screenshot({
      path: `test-results/workspace/${fixture.screenshot}`,
      fullPage: fixture.fullPage,
    })
    await requesterContext.close()
  }

  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify(
      {
        passed: [
          "desktop, mobile, and dark sign-in layouts render without overflow",
          "workspace sidebar links point to the setup and inbox routes",
          "unadmitted, admitted, and ready setup states explain their progress",
          "the redesigned scheduling form saves once with the current values",
          "workspace navigation cannot accidentally submit setup",
          "inbox shows real status groups and supports search and no-results recovery",
          "mobile sidebar closes on Escape and restores trigger focus",
          "320px workspace contains a long account email without horizontal overflow",
          "requester intake renders at desktop and mobile sizes without overflow",
        ],
        mutations: mutations.length,
        screenshots: [
          "test-results/workspace/sign-in-desktop.png",
          "test-results/workspace/sign-in-mobile.png",
          "test-results/workspace/sign-in-dark.png",
          "test-results/workspace/setup-ready-desktop.png",
          "test-results/workspace/inbox-desktop.png",
          "test-results/workspace/sidebar-mobile.png",
          "test-results/workspace/setup-ready-mobile.png",
          "test-results/workspace/inbox-mobile.png",
          "test-results/workspace/requester-intake-desktop.png",
          "test-results/workspace/requester-intake-mobile.png",
        ],
      },
      null,
      2
    )
  )
} finally {
  await browser.close()
  server?.kill()
}
