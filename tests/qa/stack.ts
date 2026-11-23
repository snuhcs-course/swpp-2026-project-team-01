// `npm run qa:stack`: the browser QA stack. It starts what the browser tests
// start (the web service, the agent service and local stand-ins for OpenAI,
// Google, Cloudflare Email, Google Routes and Photon), all against the LOCAL
// Supabase stack, plus the local job worker (`jobs:dev`) and a small control page
// for the hands-on pass. Nothing reads .env or .env.local, so no real provider is
// reached and no secret is loaded (except the opt-in --live-model key below).
//
// The control page is a test harness on its own port, like the cookies the
// browser tests put into their browser; it is not an application route. It signs
// test hosts in through the real local Auth flow with only Google's leg simulated
// (tests/integration/support/auth.ts), makes a host ready in SQL, records the
// draft the model would have written while the model is the stand-in, and lists
// the emails the stand-in received. Cookies on localhost are shared across
// ports, so a session set here is the web service's session.
//
//   npm run qa:stack                      # ports from 3200, the model stand-in
//   npm run qa:stack -- --base-port 3300  # another base port
//   npm run qa:stack -- --live-model      # the real model; spends money
//
// It prints one `QA_STACK {json}` line with every URL once the services are up,
// and writes the same JSON to output/browser-qa/stack.json (output/ is ignored by Git). Ctrl-C (SIGINT) or
// SIGTERM stops every service it started; the Supabase stack is left running.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { parseArgs } from "node:util";
import { assertLocalStack, type LocalStack, modelEnv, serviceEnv, type StandInPorts } from "../e2e/support/service-env";

const { values: args } = parseArgs({
  options: { "base-port": { type: "string" }, "live-model": { type: "boolean" } },
});

const stack = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" })) as LocalStack;
assertLocalStack(stack);

// Free on every loopback and wildcard address the browser's "localhost" may
// resolve to; an address this machine lacks (no IPv6) does not count as taken.
function freeOn(port: number, host: string) {
  return new Promise<boolean>((resolve) => {
    const server = createNetServer();
    server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT"));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function portFree(port: number) {
  for (const host of ["127.0.0.1", "::1", "0.0.0.0", "::"]) if (!(await freeOn(port, host))) return false;
  return true;
}

// Eight consecutive ports, the first block from the base port up whose ports are all free.
async function choosePorts(base: number) {
  for (let start = base; start < base + 400; start += 10) {
    const block = Array.from({ length: 8 }, (_, index) => start + index);
    const free = await Promise.all(block.map(portFree));
    if (free.every(Boolean)) return { block, moved: start !== base };
  }
  throw new Error(`No eight free ports from ${base}.`);
}

const requestedBase = Number(args["base-port"] ?? process.env.QA_BASE_PORT ?? "3200");
if (!Number.isInteger(requestedBase) || requestedBase < 1024 || requestedBase > 65_000) {
  console.error(`[qa] --base-port must be a whole number from 1024 to 65000, not ${args["base-port"] ?? process.env.QA_BASE_PORT}.`);
  process.exit(1);
}
const { block, moved } = await choosePorts(requestedBase);
const [web, eve, openai, google, cloudflare, routes, photon, control] = block.map(String) as [
  string, string, string, string, string, string, string, string,
];
const ports: StandInPorts = { cloudflare, google, openai, photon, routes };

// The support helpers read the stand-ins' ports from these when imported.
Object.assign(process.env, {
  FAKE_CLOUDFLARE_PORT: cloudflare,
  FAKE_GOOGLE_PORT: google,
  FAKE_OPENAI_PORT: openai,
  FAKE_PHOTON_PORT: photon,
  FAKE_ROUTES_PORT: routes,
});

// eve dev loads the root env files itself, and those may hold real provider
// keys, so the QA stack runs only in a checkout without them (a fresh worktree).
const envFiles = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"].filter(
  (file) => existsSync(file),
);
if (envFiles.length > 0) {
  console.error(`[qa] Refusing to start: ${envFiles.join(", ")} would reach real providers. Run the QA stack in a fresh worktree without env files.`);
  process.exit(1);
}

// The opt-in real model reads its key from this process's environment only.
function liveKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("--live-model needs OPENAI_API_KEY exported in the shell that starts the QA stack.");
  return key;
}

const live = Boolean(args["live-model"]);
// Read before anything starts, so a missing key stops nothing half-started.
const model = modelEnv(ports, live ? liveKey() : undefined);
const webOrigin = `http://localhost:${web}`;
const eveOrigin = `http://127.0.0.1:${eve}`;
const controlOrigin = `http://localhost:${control}`;
// WhatsApp hidden, as production has it (baseline H01 W-A3); the browser tests
// offer it to keep its screens covered.
const shared = { ...serviceEnv(stack, ports), WHATSAPP_OFFERED: "0" };
// Only what the services need from this process, never the caller's env files.
const base = {
  HOME: process.env.HOME ?? "",
  LANG: process.env.LANG ?? "en_US.UTF-8",
  NEXT_TELEMETRY_DISABLED: "1",
  PATH: process.env.PATH ?? "",
  TMPDIR: process.env.TMPDIR ?? "/tmp",
};

const children: { name: string; child: ChildProcess }[] = [];

function start(name: string, command: string, commandArgs: string[], env: Record<string, string>) {
  const child = spawn(command, commandArgs, { env: { ...base, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((line) => `[${name}] ${line}\n`)
      .join("");
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(prefix(chunk)));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(prefix(chunk)));
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[qa] ${name} exited (${code ?? signal}); stopping the QA stack.`);
      void stop(1);
    }
  });
  children.push({ child, name });
}

async function waitFor(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(url).then((response) => response.status < 500, () => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s.`);
}

let stopping = false;
const cleanups: (() => unknown)[] = [];
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) if (child.exitCode === null) child.kill("SIGTERM");
  for (const cleanup of cleanups) await Promise.resolve(cleanup()).catch(() => undefined);
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void stop(0));
// Any other way out (a failed startup step, an uncaught error) still stops the
// services, so they never keep holding the port block.
process.once("exit", () => {
  for (const { child } of children) if (child.exitCode === null) child.kill("SIGTERM");
});

// The stand-ins, then the agent and web services, then the job worker.
const fake = (file: string, env: Record<string, string>) => start(file.replace(/^fake-|-server$/g, ""), "npx", ["tsx", `tests/e2e/support/${file}.ts`], env);
fake("fake-google-server", { FAKE_GOOGLE_PORT: google });
fake("fake-cloudflare-server", { FAKE_CLOUDFLARE_PORT: cloudflare });
fake("fake-photon-server", { FAKE_PHOTON_PORT: photon });
fake("fake-routes-server", { FAKE_ROUTES_PORT: routes });
if (!live) fake("fake-openai-server", { FAKE_OPENAI_PORT: openai });
await Promise.all(
  [google, cloudflare, photon, routes, ...(live ? [] : [openai])].map((port) => waitFor(`http://127.0.0.1:${port}/health`, 60_000)),
);

start("eve", "npx", ["eve", "dev", "--no-ui", "--host", "127.0.0.1", "--port", eve], {
  ...shared,
  EVE_AGENT_URL: eveOrigin,
  EVE_TELEMETRY_DISABLED: "1",
  NODE_ENV: "production",
  ...model,
});
start("web", "npx", ["next", "dev", "apps/web", "--port", web], {
  ...shared,
  APP_ORIGIN: webOrigin,
  EVE_AGENT_URL: eveOrigin,
  NEXT_PUBLIC_E2E_TEST: "1",
});
start("jobs", "npx", ["tsx", "scripts/jobs-dev.ts"], { ...shared, APP_ORIGIN: webOrigin, ...model });

// The helpers read the ports set above at import time.
const { testDatabase, clearServiceWindow } = await import("../integration/support/database");
const { completeGoogleLeg, cookieHeader, createGoogleUser, localAuthConfig, startGoogleSignIn, UNBOUNDED_SIGN_UPS } = await import(
  "../integration/support/auth"
);
const { readyReviewHost } = await import("../e2e/support/host-review");
const { hashBookingId } = await import("../../lib/server/booking-links");
const { createGoogleCallbackHandler, createGoogleSignInHandler } = await import("../../lib/server/google-sign-in");
const { createGrantedScopesFetcher } = await import("../../lib/server/google-token-info");
const { parseTokenKey } = await import("../../lib/server/token-encryption");
const { E2E_TOKEN_ENCRYPTION_KEY } = await import("../e2e/support/token-key");

const db = testDatabase();
cleanups.push(() => db.end({ timeout: 2 }));
// As the browser tests' global setup does: repeated runs fill the service-wide
// model window and sign-up bound of the local stack.
await clearServiceWindow(db);
await db`delete from app.signup_attempts`;

type Host = { accountId: string; userId: string; email: string; name: string | null; handle: string | null };

// The QA test hosts, from the database, so a restarted QA stack still lists them.
function testHosts() {
  return db<Host[]>`
    select g.host_account_id as "accountId", g.auth_user_id as "userId", g.email,
           s.settings ->> 'displayName' as name, h.handle
    from app.google_identities g
    left join app.host_settings s on s.host_account_id = g.host_account_id
    left join app.host_handles h on h.host_account_id = g.host_account_id and h.released_at is null
    where g.email like 'qa-host-%@example.test'
    order by g.created_at
  `;
}

// The real local Auth flow for a new or an existing test user: only Google's leg
// is written to Auth's flow state, as signInHost does for the browser tests.
async function signIn(user?: { userId: string; email: string }) {
  const deps = {
    appOrigin: webOrigin,
    auth: localAuthConfig(),
    db,
    // Nothing listens on the discard port, so no Calendar grant is recorded here.
    fetchGrantedScopes: createGrantedScopesFetcher("http://127.0.0.1:9/tokeninfo"),
    signUpLimits: UNBOUNDED_SIGN_UPS,
    tokenKey: parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY),
  };
  const who = user ?? (await createGoogleUser(db, `qa-host-${randomUUID().slice(0, 8)}@example.test`));
  const flow = await startGoogleSignIn(createGoogleSignInHandler(() => deps), webOrigin);
  const code = await completeGoogleLeg(db, flow.codeChallenge, who.userId, { accessToken: `ya29.${randomUUID()}`, refreshToken: null });
  const response = await createGoogleCallbackHandler(() => deps)(
    new Request(`${webOrigin}/auth/callback?code=${code}`, { headers: { cookie: flow.cookie } }),
  );
  const location = response.headers.get("location");
  if (location !== `${webOrigin}/app`) throw new Error(`Test sign-in did not reach /app: ${location}`);
  const [account] = await db<{ host_account_id: string }[]>`
    select host_account_id from app.google_identities where auth_user_id = ${who.userId}
  `;
  return { accountId: account!.host_account_id, cookie: cookieHeader(flow.response, response), email: who.email, userId: who.userId };
}

function sessionCookies(cookie: string) {
  return cookie
    .split("; ")
    .filter(Boolean)
    .map((pair) => `${pair}; Path=/; HttpOnly; SameSite=Lax`);
}

// Expires every Supabase session cookie the browser sent.
function signOutCookies(request: IncomingMessage) {
  return (request.headers.cookie ?? "")
    .split("; ")
    .map((pair) => pair.slice(0, pair.indexOf("=")))
    .filter((name) => name.startsWith("sb-"))
    .map((name) => `${name}=; Path=/; Max-Age=0; SameSite=Lax`);
}

// The request a booking page shows: by the booking ID in its URL, or the newest.
async function findRequest(booking: string | null) {
  if (booking) {
    const id = booking.match(/[0-9a-f-]{36}/i)?.[0] ?? "";
    const [row] = await db<{ id: string; revision: number }[]>`
      select r.id, r.revision from app.requests r join app.booking_links b on b.request_id = r.id
      where b.link_hash = ${hashBookingId(id)}
    `;
    return row ?? null;
  }
  const [row] = await db<{ id: string; revision: number }[]>`select id, revision from app.requests order by created_at desc limit 1`;
  return row ?? null;
}

const INDEX_TITLE = "Find Me a Time QA control";
const escape = (value: string) => value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

function page(response: ServerResponse, title: string, body: string, status = 200) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title>` +
      `<style>body{font:15px/1.5 system-ui;margin:16px;max-width:720px}code{background:#eee;padding:0 4px}li{margin:6px 0}</style>` +
      `<h1>${escape(title)}</h1>${body}${title === INDEX_TITLE ? "" : '<p><a href="/">Back to the QA control page</a></p>'}`,
  );
}

async function index(response: ServerResponse) {
  const hosts = await testHosts();
  const hostList = hosts.length
    ? `<ul>${hosts
        .map(
          (host) =>
            `<li>${escape(host.name ?? "(no name yet)")} · <code>${escape(host.email)}</code>${host.handle ? ` · booking link <a href="${webOrigin}/${escape(host.handle)}">${webOrigin}/${escape(host.handle)}</a>` : " · setup incomplete"} · <a href="/sign-in/host?account=${host.accountId}">Sign in as this host</a></li>`,
        )
        .join("")}</ul>`
    : "<p>No test hosts yet.</p>";
  page(
    response,
    INDEX_TITLE,
    `<p>Web service <a href="${webOrigin}">${webOrigin}</a> · model ${live ? "<strong>real (spends money)</strong>" : "local stand-in"}. Local stack only; every account here is a test account.</p>
<h2>Sign in</h2>
<ul>
<li><a href="/sign-in/new-host">New host, setup not started</a> (H01: the /app link step, then setup)</li>
<li><a href="/sign-in/ready-host?name=Ada%20Lovelace">New host, set up and ready</a> (H02–H04, and the host side of G01–M01)</li>
<li><a href="/sign-out">Sign out</a> (clears the Supabase session cookies on localhost; use it before acting as a guest in the same browser)</li>
</ul>
<h2>QA test hosts on the local stack</h2>${hostList}
<h2>Guest helpers</h2>
<ul>
<li><code>/guest/draft?booking=&lt;booking page URL&gt;&amp;purpose=Talk%20about%20compilers&amp;mode=online</code> records the details draft the model would have written (stand-in model only), then reload the booking page. Without <code>booking</code> it uses the newest request.</li>
<li><a href="/emails">Emails the Cloudflare stand-in received</a> for one address (<code>/emails?to=address</code>), for booking links and notices.</li>
</ul>
<p>Jobs (evaluations, emails, bookings, cancellations) run by themselves through <code>jobs:dev</code> about every 5 seconds.</p>`,
  );
}

async function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", controlOrigin);

  if (url.pathname === "/") return await index(response);

  if (url.pathname === "/sign-in/new-host" || url.pathname === "/sign-in/ready-host") {
    const session = await signIn();
    const name = url.searchParams.get("name") || "Ada Lovelace";
    if (url.pathname === "/sign-in/ready-host") await readyReviewHost(db, session.accountId, name);
    response.writeHead(302, { location: `${webOrigin}/app`, "set-cookie": [...signOutCookies(request), ...sessionCookies(session.cookie)] });
    return response.end();
  }

  if (url.pathname === "/sign-in/host") {
    const host = (await testHosts()).find((entry) => entry.accountId === url.searchParams.get("account"));
    if (!host) return page(response, "Unknown host", "<p>No QA test host has that account.</p>", 404);
    const session = await signIn(host);
    response.writeHead(302, { location: `${webOrigin}/app`, "set-cookie": [...signOutCookies(request), ...sessionCookies(session.cookie)] });
    return response.end();
  }

  if (url.pathname === "/sign-out") {
    response.writeHead(302, { location: "/", "set-cookie": signOutCookies(request) });
    return response.end();
  }

  if (url.pathname === "/guest/draft") {
    if (live) return page(response, "Not with the real model", "<p>The real model writes its own drafts.</p>", 409);
    const found = await findRequest(url.searchParams.get("booking"));
    if (!found) return page(response, "No request", "<p>No request matches.</p>", 404);
    const patch = { mode: url.searchParams.get("mode") || "online", purpose: url.searchParams.get("purpose") || "Talk about compilers" };
    // As the assistant's draft tool does: a new draft replaces the pending one.
    await db`
      update app.request_reviews set state = 'superseded', resolved_at = now()
      where request_id = ${found.id} and state = 'pending'
    `;
    await db`
      insert into app.request_reviews (request_id, base_revision, intent, patch, clarifications)
      values (${found.id}, ${found.revision}, 'details', ${db.json(patch)}, ${[]})
    `;
    return page(response, "Draft recorded", `<p>Recorded a details draft (${escape(JSON.stringify(patch))}). Reload the booking page to see "Apply these details?".</p>`);
  }

  if (url.pathname === "/emails") {
    const to = url.searchParams.get("to")?.trim();
    const form = `<form action="/emails"><label>Recipient <input name="to" type="email" value="${escape(to ?? "")}" required></label> <button>Show emails</button></form>`;
    // The stand-in lists messages by recipient only.
    if (!to) return page(response, "Emails", `<p>Enter the guest's or host's address.</p>${form}`);
    const listed = await fetch(`http://127.0.0.1:${cloudflare}/__messages?to=${encodeURIComponent(to)}`);
    const messages = (await listed.json()) as { to?: unknown; subject: string; text: string }[];
    const items = messages
      .map((message) => `<li><strong>${escape(message.subject)}</strong>${message.to ? ` → ${escape(String(message.to))}` : ""}<pre style="white-space:pre-wrap">${escape(message.text)}</pre></li>`)
      .join("");
    return page(response, `Emails to ${to}`, `${form}${items ? `<ol>${items}</ol>` : "<p>No emails to this address yet.</p>"}`);
  }

  return page(response, "Not found", "<p>No such control action.</p>", 404);
}

const controlServer = createHttpServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    console.error("[qa] control action failed", error);
    if (!response.headersSent) page(response, "Control action failed", `<pre>${escape(String(error))}</pre>`, 500);
  });
});
cleanups.push(() => controlServer.close());
await new Promise<void>((resolve, reject) => {
  controlServer.once("error", reject);
  controlServer.listen(Number(control), "127.0.0.1", resolve);
});

await waitFor(`${eveOrigin}/eve/v1/health`, 180_000);
await waitFor(webOrigin, 120_000);

const summary = {
  control: controlOrigin,
  eve: eveOrigin,
  liveModel: live,
  movedFromBasePort: moved ? requestedBase : null,
  ports: { cloudflare, control, eve, google, openai, photon, routes, web },
  web: webOrigin,
};
mkdirSync("output/browser-qa", { recursive: true });
writeFileSync("output/browser-qa/stack.json", `${JSON.stringify(summary, null, 2)}\n`);
if (moved) console.log(`[qa] Ports from ${requestedBase} were taken; using ${block[0]}–${block[7]}.`);
console.log(`QA_STACK ${JSON.stringify(summary)}`);
