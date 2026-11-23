import { describe, expect, it } from "vitest";
import type { Queryable } from "./database";
import { findReadyHostByHandle } from "./readiness";

// Testing baseline H02 W-5.1 (module test map): a host who turned off
// Accept new meeting requests is treated like an unready one, so the booking
// link shows the same neutral not-found page as an unknown address.

type HostRow = {
  readonly handle: string;
  readonly hostAccountId: string;
  readonly ready: boolean;
  readonly accepting: boolean;
  readonly displayName?: string | null;
};

// A stand-in for the postgres tagged template that answers the three reads
// findReadyHostByHandle makes (the handle, readiness and the accepting flag) by
// their SQL text. Fragments (calendarUsable) resolve to nothing.
function fakeDatabase(host: HostRow | null): Queryable {
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("from app.host_handles where handle")) {
      return Promise.resolve(host && values[0] === host.handle ? [{ host_account_id: host.hostAccountId }] : []);
    }
    if (text.includes("accepting_requests from app.host_accounts")) {
      return Promise.resolve(host ? [{ accepting_requests: host.accepting }] : []);
    }
    if (text.includes("as ready")) {
      return Promise.resolve(host ? [{ display_name: host.displayName === undefined ? "Barbara Liskov" : host.displayName, handle: host.handle, ready: host.ready }] : []);
    }
    return Promise.resolve([]);
  };
  return query as unknown as Queryable;
}

const READY: HostRow = { accepting: true, handle: "barbara", hostAccountId: "host-1", ready: true };

describe("findReadyHostByHandle", () => {
  it("returns a ready host who accepts new requests", async () => {
    await expect(findReadyHostByHandle(fakeDatabase(READY), "barbara")).resolves.toEqual({
      displayName: "Barbara Liskov",
      handle: "barbara",
      hostAccountId: "host-1",
    });
  });

  it("treats a paused host like an unknown handle", async () => {
    const paused = fakeDatabase({ ...READY, accepting: false });

    await expect(findReadyHostByHandle(paused, "barbara")).resolves.toBeNull();
    await expect(findReadyHostByHandle(fakeDatabase(READY), "nobody")).resolves.toBeNull();
  });

  it("treats an unready host, or one without a display name, the same way", async () => {
    await expect(findReadyHostByHandle(fakeDatabase({ ...READY, ready: false }), "barbara")).resolves.toBeNull();
    await expect(findReadyHostByHandle(fakeDatabase({ ...READY, displayName: null }), "barbara")).resolves.toBeNull();
  });
});
