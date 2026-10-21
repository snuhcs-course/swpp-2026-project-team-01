import type { Transaction } from "./database";

// Conversation admission (design decision 14; chat-workspaces: bounded
// conversation admission). Every new conversation input is charged, in the
// transaction that records it, against fixed windows: 20 a minute and 100 an
// hour for its host account, request or intake, and 200 a minute and 2,000 an
// hour service-wide. A window starts at the first accepted input after the
// previous one expired. Rows are locked in a fixed order (the input's scope,
// minute then hour, then the service, minute then hour), and the clock is read
// after the last lock, so an input that waited for a lock sees the current
// time. Any exhausted window rejects the whole input and nothing is charged.
// An exact retry of an accepted input is answered before admission, so it is
// never charged again.

export const ADMISSION_LIMITS = {
  scopeMinute: 20,
  scopeHour: 100,
  serviceMinute: 200,
  serviceHour: 2000,
} as const;

export type AdmissionLimits = { readonly [Key in keyof typeof ADMISSION_LIMITS]: number };

export type AdmissionScope = {
  readonly scope: "host" | "request" | "intake";
  // The host account, request or intake ID.
  readonly key: string;
};

export type AdmissionOptions = {
  readonly limits?: Partial<AdmissionLimits>;
  // The service window's key; tests give each suite its own.
  readonly serviceKey?: string;
};

const WINDOW_SECONDS = { hour: 3600, minute: 60 } as const;

export class AdmissionLimitError extends Error {
  // Seconds until the exhausted window ends.
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Conversation admission is temporarily limited.");
    this.name = "AdmissionLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const ADMISSION_LIMITED_MESSAGE = "You're sending messages faster than we can take them. Wait a moment and send it again.";

type Window = {
  readonly scope: AdmissionScope["scope"] | "service";
  readonly key: string;
  readonly kind: keyof typeof WINDOW_SECONDS;
  readonly limit: number;
};

// Charges one input against every window of its scope and the service, or
// throws AdmissionLimitError having charged nothing.
export async function admitConversationInput(tx: Transaction, scope: AdmissionScope, options: AdmissionOptions = {}) {
  const limits = { ...ADMISSION_LIMITS, ...options.limits };
  const service = options.serviceKey ?? "service";
  const windows: Window[] = [
    { key: scope.key, kind: "minute", limit: limits.scopeMinute, scope: scope.scope },
    { key: scope.key, kind: "hour", limit: limits.scopeHour, scope: scope.scope },
    { key: service, kind: "minute", limit: limits.serviceMinute, scope: "service" },
    { key: service, kind: "hour", limit: limits.serviceHour, scope: "service" },
  ];
  const rows: { count: number; window_start: Date }[] = [];

  for (const window of windows) {
    await tx`
      insert into app.admission_windows (scope, scope_key, window_kind, window_start, count)
      values (${window.scope}, ${window.key}, ${window.kind}, clock_timestamp(), 0)
      on conflict (scope, scope_key, window_kind) do nothing
    `;
    const [row] = await tx<{ count: number; window_start: Date }[]>`
      select window_start, count from app.admission_windows
      where scope = ${window.scope} and scope_key = ${window.key} and window_kind = ${window.kind}
      for update
    `;
    rows.push(row!);
  }

  const [clock] = await tx<{ now: Date }[]>`select clock_timestamp() as now`;
  const now = clock!.now.getTime();
  const current = windows.map((window, index) => {
    const row = rows[index]!;
    const ends = row.window_start.getTime() + WINDOW_SECONDS[window.kind] * 1000;
    return { ...window, count: now >= ends ? 0 : row.count, ends, expired: now >= ends };
  });
  const exhausted = current.filter((window) => window.count >= window.limit);

  if (exhausted.length > 0) {
    const ends = Math.max(...exhausted.map((window) => window.ends));
    throw new AdmissionLimitError(Math.max(1, Math.ceil((ends - now) / 1000)));
  }

  for (const window of current) {
    await tx`
      update app.admission_windows
      set count = ${window.count + 1},
          window_start = case when ${window.expired} then ${clock!.now} else window_start end
      where scope = ${window.scope} and scope_key = ${window.key} and window_kind = ${window.kind}
    `;
  }
}
