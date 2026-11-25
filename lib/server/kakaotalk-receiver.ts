import { database, type Database } from "./database";
import { codeContext, voidAttempt } from "./imessage-links";
import {
  codeHashMatches,
  KAKAOTALK_WEBHOOK_ID,
  type KakaoTalkConfig,
  kakaotalkConfig,
  MAX_RELAY_BODY_BYTES,
  parseKakaoTalkEvent,
  RELAY_NONCE_MINUTES,
  type RelayRouteClass,
  relaySecrets,
  verifyRelaySignature,
} from "./kakaotalk";
import { messagingAdmitted } from "./messaging";
import { storeReceipt } from "./photon-receiver";
import { openToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The KakaoTalk relay webhook (host-kakaotalk-channel design 2 and 3, D2 and
// D3). agent/channels/kakaotalk.ts routes POST /kakaotalk/webhook here. Every
// relay route first passes authenticateRelay, in order:
//   1. outside a release origin (and, locally, unless it arrived on a loopback
//      address, as the stand-in calls it) the request is refused with 403
//      before anything is read ("Preserve delivery state on environment denial");
//   2. a route class without a secret refuses with 401;
//   3. the body is at most 64 KB (413);
//   4. the signature must verify under the class's current or previous secret
//      within five minutes, and the nonce must be new; otherwise 401. A refused
//      request reads and changes no delivery state.
// Then a 1:1 message is stored as one receipt (channel kakaotalk, message ID
// kakaotalk:<event ID>) with its imessage_receipt job, in one transaction,
// before 200; the same event again answers 200 and stores nothing, and a
// changed payload under a stored ID answers 409, which the relay drops. A
// group or open-chat event stores nothing. void_code voids the pending link
// attempt whose code has that HMAC, with no receipt, link or reply. A failure
// to store answers 500, so the relay retries. From the receipt on, KakaoTalk
// shares the Photon receipt pipeline.

type Environment = Readonly<Record<string, string | undefined>>;

export type RelayDependencies = {
  readonly config: KakaoTalkConfig;
  readonly db: Database;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  readonly env?: Environment;
  readonly now?: () => number;
};

export function relayDependenciesFromEnvironment(): RelayDependencies {
  return {
    config: kakaotalkConfig(),
    get db() {
      return database();
    },
    get tokenKey() {
      return tokenKeyFromEnvironment();
    },
    get tokenKeys() {
      return [tokenKeyFromEnvironment()];
    },
  };
}

export function relayAnswer(status: number, body?: unknown) {
  return body === undefined
    ? new Response(null, { headers: { "cache-control": "no-store" }, status })
    : new Response(JSON.stringify(body), { headers: { "cache-control": "no-store", "content-type": "application/json" }, status });
}

async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_RELAY_BODY_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RELAY_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

// The verified body of a relay request, or the refusal to answer with.
export async function authenticateRelay(
  request: Request,
  routeClass: RelayRouteClass,
  deps: RelayDependencies,
): Promise<{ readonly body: string } | { readonly refusal: Response }> {
  if (!messagingAdmitted(request.url, deps.env)) return { refusal: relayAnswer(403) };
  const secrets = relaySecrets(deps.config, routeClass);
  if (secrets.length === 0) return { refusal: relayAnswer(401) };

  const body = await readBody(request);
  if (body === null) return { refusal: relayAnswer(413) };

  const now = deps.now ? Math.floor(deps.now() / 1000) : undefined;
  const nonce = verifyRelaySignature(secrets, { body, headers: request.headers, method: request.method, path: new URL(request.url).pathname }, now);
  if (!nonce) return { refusal: relayAnswer(401) };

  // A nonce counts once; the ones past the timestamp window no longer guard anything.
  await deps.db`delete from app.kakaotalk_relay_nonces where seen_at < now() - make_interval(mins => ${RELAY_NONCE_MINUTES})`;
  const [fresh] = await deps.db`
    insert into app.kakaotalk_relay_nonces (nonce, route_class) values (${nonce}, ${routeClass})
    on conflict (nonce) do nothing
    returning nonce
  `;
  if (!fresh) return { refusal: relayAnswer(401) };
  return { body };
}

// Voids every pending attempt whose code has the presented HMAC, under the
// current or previous inbound secret (D3). Only unexpired pending attempts
// still hold their code sealed, and there are few of them.
export async function voidCodeByHash(deps: RelayDependencies, codeHash: string) {
  const pending = await deps.db<{ id: string; code_ciphertext: string; sealed_key_id: string }[]>`
    select id, code_ciphertext, sealed_key_id from app.imessage_links
    where state = 'pending' and method = 'code' and code_ciphertext is not null and expires_at > now()
  `;
  let voided = 0;
  for (const link of pending) {
    let code: string;
    try {
      code = openToken(deps.tokenKeys, { ciphertext: link.code_ciphertext, keyId: link.sealed_key_id }, codeContext(link.id));
    } catch {
      continue;
    }
    if (!codeHashMatches(deps.config.inboundSecrets, code, codeHash)) continue;
    await deps.db.begin((tx) => voidAttempt(tx, link.id));
    voided += 1;
  }
  return voided;
}

export async function receiveKakaoTalkWebhook(request: Request, load: () => RelayDependencies = relayDependenciesFromEnvironment): Promise<Response> {
  const deps = load();
  const verified = await authenticateRelay(request, "inbound", deps);
  if ("refusal" in verified) return verified.refusal;

  let payload: unknown;
  try {
    payload = JSON.parse(verified.body);
  } catch {
    return relayAnswer(400);
  }

  const event = parseKakaoTalkEvent(payload);
  if (!event) return relayAnswer(400);
  if (event.kind === "group") return relayAnswer(200);

  try {
    if (event.kind === "void_code") {
      await voidCodeByHash(deps, event.codeHash);
      return relayAnswer(200);
    }
    const outcome = await storeReceipt(deps, KAKAOTALK_WEBHOOK_ID, event.message, event.payloadSha256);
    return relayAnswer(outcome === "conflict" ? 409 : 200);
  } catch {
    return relayAnswer(500);
  }
}
