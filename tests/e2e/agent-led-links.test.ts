import { writeFile } from "node:fs/promises";
import { MONDAY } from "../integration/support/scheduling";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Database } from "../../lib/server/database";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { createImessageReceiptHandler } from "../../lib/server/imessage-receipts";
import { photonConfig } from "../../lib/server/photon";
import { IMESSAGE_RECEIPT_JOB, receivePhotonWebhook } from "../../lib/server/photon-receiver";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { completeGoogleLeg } from "../integration/support/auth";
import { unreachableSetup } from "../integration/support/imessage";
import { messagesEvent, newSender, signedWebhook, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "../integration/support/photon";
import { runJob } from "../integration/support/requests";
import { agreedReviewRequest, runBookings, readyReviewHost } from "./support/host-review";
import { readyRequestHost, runEmails, runEvaluations, sentTo } from "./support/requester";
import { expect, signedInHost, test } from "./support/session";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./support/token-key";

const key = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);
const redirect = "https://agent.example.test/callback";
const runtime: ConversationRuntime = { createSession: async () => "unused", readEvents: () => (async function* () {})(), readRecordedEvents: () => (async function* () {})(), sendMessage: async () => undefined };
async function receive(db: Database, sender: string, text: string, origin: string) {
  const id = `msg_${randomUUID()}`;
  const response = await receivePhotonWebhook(signedWebhook(messagesEvent({ id, sender, text })), () => ({ config: { secret: TEST_WEBHOOK_SECRET, webhookId: TEST_WEBHOOK_ID }, db, tokenKey: key }));
  expect(response.status).toBe(200);
  const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${id}`;
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_RECEIPT_JOB} and dedupe_key = ${`receipt:${receipt!.id}`}`;
  await runJob(db, job!.id, createImessageReceiptHandler(() => ({ config: { ...photonConfig({}), apiUrl: "http://127.0.0.1:3106", lineNumber: "+15550001111" }, conversation: { db, runtime, signingKey: "s".repeat(40) }, db, env: {}, notices: { origin, tokenKey: key, tokenKeys: [key] }, origin, setup: unreachableSetup(db), tokenKey: key, tokenKeys: [key] })));
}

async function connect(page: Page, origin: string, resource: string, role: "host" | "requester") {
  const registered = await fetch(`${origin}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "U08 Local Agent", redirect_uris: [redirect] }) });
  expect(registered.status).toBe(201);
  const { client_id } = await registered.json();
  const verifier = randomBytes(32).toString("base64url");
  const scope = role === "host" ? "host:read host:write host:decide" : "request:read request:write request:decide";
  const params = new URLSearchParams({ client_id, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", redirect_uri: redirect, resource, response_type: "code", scope, state: "local-uat" });
  await page.route(`${redirect}**`, route => route.fulfill({ contentType: "text/html", body: "Agent connected" }));
  await page.goto(`${origin}/connect/authorize?${params}`);
  await expect(page.getByRole("heading", { name: role === "host" ? "Connect U08 Local Agent to your account?" : "Let U08 Local Agent request a meeting for you?" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  for (const box of await page.getByRole("checkbox").all()) await expect(box).toBeChecked();
  await expect(page.getByRole("checkbox", { name: role === "host" ? /start chat links for you to confirm/ : /start an updates link for you to confirm/ })).toBeChecked();
  const returned = page.waitForRequest(url => url.url().startsWith(redirect));
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  const callback = new URL((await returned).url());
  const response = await fetch(`${origin}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id, code: callback.searchParams.get("code")!, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect, resource }) });
  expect(response.status).toBe(200);
  return (await response.json()).access_token as string;
}
async function call(resource: string, token: string, name: string, args = {}) {
  const response = await fetch(resource, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "mcp-protocol-version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.isError, JSON.stringify(body)).toBe(false);
  return body.result.structuredContent;
}

test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36" });
for (const role of ["host", "requester"] as const) test(`${role} starts a link through HTTP MCP and confirms on its browser page`, async ({ baseURL, context, db, page }, testInfo) => {
  test.setTimeout(120_000);
  const origin = baseURL!;
  const host = role === "host" ? await signedInHost(db, context, origin) : null;
  if (host) await readyReviewHost(db, host.hostAccountId, "Dodo Local");
  const requesterHost = role === "requester" ? await readyRequestHost(db, "Dodo Local") : null;
  const resource = host ? `${origin}/mcp` : `${origin}/${requesterHost!.handle}/mcp`;
  const evidence: Record<string, unknown> = {};
  if (requesterHost) {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/${requesterHost.handle}`);
    await page.getByRole("button", { name: "Start with agent" }).click();
    const prompt = `Book a meeting with Dodo Local for me: read ${origin}/${requesterHost.handle}/SKILL.md`;
    await expect(page.getByLabel("Prompt for your AI agent")).toHaveText(prompt);
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
    evidence.A1 = prompt;
  }
  const token = await connect(page, origin, resource, role);
  let requestId: string | null = null;
  let bookingUrl: string | null = null;
  if (requesterHost) {
    const before = await db`select id from app.requests where host_account_id = ${requesterHost.hostAccountId}`;
    expect(before).toHaveLength(0);
    evidence.A4 = "After consent: 0 requests";
    const email = `uat-${randomUUID()}@example.test`;
    const createArgs = { name: "Alex Kim", email, timezone: "Asia/Seoul", language: "en", details: { durationMinutes: 30, mode: "online" }, retryKey: randomUUID() };
    const created = await call(resource, token, "create_request", createArgs);
    requestId = created.requestId;
    expect(JSON.stringify(created)).not.toContain("/booking/");
    expect(created.request.details.purpose).toBeNull();
    await call(resource, token, "create_request", createArgs);
    expect(await db`select id from app.requests where host_account_id = ${requesterHost.hostAccountId}`).toHaveLength(1);
    await runEmails(db, requestId!);
    const emails = await sentTo(email);
    expect(emails).toHaveLength(1);
    bookingUrl = emails[0]!.text.match(/http:\/\/localhost:\d+\/booking\/[a-f0-9-]+/)?.[0] ?? null;
    expect(bookingUrl).toBeTruthy();
    evidence.A5 = { created, emailSubject: emails[0]!.subject, requests: 1, emails: 1 };
    const changed = await call(resource, token, "update_request_details", { expectedRevision: created.request.revision, retryKey: randomUUID(), input: { timezone: "Asia/Seoul", details: { purpose: "It's about our seed round.", windows: [{ date: MONDAY, start: "10:00", end: "13:00" }] } } });
    expect(changed.request.details.purpose).toBe("It's about our seed round.");
    const finding = call(resource, token, "find_times", { retryKey: randomUUID() });
    await expect.poll(async () => (await db`select id from app.evaluations where request_id = ${requestId!} and state = 'pending'`).length).toBeGreaterThan(0);
    await runEvaluations(db, requestId!);
    await finding;
    const read = await call(resource, token, "get_request");
    const evaluation = read.evaluation;
    expect(evaluation.candidates.length).toBeGreaterThanOrEqual(2);
    evidence.A6 = { timezone: "Asia/Seoul", candidates: evaluation.candidates.slice(0, 2) };
    const chosen = await call(resource, token, "choose_time", { expectedRevision: read.revision, input: { evaluationId: evaluation.id, candidateId: evaluation.candidates[1].id }, retryKey: randomUUID() });
    const agreed = await call(resource, token, "agree_to_proposal", { expectedRevision: chosen.request.revision, input: { version: chosen.outcome.version }, retryKey: randomUUID() });
    expect(agreed.request.state).toBe("awaiting_host_approval");
    evidence.A7 = agreed;
  }
  const stateTool = role === "host" ? "get_host_status" : "get_request";
  const stateKey = role === "host" ? "chat" : "updates";
  expect((await call(resource, token, stateTool))[stateKey].state).toBe("none");
  const started = await call(resource, token, role === "host" ? "start_chat_link" : "start_updates_link", { channel: "imessage", number: newSender(), retryKey: randomUUID() });
  expect((await call(resource, token, stateTool))[stateKey].state).toBe("pending");
  if (host) await context.clearCookies();
  const linkPage = await page.goto(started.linkUrl);
  expect(linkPage!.headers()["referrer-policy"]).toBe("same-origin");
  expect(linkPage!.headers()["x-robots-tag"]).toBe("noindex");
  if (host) {
    await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
    await page.route("**/auth/sign-in?return=link**", async route => {
      const response = await route.fetch({ maxRedirects: 0 });
      const authorize = new URL(response.headers().location!);
      await fetch(authorize, { redirect: "manual" });
      const code = await completeGoogleLeg(db, authorize.searchParams.get("code_challenge")!, host.userId, { accessToken: `ya29.${randomUUID()}`, refreshToken: null });
      await route.fulfill({ response, headers: { ...response.headers(), location: `${origin}/auth/callback?code=${code}` } });
    });
    await page.getByRole("link", { name: "Sign in with Google" }).click();
    await page.waitForURL(started.linkUrl);
  }
  await expect(page.getByTestId("imessage-qr").locator("svg")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy the link message" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Messages on this Mac" })).toBeVisible();
  const message = (await page.getByTestId("imessage-link-message").textContent())!.trim();
  const sender = newSender();
  await receive(db, sender, message, origin);
  await expect(page.getByRole("heading", { name: "Is this you?" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(sender, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${role}-received.png`) });
  await page.getByRole("button", { name: "Confirm and link" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Linked. You can go back to your agent.");
  const linked = await call(resource, token, stateTool);
  expect(linked[stateKey]).toMatchObject({ channel: "imessage", state: "linked", sender });
  evidence[role === "host" ? "B10" : "A8"] = started;
  evidence[role === "host" ? "B11" : "A9"] = { linked, actualSender: sender, pageText: await page.locator("main").innerText() };
  if (bookingUrl) {
    await page.goto(bookingUrl);
    await expect(page.getByText("Waiting for Dodo Local to approve", { exact: true })).toBeVisible({ timeout: 30_000 });
    const read = await call(resource, token, "get_request");
    expect(read.state).toBe("awaiting_host_approval");
    evidence.A10 = { pageText: await page.locator("main").innerText(), state: read.state, booking: read.booking };
  }
  if (host) {
    const request = await agreedReviewRequest(db, host.hostAccountId);
    const listed = await call(resource, token, "list_requests");
    const read = await call(resource, token, "get_request", { requestId: request.requestId });
    evidence.B12 = { listed, read };
    const approved = await call(resource, token, "approve_proposal", { requestId: request.requestId, version: read.proposal.version, expectedRevision: read.revision, hostInstruction: "Approve this request.", retryKey: randomUUID() });
    expect(approved.request.state).toBe("booking");
    await runBookings(db, request.requestId, origin);
    const booked = await call(resource, token, "get_request", { requestId: request.requestId });
    expect(booked.state).toBe("booked");
    evidence.B14 = { approved, booked };
    await page.goto("/app");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Connected agents" }).click();
    const dialog = page.getByRole("dialog", { name: "Connected agents" });
    await dialog.getByRole("button", { name: "Revoke U08 Local Agent" }).click();
    await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(dialog.getByText(/No agents are connected/)).toBeVisible();
    const revoked = await fetch(resource, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/call", params: { name: "list_requests", arguments: {} } }) });
    expect(revoked.status).toBe(401);
    evidence.B15 = { status: revoked.status, body: await revoked.json() };
  }
  const evidencePath = testInfo.outputPath(`${role}-actual-tool-results.json`);
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach(`${role}-actual-tool-results`, { path: evidencePath, contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath(`${role}-linked.png`) });
  await page.goto(started.linkUrl);
  await expect(page.getByRole("status")).toHaveText("This link is no longer open. Ask your agent to start again.");
});
