import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "./commands";
import type { Transaction } from "./database";
import { hashLinkCode } from "./email-links";

// Linking on the code's arrival (link-on-code design 1 and 5): a valid code binds
// a host's or guest's sender at once and queues the linked message; a start's
// code waits for sign-in; anything else voids the attempt and is refused. The
// receipt job's transaction is faked here: each query is answered by what it
// reads, and the modules that own other tables are mocked. The integration
// tests cover the same paths against the database.

const mocks = vi.hoisted(() => ({
  bindRequester: vi.fn(async () => "guest-binding"),
  lockActiveHost: vi.fn(async () => undefined),
  lockOpenRequest: vi.fn(async () => ({})),
  recordOutbound: vi.fn(async () => ({ created: true, id: "outbox" })),
}));

vi.mock("./imessage-outbox", () => ({ recordOutbound: mocks.recordOutbound }));
vi.mock("./requester-imessage-bindings", () => ({ bindRequester: mocks.bindRequester }));
vi.mock("./request-guard", () => ({ lockOpenRequest: mocks.lockOpenRequest }));
vi.mock("./readiness", () => ({ calendarUsable: () => "true", readReadiness: async () => ({ ready: true }) }));
vi.mock("./analysis", () => ({ lockActiveHost: mocks.lockActiveHost, queueHoursQuestion: vi.fn(), readLatestAnalysis: async () => null }));

const { bindReceivedAttempt, LINK_TEXTS, receiveLinkCode, senderContext } = await import("./imessage-links");
const { sealToken } = await import("./token-encryption");

const tokenKey = { id: "k1", key: Buffer.alloc(32, 7) };
const options = { origin: "https://findmeatime.test", tokenKey, tokenKeys: [tokenKey] };
const CODE = "FMAT-7KQ2M9XD3A";

type Link = {
  id: string;
  channel: "imessage" | "whatsapp" | "telegram";
  host_account_id: string | null;
  request_id: string | null;
  starter_hash: string | null;
  state: string;
  live: boolean;
  received_by_receipt_id: string | null;
  sender_hash: string | null;
};

function attempt(overrides: Partial<Link> = {}): Link {
  return {
    channel: "imessage",
    host_account_id: "host-1",
    id: "11111111-1111-4111-8111-111111111111",
    live: true,
    received_by_receipt_id: null,
    request_id: null,
    sender_hash: null,
    starter_hash: null,
    state: "pending",
    ...overrides,
  };
}

function arrival(overrides: Record<string, unknown> = {}) {
  return {
    channel: "imessage" as const,
    code: CODE,
    receiptId: "receipt-1",
    sender: "+15551234567",
    senderHash: "a".repeat(64),
    spaceId: "space-1",
    spaceType: "dm" as const,
    ...overrides,
  };
}

// A transaction whose queries are logged and answered from the attempt and the
// sender's binding (another host's, when given).
function fakeTx(link: Link | null, senderOwner: string | null = null) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ sql, values });
    if (sql.startsWith("select host_account_id, request_id, starter_hash from app.imessage_links where code_hash")) {
      return Promise.resolve(link && values[0] === hashLinkCode(CODE) ? [link] : []);
    }
    if (sql.startsWith("select id, channel, host_account_id, request_id, starter_hash, state")) return Promise.resolve(link ? [link] : []);
    if (sql.includes("from app.imessage_bindings where sender_hash")) {
      return Promise.resolve(senderOwner ? [{ host_account_id: senderOwner, id: "other-binding" }] : []);
    }
    if (sql.startsWith("select gen_random_uuid() as id")) return Promise.resolve([{ id: "22222222-2222-4222-8222-222222222222" }]);
    if (sql.startsWith("update app.imessage_bindings")) return Promise.resolve([]);
    if (sql.includes("bool_or(recipient_hash")) return Promise.resolve([{ line: 0, sender: false }]);
    return Promise.resolve([]);
  }) as unknown as Transaction;
  const ran = (fragment: string) => queries.some((query) => query.sql.includes(fragment));
  return { queries, ran, tx };
}

const kinds = () => mocks.recordOutbound.mock.calls.map((call) => (call as unknown as [unknown, { kind: string }])[1].kind);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lockActiveHost.mockImplementation(async () => undefined);
  mocks.lockOpenRequest.mockImplementation(async () => ({}));
});

describe("a host's code", () => {
  it("binds the sender as soon as it arrives and queues the linked message, with no confirmation reply", async () => {
    const { ran, tx } = fakeTx(attempt());
    await expect(receiveLinkCode(tx, options, arrival())).resolves.toBe("link_received");

    expect(mocks.lockActiveHost).toHaveBeenCalledWith(tx, "host-1");
    expect(ran("insert into app.imessage_bindings")).toBe(true);
    expect(ran("set state = 'linked', binding_id")).toBe(true);
    expect(ran("set state = 'received'")).toBe(false);
    expect(kinds()).toEqual(["linked", "contact_card"]);
    const linked = mocks.recordOutbound.mock.calls[0] as unknown as [unknown, { text: string }];
    expect(linked[1].text).toBe(LINK_TEXTS.linked);
    expect(linked[1].text).not.toMatch(/Confirm and link/);
  });

  it("links Telegram on Start, with the linked welcome as the bot's first message", async () => {
    const { ran, tx } = fakeTx(attempt({ channel: "telegram" }));
    await receiveLinkCode(tx, options, arrival({ channel: "telegram", senderName: "Dohyeon (@dohyeon)" }));
    expect(ran("insert into app.imessage_bindings")).toBe(true);
    expect(kinds()).toEqual(["linked"]);
  });

  it("changes nothing when the same sender sends the used code again", async () => {
    const { ran, tx } = fakeTx(attempt({ received_by_receipt_id: "receipt-0", sender_hash: "a".repeat(64), state: "linked" }));
    await expect(receiveLinkCode(tx, options, arrival())).resolves.toBe("link_received");
    expect(ran("insert into app.imessage_bindings")).toBe(false);
    expect(mocks.recordOutbound).not.toHaveBeenCalled();
  });

  it("refuses a used code from another sender: single use", async () => {
    const { ran, tx } = fakeTx(attempt({ received_by_receipt_id: "receipt-0", sender_hash: "b".repeat(64), state: "linked" }));
    await expect(receiveLinkCode(tx, options, arrival())).resolves.toBe("link_refused");
    expect(ran("insert into app.imessage_bindings")).toBe(false);
    expect(kinds()).toEqual(["link_refused"]);
  });

  it.each([
    ["an expired code", attempt({ live: false }), arrival(), null],
    ["a code from another channel", attempt({ channel: "whatsapp" }), arrival(), null],
    ["a sender another host holds", attempt(), arrival(), "host-2"],
  ])("voids the attempt for %s", async (_name, link, message, owner) => {
    const { ran, tx } = fakeTx(link, owner);
    await expect(receiveLinkCode(tx, options, message)).resolves.toBe("link_refused");
    expect(ran("insert into app.imessage_bindings")).toBe(false);
    expect(ran("set state = 'voided'")).toBe(true);
    expect(kinds()).toEqual(["link_refused"]);
  });

  it("voids a code from a group and replies nothing into the group", async () => {
    const { ran, tx } = fakeTx(attempt());
    await expect(receiveLinkCode(tx, options, arrival({ spaceType: "group" }))).resolves.toBe("link_refused");
    expect(ran("set state = 'voided'")).toBe(true);
    expect(mocks.recordOutbound).not.toHaveBeenCalled();
  });

  it("refuses a code whose host is no longer active", async () => {
    mocks.lockActiveHost.mockImplementation(async () => {
      throw new CommandError("forbidden");
    });
    const { ran, tx } = fakeTx(attempt());
    await expect(receiveLinkCode(tx, options, arrival())).resolves.toBe("link_refused");
    expect(ran("insert into app.imessage_bindings")).toBe(false);
  });
});

describe("a guest's code", () => {
  const guest = () => attempt({ host_account_id: null, request_id: "request-1" });

  it("binds the sender to the request on arrival and ends the attempt", async () => {
    const { ran, tx } = fakeTx(guest());
    await expect(receiveLinkCode(tx, options, arrival({ channel: "imessage" }))).resolves.toBe("link_received");
    expect(mocks.lockOpenRequest).toHaveBeenCalledWith(tx, "request-1");
    expect(mocks.bindRequester).toHaveBeenCalledWith(tx, tokenKey, expect.objectContaining({ requestId: "request-1", sender: "+15551234567" }));
    expect(ran("set state = 'linked', binding_id")).toBe(true);
    // The welcome is bindRequester's; no "go back to your booking page" reply.
    expect(mocks.recordOutbound).not.toHaveBeenCalled();
  });

  it("links a guest's Telegram on Start with the sender's name", async () => {
    const { tx } = fakeTx({ ...guest(), channel: "telegram" });
    await receiveLinkCode(tx, options, arrival({ channel: "telegram", senderName: "Eunwoo" }));
    expect(mocks.bindRequester).toHaveBeenCalledWith(tx, tokenKey, expect.objectContaining({ channel: "telegram", senderName: "Eunwoo" }));
  });

  it("refuses a code that arrives after the request closed", async () => {
    mocks.lockOpenRequest.mockImplementation(async () => {
      throw new CommandError("request_closed");
    });
    const { tx } = fakeTx(guest());
    await expect(receiveLinkCode(tx, options, arrival())).resolves.toBe("link_refused");
    expect(mocks.bindRequester).not.toHaveBeenCalled();
  });
});

describe("a code from the iMessage start", () => {
  it("records the sender for the browser's sign-in and replies with the sign-in link", async () => {
    const { ran, tx } = fakeTx(attempt({ host_account_id: null, starter_hash: "c".repeat(64) }));
    await expect(receiveLinkCode(tx, options, arrival())).resolves.toBe("link_received");
    expect(ran("set state = 'received'")).toBe(true);
    expect(ran("insert into app.imessage_bindings")).toBe(false);
    const reply = mocks.recordOutbound.mock.calls[0] as unknown as [unknown, { kind: string; text: string }];
    expect(reply[1].kind).toBe("link_received");
    expect(reply[1].text).toContain("https://findmeatime.test/imessage/continue?token=");
    expect(reply[1].text).not.toMatch(/Confirm and link/);
  });
});

describe("a start's code claimed by sign-in", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  function received(owner: string | null) {
    const sealed = sealToken(tokenKey, "+15551234567", senderContext(id));
    const row = {
      channel: "imessage",
      id,
      sender_ciphertext: sealed.ciphertext,
      sender_hash: "a".repeat(64),
      sender_key_id: tokenKey.id,
      sender_name_ciphertext: null,
      space_ciphertext: null,
    };
    const fake = fakeTx(null, owner);
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?").replace(/\s+/g, " ").trim();
      if (sql.startsWith("select id, channel, sender_hash, sender_ciphertext")) {
        fake.queries.push({ sql, values });
        return Promise.resolve([row]);
      }
      return (fake.tx as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
    }) as unknown as Transaction;
    return { ...fake, tx };
  }

  it("binds the recorded sender to the host who signed in", async () => {
    const { ran, tx } = received(null);
    await expect(bindReceivedAttempt(tx, options, "host-1", id)).resolves.toBe("22222222-2222-4222-8222-222222222222");
    expect(ran("insert into app.imessage_bindings")).toBe(true);
    expect(kinds()).toEqual(["linked", "contact_card"]);
  });

  it("voids the attempt when another host linked the sender meanwhile", async () => {
    const { ran, tx } = received("host-2");
    await expect(bindReceivedAttempt(tx, options, "host-1", id)).resolves.toBe("voided");
    expect(ran("insert into app.imessage_bindings")).toBe(false);
    expect(ran("set state = 'voided'")).toBe(true);
  });
});
