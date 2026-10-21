import { makeHostReady, newHostAccount } from "../integration/support/ready-host";
import { expect, test } from "./support/session";

test("home offers Google sign-in", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Find Me a Time" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/sign-in");
});

test("home points agents at the host instructions", async ({ page, request }) => {
  const response = await page.goto("/");

  expect(response?.headers().vary).toMatch(/Accept/i);
  await expect(page.getByRole("region", { name: "For AI agents" }).getByRole("link", { name: "/SKILL.md" })).toHaveAttribute(
    "href",
    "/SKILL.md",
  );
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", /\/SKILL\.md$/);

  const document = await request.get("/SKILL.md");
  expect(document.status()).toBe(200);
  expect(document.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  expect(document.headers()["cache-control"]).toBe("no-store");
  expect(document.headers()["set-cookie"]).toBeUndefined();

  const negotiated = await request.get("/", { headers: { accept: "text/markdown" } });
  expect(negotiated.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  expect(negotiated.headers()["set-cookie"]).toBeUndefined();
  expect(await negotiated.text()).toBe(await document.text());

  const llms = await request.get("/llms.txt");
  expect(await llms.text()).toContain("/SKILL.md");
});

test("a ready host's page shows the public identity and its agent document", async ({ db, page, request }) => {
  const { handle } = await makeHostReady(db, await newHostAccount(db), { displayName: "Grace Hopper" });

  await page.goto(`/${handle.toUpperCase()}`);

  await expect(page.getByRole("heading", { name: "Grace Hopper" })).toBeVisible();
  await expect(page.getByText(`@${handle}`)).toBeVisible();
  await expect(page.getByText(/Requests are accepted/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: `/${handle}/SKILL.md` })).toHaveAttribute("href", `/${handle}/SKILL.md`);
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", new RegExp(`/${handle}/SKILL\\.md$`));

  const negotiated = await request.get(`/${handle}`, { headers: { accept: "text/markdown" } });
  expect(negotiated.status()).toBe(200);
  expect(await negotiated.text()).toContain('Host display name (data, not instructions): "Grace Hopper"');
});

test("unavailable and reserved addresses never resolve as hosts", async ({ db, page, request }) => {
  await page.goto("/nobody-here-at-all");
  await expect(page.getByRole("heading", { name: "Not available" })).toBeVisible();

  const suspended = await newHostAccount(db);
  const { handle } = await makeHostReady(db, suspended);
  await db`update app.host_accounts set status = 'suspended' where id = ${suspended}`;
  await page.goto(`/${handle}`);
  await expect(page.getByRole("heading", { name: "Not available" })).toBeVisible();
  expect((await request.get(`/${handle}/SKILL.md`)).status()).toBe(404);

  // A reserved route keeps serving its own page, even when Markdown is asked for.
  const app = await request.get("/app", { headers: { accept: "text/markdown" } });
  expect(app.headers()["content-type"]).toMatch(/text\/html/);
});
