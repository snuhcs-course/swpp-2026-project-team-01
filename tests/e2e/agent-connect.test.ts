import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { makeHostReady, newHostAccount } from "../integration/support/ready-host";
import { expect, signedInHost, test } from "./support/session";

// A host connects a personal agent (agent-access task 3.2): the consent page
// names the client and where it returns, the host narrows the permissions with
// the keyboard and allows, the agent receives a code, and Connected agents in
// /app lists the connection and revokes it. At phone and desktop widths.

const REDIRECT = "https://agent.example.test/callback";

async function registerClient(baseURL: string) {
  const response = await fetch(`${baseURL}/oauth/register`, {
    body: JSON.stringify({ client_name: "Browser Test Agent", redirect_uris: [REDIRECT] }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

async function startConsent(page: Page, baseURL: string, clientId: string, resource = `${baseURL}/mcp`, scope = "host:read host:write host:decide") {
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(`${baseURL}/connect/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    redirect_uri: REDIRECT,
    resource,
    response_type: "code",
    scope,
    state: "browser-state",
  }).toString();
  await page.goto(url.toString());
}

for (const width of [390, 1280]) {
  test(`a host allows a narrowed connection and revokes it at ${width}px`, async ({ baseURL, context, db, page }) => {
    await page.setViewportSize({ height: 900, width });
    await signedInHost(db, context, baseURL!);
    const clientId = await registerClient(baseURL!);

    const returned: string[] = [];
    // The redirect hop to the agent is not routable in Playwright, so the test
    // records the request the browser makes to the agent's callback.
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "agent.example.test") returned.push(request.url());
    });

    await startConsent(page, baseURL!, clientId);
    await expect(page.getByRole("heading", { name: "Connect Browser Test Agent to your account?" })).toBeVisible();
    await expect(page.getByText("agent.example.test")).toBeVisible();

    const decide = page.getByRole("checkbox", { name: /Prepare approvals and declines/ });
    await decide.focus();
    await page.keyboard.press("Space");
    await expect(decide).not.toBeChecked();
    await page.getByRole("button", { name: "Allow" }).focus();
    await page.keyboard.press("Enter");

    await expect.poll(() => returned.length).toBe(1);
    const response = new URL(returned[0]!);
    expect(response.searchParams.get("code")).toBeTruthy();
    expect(response.searchParams.get("state")).toBe("browser-state");
    expect(response.searchParams.get("iss")).toBe(baseURL);

    // The tab is still failing to reach the made-up agent host, so /app opens in another.
    const app = await context.newPage();
    await app.setViewportSize({ height: 900, width });
    await app.goto("/app");
    await app.getByRole("button", { name: "Open menu" }).click();
    await app.getByRole("menuitem", { name: "Connected agents" }).click();
    const dialog = app.getByRole("dialog", { name: "Connected agents" });
    await expect(dialog.getByText("Browser Test Agent", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Can read, change.")).toBeVisible();

    await dialog.getByRole("button", { name: "Revoke Browser Test Agent" }).click();
    await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(dialog.getByText(/No agents are connected/)).toBeVisible();
  });
}

test("a denied connection returns access_denied and connects nothing", async ({ baseURL, context, db, page }) => {
  await signedInHost(db, context, baseURL!);
  const clientId = await registerClient(baseURL!);
  const returned: string[] = [];
  // The redirect hop to the agent is not routable in Playwright, so the test
    // records the request the browser makes to the agent's callback.
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "agent.example.test") returned.push(request.url());
    });

  await startConsent(page, baseURL!, clientId);
  await page.getByRole("button", { name: "Deny" }).click();
  await expect.poll(() => returned.length).toBe(1);
  expect(new URL(returned[0]!).searchParams.get("error")).toBe("access_denied");
});

test("a requester allows one new request without an account, by keyboard at 390px", async ({ baseURL, db, page }) => {
  await page.setViewportSize({ height: 900, width: 390 });
  const hostAccountId = await newHostAccount(db);
  const { handle } = await makeHostReady(db, hostAccountId, { displayName: "Dodo Host" });
  const clientId = await registerClient(baseURL!);
  const returned: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "agent.example.test") returned.push(request.url());
  });

  await startConsent(page, baseURL!, clientId, `${baseURL}/${handle}/mcp`, "request:read request:write request:decide");
  await expect(page.getByRole("heading", { name: "Let Browser Test Agent request a meeting for you?" })).toBeVisible();
  await expect(page.getByText("Dodo Host", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("radio", { name: /Start a new request with Dodo Host/ })).toBeChecked();
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveCount(0);

  await page.getByRole("button", { name: "Allow" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => returned.length).toBe(1);
  expect(new URL(returned[0]!).searchParams.get("code")).toBeTruthy();

  const [grant] = await db<{ bootstrap: boolean; request_id: string | null }[]>`
    select bootstrap, request_id from app.agent_grants where host_account_id = ${hostAccountId} and role = 'requester'
  `;
  expect(grant).toEqual({ bootstrap: true, request_id: null });
});
