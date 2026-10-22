import { createHash } from "node:crypto";
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { database, type Database } from "./database";

// The model limit middleware (design decision 6). Wrapping the agent's model with
// limitModel puts every provider request through it, including eve's retries and
// compaction calls, because they all use the same model. Per attempt, in order:
//   1. reject serialized input over 128 KiB, attachments and provider-executed
//      tools;
//   2. attribute the call: a conversation call by its prompt cache key (the
//      base64url SHA-256 of the eve session ID) in the session index, a ranking
//      call by the work item its caller passes;
//   3. reserve USD 0.60 durably against the work item, the principal and the
//      service (and, for an anonymous principal, the anonymous allowance), after
//      taking their locks and rechecking authority. A request is anonymous,
//      drafts included, until its contact is confirmed or it holds a live
//      Google identity grant: until then it gets the anonymous cap (USD 3 per
//      24 hours), and its spend counts toward the anonymous allowance;
//   4. call the provider with output clamped (4,096 tokens, 2,048 for ranking),
//      storage off and the standard tier, under a 30-second idle deadline for a
//      stream or a 120-second total deadline for a non-streamed call.
// A denial throws ModelLimitError before any provider request. A reservation is
// never released, so a failed or uncertain attempt stays charged.

export const MODEL_LIMITS = {
  attemptReservationUsd: "0.60",
  conversationAttempts: 8,
  conversationOutputTokens: 4096,
  // A non-streamed call has no chunks to be idle between, so it gets one total
  // deadline instead, long enough for a full reasoning response.
  generateTimeoutMs: 120_000,
  idleTimeoutMs: 30_000,
  maxInputBytes: 128 * 1024,
  principalWindowUsd: "30.00",
  // An anonymous principal's own allowance (a request, drafts included, whose
  // contact is unconfirmed and that holds no live Google identity), and every
  // anonymous principal's together (design decision 2), inside the service
  // window. Spend of intakes from before D13 still counts toward the latter.
  anonymousPrincipalWindowUsd: "3.00",
  anonymousWindowUsd: "50.00",
  rankingAttempts: 2,
  rankingOutputTokens: 2048,
  serviceWindowUsd: "300.00",
} as const;

export type ModelLimits = {
  readonly [Key in keyof typeof MODEL_LIMITS]: (typeof MODEL_LIMITS)[Key] extends string ? string : number;
};

export type ModelLimitCode =
  | "anonymous_allowance"
  | "attachment"
  | "attempts_exhausted"
  | "authority_expired"
  | "deadline"
  | "input_too_large"
  | "principal_allowance"
  | "provider_tool"
  | "service_allowance"
  | "unattributed";

export class ModelLimitError extends Error {
  readonly code: ModelLimitCode;

  constructor(code: ModelLimitCode) {
    super(`Model call denied: ${code}.`);
    this.name = "ModelLimitError";
    this.code = code;
  }
}

export type Principal = {
  readonly type: "host_account" | "requester_request" | "public_intake";
  readonly id: string;
};

// A ranking check calls the wrapper directly with its work item.
export type RankingWork = {
  readonly id: string;
  readonly principal: Principal;
};

export type ModelLimitDependencies = {
  readonly db: Database;
  readonly limits?: Partial<ModelLimits>;
  readonly ranking?: RankingWork;
};

type Middleware = LanguageModelMiddleware;
type CallOptions = Parameters<NonNullable<Middleware["wrapGenerate"]>>[0]["params"];
type InnerModel = Parameters<NonNullable<Middleware["wrapGenerate"]>>[0]["model"];

type Attribution = {
  readonly principal: Principal;
  readonly sessionId: string | null;
  readonly work: { readonly kind: "conversation_input" | "ranking_check"; readonly id: string };
};

// Lock keys, taken in this order: work item, principal, anonymous (requests,
// which may be anonymous), service.
export const SERVICE_ALLOWANCE_LOCK = "app.model_allowance:service";
export const ANONYMOUS_ALLOWANCE_LOCK = "app.model_allowance:anonymous";

export function sessionIdHash(sessionId: string) {
  return createHash("sha256").update(sessionId, "utf8").digest("base64url");
}

function checkInput(params: CallOptions, limits: ModelLimits) {
  for (const message of params.prompt) {
    if (message.role === "system") continue;

    for (const part of message.content) {
      if (part.type === "tool-call" && part.providerExecuted) {
        throw new ModelLimitError("provider_tool");
      }

      if (part.type === "tool-result" && part.output.type === "content") {
        if (part.output.value.some((item) => item.type !== "text")) {
          throw new ModelLimitError("attachment");
        }
      } else if (!["text", "reasoning", "tool-call", "tool-result", "tool-approval-response"].includes(part.type)) {
        throw new ModelLimitError("attachment");
      }
    }
  }

  if (params.tools?.some((tool) => tool.type !== "function")) {
    throw new ModelLimitError("provider_tool");
  }

  const serialized = JSON.stringify({ prompt: params.prompt, responseFormat: params.responseFormat, tools: params.tools });

  if (Buffer.byteLength(serialized, "utf8") > limits.maxInputBytes) {
    throw new ModelLimitError("input_too_large");
  }
}

type SessionRow = {
  current_input_id: string | null;
  principal_id: string;
  principal_type: Principal["type"];
  session_id: string;
  state: string;
};

async function attribute(db: Database, params: CallOptions, ranking: RankingWork | undefined): Promise<Attribution> {
  if (ranking) {
    return { principal: ranking.principal, sessionId: null, work: { id: ranking.id, kind: "ranking_check" } };
  }

  const key = params.providerOptions?.openai?.promptCacheKey;

  if (typeof key !== "string" || !key) {
    throw new ModelLimitError("unattributed");
  }

  const [session] = await db<SessionRow[]>`
    select session_id, principal_type, principal_id, state, current_input_id
    from app.agent_sessions
    where session_id_hash = ${key}
  `;

  if (!session || session.state !== "active" || !session.current_input_id) {
    throw new ModelLimitError("unattributed");
  }

  return {
    principal: { id: session.principal_id, type: session.principal_type },
    sessionId: session.session_id,
    work: { id: session.current_input_id, kind: "conversation_input" },
  };
}

async function reserve(db: Database, attribution: Attribution, limits: ModelLimits) {
  const { principal, sessionId, work } = attribution;
  const attemptCap = work.kind === "ranking_check" ? limits.rankingAttempts : limits.conversationAttempts;

  await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`app.model_allowance:work:${work.kind}:${work.id}`}, 0))`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`app.model_allowance:principal:${principal.type}:${principal.id}`}, 0))`;
    // Whether a request is anonymous is known only after its row is read, so it
    // takes the anonymous lock too; the service lock already orders every call.
    if (principal.type !== "host_account") await tx`select pg_advisory_xact_lock(hashtextextended(${ANONYMOUS_ALLOWANCE_LOCK}, 0))`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${SERVICE_ALLOWANCE_LOCK}, 0))`;

    // Authority is rechecked after the locks: the host may have been suspended,
    // or the session retired or moved to another input, while this call waited.
    // The account row stays share-locked, so a suspension waits for this reservation.
    if (principal.type === "host_account") {
      const [host] = await tx<{ status: string }[]>`
        select status from app.host_accounts where id = ${principal.id} for share
      `;

      if (host?.status !== "active") {
        throw new ModelLimitError("authority_expired");
      }
    }

    // A requester's request must still be open: a closed request, an expired
    // draft or an intake from before D13 runs no more model work. The request
    // row stays share-locked, so a confirmation waits for this reservation.
    if (principal.type === "public_intake") throw new ModelLimitError("authority_expired");

    let anonymous = false;

    if (principal.type === "requester_request") {
      const [request] = await tx<{ confirmed: boolean; open: boolean }[]>`
        select r.closed_at is null and r.expires_at > now() as open,
               r.contact_confirmed_email is not null or exists (
                 select 1 from app.requester_grants g
                 where g.request_id = r.id and g.kind = 'identity' and g.revoked_at is null
               ) as confirmed
        from app.requests r where r.id = ${principal.id} for share
      `;

      if (!request?.open) throw new ModelLimitError("authority_expired");
      anonymous = !request.confirmed;
    }

    if (sessionId) {
      const [session] = await tx<{ current_input_id: string | null; state: string }[]>`
        select state, current_input_id from app.agent_sessions where session_id = ${sessionId}
      `;

      if (session?.state !== "active" || session.current_input_id !== work.id) {
        throw new ModelLimitError("authority_expired");
      }
    }

    const principalCap = anonymous ? limits.anonymousPrincipalWindowUsd : limits.principalWindowUsd;
    const [usage] = await tx<
      { anonymous_over: boolean; attempts: number; principal_over: boolean; service_over: boolean; window_start: Date }[]
    >`
      with w as (select date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00') as start)
      select
        w.start as window_start,
        (select count(*)::int from app.model_reservations
          where work_kind = ${work.kind} and work_id = ${work.id}) as attempts,
        (select coalesce(sum(amount_usd), 0) from app.model_reservations
          where principal_type = ${principal.type} and principal_id = ${principal.id} and window_start = w.start)
          + ${limits.attemptReservationUsd}::numeric > ${principalCap}::numeric as principal_over,
        ${anonymous}::boolean and (select coalesce(sum(amount_usd), 0) from app.model_reservations
          where (anonymous or principal_type = 'public_intake') and window_start = w.start)
          + ${limits.attemptReservationUsd}::numeric > ${limits.anonymousWindowUsd}::numeric as anonymous_over,
        (select coalesce(sum(amount_usd), 0) from app.model_reservations where window_start = w.start)
          + ${limits.attemptReservationUsd}::numeric > ${limits.serviceWindowUsd}::numeric as service_over
      from w
    `;

    if (usage!.attempts >= attemptCap) {
      throw new ModelLimitError("attempts_exhausted");
    }

    if (usage!.principal_over) {
      throw new ModelLimitError("principal_allowance");
    }

    if (usage!.anonymous_over) {
      throw new ModelLimitError("anonymous_allowance");
    }

    if (usage!.service_over) {
      throw new ModelLimitError("service_allowance");
    }

    await tx`
      insert into app.model_reservations
        (work_kind, work_id, principal_type, principal_id, session_id, amount_usd, window_start, anonymous)
      values
        (${work.kind}, ${work.id}, ${principal.type}, ${principal.id}, ${sessionId},
         ${limits.attemptReservationUsd}::numeric, ${usage!.window_start}, ${anonymous})
    `;
  });
}

// The caller's options with the enforced limits applied over anything it asked for.
function enforce(params: CallOptions, outputCap: number, abortSignal: AbortSignal): CallOptions {
  const providerOptions = params.providerOptions ?? {};

  return {
    ...params,
    abortSignal,
    maxOutputTokens: Math.min(params.maxOutputTokens ?? outputCap, outputCap),
    providerOptions: {
      ...providerOptions,
      openai: { ...providerOptions.openai, serviceTier: "default", store: false },
    },
  };
}

function deadline(ms: number, controller: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ModelLimitError("deadline");
      controller.abort(error);
      reject(error);
    }, ms);
  });

  return { clear: () => clearTimeout(timer), expired };
}

// Errors the stream when no next chunk arrives within the idle deadline.
function withIdleDeadline<T>(stream: ReadableStream<T>, ms: number, controller: AbortController) {
  const reader = stream.getReader();

  return new ReadableStream<T>({
    cancel(reason) {
      controller.abort(reason);
      return reader.cancel(reason);
    },
    async pull(output) {
      const wait = deadline(ms, controller);

      try {
        const next = await Promise.race([reader.read(), wait.expired]);

        if (next.done) {
          output.close();
        } else {
          output.enqueue(next.value);
        }
      } catch (error) {
        reader.cancel(error).catch(() => {});
        output.error(error);
      } finally {
        wait.clear();
      }
    },
  });
}

export function modelLimitMiddleware(load: () => ModelLimitDependencies): LanguageModelMiddleware {
  async function prepare(params: CallOptions) {
    const deps = load();
    const limits: ModelLimits = { ...MODEL_LIMITS, ...deps.limits };

    checkInput(params, limits);
    const attribution = await attribute(deps.db, params, deps.ranking);
    await reserve(deps.db, attribution, limits);

    const controller = new AbortController();
    const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, controller.signal]) : controller.signal;
    const outputCap = deps.ranking ? limits.rankingOutputTokens : limits.conversationOutputTokens;

    return { controller, limits, params: enforce(params, outputCap, signal) };
  }

  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ model, params }) => {
      const call = await prepare(params);
      const wait = deadline(call.limits.generateTimeoutMs, call.controller);

      try {
        return await Promise.race([(model as InnerModel).doGenerate(call.params), wait.expired]);
      } finally {
        wait.clear();
      }
    },
    wrapStream: async ({ model, params }) => {
      const call = await prepare(params);
      const wait = deadline(call.limits.idleTimeoutMs, call.controller);

      try {
        const result = await Promise.race([(model as InnerModel).doStream(call.params), wait.expired]);
        return { ...result, stream: withIdleDeadline(result.stream, call.limits.idleTimeoutMs, call.controller) };
      } finally {
        wait.clear();
      }
    },
  };
}

// Wraps a model so every provider call passes the limits. The provider and model
// ID stay the wrapped model's, so eve still adds OpenAI's safety identifier and
// prompt cache key.
export function limitModel(
  model: LanguageModel,
  load: () => ModelLimitDependencies = () => ({ db: database() }),
) {
  // A Gateway model ID string would bypass the provider and its prompt cache key.
  if (typeof model === "string") {
    throw new Error("limitModel needs a provider model instance, not a Gateway model ID.");
  }

  return wrapLanguageModel({ middleware: modelLimitMiddleware(load), model });
}
