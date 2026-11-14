import { z } from "zod";
import type { ImessageStatus } from "../contracts/imessage";
import type { RequesterImessageStatus } from "../contracts/requester-imessage";
import type { AgentToolContext, AgentToolDependencies } from "./agent-tools";
import { commandError, runAsGrant } from "./agent-tools";
import type { CommandDefinition } from "./commands";
import type { Queryable } from "./database";
import type { LinkOptions } from "./imessage-links";
import { photonConfig } from "./photon";
import { telegramConfig } from "./telegram";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

const payload = z.object({ role: z.enum(["host", "requester"]), linkId: z.uuid() }).strict();
export function sealConnectLink(key: TokenKey, value: z.infer<typeof payload>) {
  const sealed = sealToken(key, JSON.stringify(payload.parse(value)), "connect-link");
  return `${sealed.keyId}.${sealed.ciphertext}`;
}
export function openConnectLink(keys: readonly TokenKey[], token: string) {
  try {
    const [keyId, ...parts] = token.split(".");
    return payload.parse(JSON.parse(openToken(keys, { keyId: keyId!, ciphertext: parts.join(".") }, "connect-link")));
  } catch {
    return null;
  }
}

export function linkOptions(deps: AgentToolDependencies): LinkOptions {
  if (deps.chatLinkOptions) return deps.chatLinkOptions;
  const key = deps.tokenKey();
  return { ...photonConfig(), telegramUsername: telegramConfig().username, tokenKey: key, tokenKeys: [key], origin: deps.origin };
}

export function chatStatus(status: ImessageStatus | RequesterImessageStatus) {
  return {
    channel: "channel" in status ? status.channel : null,
    state: status.state === "linked" ? "linked" : ["pending", "received", "fallback"].includes(status.state) ? "pending" : "none",
    sender: "sender" in status ? status.sender : null,
  };
}

export async function startAgentLink<Input>(context: AgentToolContext, command: CommandDefinition<Input, { linkId: string }>, resourceId: string,
  args: { channel: string; number?: string; retryKey: string }) {
  const { retryKey, ...input } = args;
  const outcome = await runAsGrant(context, command, { input, resourceId, retryKey });
  if (!outcome.ok) return commandError(outcome.error);
  const [attempt] = await context.deps.db<{ expires_at: Date; channel: string }[]>`select expires_at, channel from app.imessage_links where id = ${outcome.result.linkId}`;
  const token = sealConnectLink(linkOptions(context.deps).tokenKey, { role: context.access.role, linkId: outcome.result.linkId });
  return { ok: true as const, result: {
    linkUrl: `${context.deps.origin}/connect/link/${token}`, channel: attempt!.channel, expiresAt: attempt!.expires_at.toISOString(),
    next: "Give the person this link. On that page they send a code from their own phone and confirm. Nothing is linked until they do.",
  } };
}

export async function readConnectAttempt(q: Queryable, keys: readonly TokenKey[], token: string) {
  const value = openConnectLink(keys, token);
  if (!value) return null;
  const [row] = await q<{ id: string; host_account_id: string | null; request_id: string | null }[]>`
    select id, host_account_id, request_id from app.imessage_links
    where id = ${value.linkId} and method = 'code' and expires_at > now()
      and (state = 'pending' or (state = 'received' and confirm_by > now()))
  `;
  if (!row || (value.role === "host" ? !row.host_account_id : !row.request_id)) return null;
  return { ...row, role: value.role };
}

export const CLOSED_LINK = "This link is no longer open. Ask your agent to start again.";
