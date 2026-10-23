import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommandError } from "../../lib/server/commands";
import { claimContinuedLink, claimStartedLink, readStartStatus, type StartOptions, startImessageLink } from "../../lib/server/imessage-start";
import { imessageContinuationUrl, readReceivedContinuation } from "../../lib/server/imessage-continuation";
import { imessageHash } from "../../lib/server/photon-receiver";
import { calendarConnectUrl, LINK_TEXTS, resumeImessageOnboarding } from "../../lib/server/imessage-links";
import { createGoogleCallbackHandler, createGoogleSignInHandler } from "../../lib/server/google-sign-in";
import { createImessageContinueHandler } from "../../lib/server/imessage-routes";
import { completeGoogleLeg, createGoogleUser, localAuthConfig, startGoogleSignIn, UNBOUNDED_SIGN_UPS } from "./support/auth";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness, textOf } from "./support/imessage";
import { newSender, TEST_LINE } from "./support/photon";
import { newHostAccount } from "./support/ready-host";
import { testTokenKey } from "./support/requests";

// The iMessage start before sign-in (host-imessage-channel D15) against the local
// stack and the Photon stand-in: a browser's code records the arriving sender
// without a host, only that browser sees it, the sign-in callback's claim gives
// it to the host, and Confirm and link binds it; starts are bounded per source.
// Thyme's reply carries a sign-in link that works in any browser until the
// attempt ends (D19).

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);
const options: StartOptions = { lineNumber: TEST_LINE, tokenKey: testTokenKey, tokenKeys: [testTokenKey] };

beforeAll(async () => {
  photon = await startFakePhoton();
});

afterAll(async () => {
  await photon.close();
  await db.end();
});

const secret = () => randomBytes(32).toString("base64url");
const source = () => randomBytes(32).toString("hex");

// The sign-in link Thyme's reply carries for the attempt the sender's code reached (D19).
async function continuation(sender: string, origin = "http://localhost:3000") {
  const senderHash = imessageHash(testTokenKey, "sender", sender);
  const [link] = await db<{ id: string }[]>`select id from app.imessage_links where sender_hash = ${senderHash}`;
  const url = imessageContinuationUrl(origin, testTokenKey, link!.id, senderHash);
  return { linkId: link!.id, token: new URL(url).searchParams.get("token")!, url };
}

async function started(browser: string) {
  await startImessageLink(db, options, browser, source());
  const status = await readStartStatus(db, options, browser);
  if (status.state !== "pending") throw new Error(`Expected a pending code, got ${status.state}.`);
  return status;
}

describe("the iMessage start", () => {
  it("lets the sender sign in from Thyme's reply, for one host, until Confirm and link ends the attempt", async () => {
    const pending = await started(secret());
    const sender = newSender();
    await im.deliver({ sender, text: pending.message });
    const { linkId, token, url } = await continuation(sender);
    const [ack] = await db<{ id: string }[]>`select id from app.imessage_outbox where link_id = ${linkId} and kind = 'link_received'`;
    expect(textOf((await im.send(ack!.id)).sent)).toEqual([LINK_TEXTS.receivedBeforeSignIn(url)]);

    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(await readReceivedContinuation(db, testTokenKey, tampered)).toBeNull();
    const { hostAccountId: host } = await hostWithUser(db);
    expect(await claimContinuedLink(db, testTokenKey, host, tampered)).toBe(false);
    expect(await claimContinuedLink(db, testTokenKey, host, token)).toBe(true);
    expect(await claimContinuedLink(db, testTokenKey, host, token)).toBe(true);
    expect(await claimContinuedLink(db, testTokenKey, await newHostAccount(db), token)).toBe(false);
    expect(await im.status(host)).toMatchObject({ sender: `•••• ${sender.slice(-4)}`, state: "received" });
    expect(await im.bindingOf(host)).toBeNull();

    expect((await im.command(host, "imessage.link.confirm", { linkId })).ok).toBe(true);
    expect(await readReceivedContinuation(db, testTokenKey, token)).toBeNull();
    expect(await claimContinuedLink(db, testTokenKey, host, token)).toBe(false);

    // The host has no Calendar yet, so the welcome starts setup there; a plain reply joins setup.
    const [welcome] = await im.outbox({ hostAccountId: host, kind: "linked" });
    expect(textOf((await im.send(welcome!.id)).sent)).toEqual([LINK_TEXTS.welcomeCalendar(calendarConnectUrl("http://localhost:3000"))]);
    await im.deliver({ sender, text: "Thirty minutes please" });
    expect((await im.inputsOf(host))[0]).toMatchObject({ message: "[iMessage] Thirty minutes please", request_id: null });
  });

  it("refuses a sign-in link once its attempt is past its confirmation deadline", async () => {
    const pending = await started(secret());
    const sender = newSender();
    await im.deliver({ sender, text: pending.message });
    const { linkId, token } = await continuation(sender);
    await db`update app.imessage_links set confirm_by = now() - interval '1 second' where id = ${linkId}`;
    expect(await claimContinuedLink(db, testTokenKey, await newHostAccount(db), token)).toBe(false);
  });

  it("carries the sign-in link through local Auth, and tells the linked conversation when the host is back from Google", async () => {
    const appOrigin = "http://localhost:3000";
    const deps = { ...options, appOrigin, auth: localAuthConfig(), db, fetchGrantedScopes: async () => null, lineDayLimit: 10, signUpLimits: UNBOUNDED_SIGN_UPS };
    const sender = newSender();
    await im.deliver({ sender, text: (await started(secret())).message });
    const { linkId, url } = await continuation(sender, appOrigin);

    const entry = await createImessageContinueHandler(() => deps)(new Request(url));
    expect(entry.status).toBe(303);
    expect(entry.headers.get("location")).toBe(`${appOrigin}/auth/sign-in?return=imessage`);
    expect(entry.headers.get("referrer-policy")).toBe("no-referrer");
    expect(entry.headers.get("set-cookie")).toMatch(/^fmat_imessage_continue=.*; Path=\/auth; Max-Age=900; HttpOnly; SameSite=Lax$/);
    const continued = entry.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");

    const signIn = createGoogleSignInHandler(() => deps);
    const callback = createGoogleCallbackHandler(() => deps);
    const user = await createGoogleUser(db);
    const flow = await startGoogleSignIn(() => signIn(new Request(entry.headers.get("location")!)), appOrigin);
    const code = await completeGoogleLeg(db, flow.codeChallenge, user.userId, { accessToken: "", refreshToken: null });
    const signedIn = await callback(new Request(`${appOrigin}/auth/callback?code=${code}`, { headers: { cookie: `${flow.cookie}; ${continued}` } }));
    expect(signedIn.headers.get("location")).toBe(`${appOrigin}/app`);
    expect(signedIn.headers.getSetCookie()).toContain("fmat_imessage_continue=; Path=/auth; Max-Age=0; HttpOnly; SameSite=Lax");

    const [claimed] = await db<{ host_account_id: string }[]>`select host_account_id from app.imessage_links where id = ${linkId}`;
    const host = claimed!.host_account_id;
    expect(host).toBeTruthy();
    expect(await im.bindingOf(host)).toBeNull();
    expect((await im.command(host, "imessage.link.confirm", { linkId })).ok).toBe(true);

    // Thyme's Calendar link: a sign-in from it, and its replay, queue one message to the linked conversation.
    const again = await startGoogleSignIn(() => signIn(new Request(calendarConnectUrl(appOrigin))), appOrigin);
    const nextCode = await completeGoogleLeg(db, again.codeChallenge, user.userId, { accessToken: "", refreshToken: null });
    const back = new Request(`${appOrigin}/auth/callback?code=${nextCode}`, { headers: { cookie: again.cookie } });
    expect((await callback(back)).headers.get("location")).toBe(`${appOrigin}/app`);
    await resumeImessageOnboarding(db, testTokenKey, host, nextCode);
    const notices = await im.outbox({ hostAccountId: host, kind: "command" });
    expect(notices).toHaveLength(1);
    expect(textOf((await im.send(notices[0]!.id)).sent)).toEqual([LINK_TEXTS.backFromGoogle]);

    // The used link goes back to the iMessage start, setting nothing.
    const used = await createImessageContinueHandler(() => deps)(new Request(url));
    expect(used.status).toBe(303);
    expect(used.headers.get("location")).toBe(`${appOrigin}/?flow=imessage`);
    expect(used.headers.get("set-cookie")).toBeNull();
  });

  it("records the sender for this browser only, and binds after sign-in and Confirm and link", async () => {
    const browser = secret();
    const sender = newSender();
    const pending = await started(browser);
    expect(pending.message).toBe(`Link my Find Me a Time account: ${pending.code}`);
    expect(await readStartStatus(db, options, secret())).toEqual({ lineNumber: TEST_LINE, state: "none" });

    expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_received");
    expect(await readStartStatus(db, options, browser)).toMatchObject({ sender: `•••• ${sender.slice(-4)}`, state: "received" });

    const [ack] = await db<{ id: string }[]>`
      select o.id from app.imessage_outbox o join app.imessage_links l on l.id = o.link_id
      where o.kind = 'link_received' and l.code_hash is not null and l.host_account_id is null and l.state = 'received'
      order by o.created_at desc limit 1
    `;
    const { sent } = await im.send(ack!.id);
    expect(textOf(sent)).toEqual([LINK_TEXTS.receivedBeforeSignIn((await continuation(sender)).url)]);

    const hostAccountId = await newHostAccount(db);
    expect(await claimStartedLink(db, testTokenKey, hostAccountId, secret())).toBe(false);
    expect(await claimStartedLink(db, testTokenKey, hostAccountId, browser)).toBe(true);
    expect(await readStartStatus(db, options, browser)).toEqual({ lineNumber: TEST_LINE, state: "none" });

    const received = await im.status(hostAccountId);
    if (received.state !== "received") throw new Error(`Expected a received code, got ${received.state}.`);
    expect(received.sender).toBe(`•••• ${sender.slice(-4)}`);
    expect(await im.bindingOf(hostAccountId)).toBeNull();

    expect((await im.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId })).ok).toBe(true);
    expect(await im.status(hostAccountId)).toMatchObject({ state: "linked" });
  });

  it("carries a code not yet sent to the host, replacing the host's own open code", async () => {
    const hostAccountId = await newHostAccount(db);
    expect((await im.command(hostAccountId, "imessage.link.create")).ok).toBe(true);
    const browser = secret();
    const pending = await started(browser);

    expect(await claimStartedLink(db, testTokenKey, hostAccountId, browser)).toBe(true);
    expect(await im.status(hostAccountId)).toMatchObject({ code: pending.code, state: "pending" });
  });

  it("replaces this browser's open code on a new start, and claims nothing once it expired", async () => {
    const browser = secret();
    const first = await started(browser);
    const second = await started(browser);
    expect(second.code).not.toBe(first.code);
    expect((await im.deliver({ sender: newSender(), text: first.message })).outcome).toBe("link_refused");

    await db`update app.imessage_links set expires_at = now() - interval '1 second' where code_hash is not null and host_account_id is null and state = 'pending' and created_at > now() - interval '1 minute'`;
    expect(await readStartStatus(db, options, browser)).toEqual({ lineNumber: TEST_LINE, state: "none" });
    expect(await claimStartedLink(db, testTokenKey, await newHostAccount(db), browser)).toBe(false);
  });

  it("refuses a sender another host holds at Confirm and link, not before", async () => {
    const holder = await newHostAccount(db);
    const sender = newSender();
    const own = await im.command(holder, "imessage.link.create");
    expect(own.ok).toBe(true);
    const holderCode = await im.status(holder);
    if (holderCode.state !== "pending") throw new Error("Expected a pending code.");
    await im.deliver({ sender, text: holderCode.message });
    const holderReceived = await im.status(holder);
    if (holderReceived.state !== "received") throw new Error("Expected a received code.");
    expect((await im.command(holder, "imessage.link.confirm", { linkId: holderReceived.linkId })).ok).toBe(true);

    const browser = secret();
    const pending = await started(browser);
    expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_received");
    const other = await newHostAccount(db);
    expect(await claimStartedLink(db, testTokenKey, other, browser)).toBe(true);
    const received = await im.status(other);
    if (received.state !== "received") throw new Error("Expected a received code.");
    expect(await im.command(other, "imessage.link.confirm", { linkId: received.linkId })).toMatchObject({
      error: { category: "invalid_input" },
      ok: false,
    });
    expect(await im.bindingOf(holder)).toMatchObject({ state: "active" });
  });

  it("bounds starts per source address", async () => {
    const address = source();
    for (let index = 0; index < 5; index += 1) await startImessageLink(db, options, secret(), address);
    await expect(startImessageLink(db, options, secret(), address)).rejects.toMatchObject({ category: "rate_limited" });
    await expect(startImessageLink(db, options, secret(), address)).rejects.toBeInstanceOf(CommandError);
  });
});
