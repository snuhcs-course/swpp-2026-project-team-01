"use client";

import type { AgentGrantView } from "@lib/contracts/agent-access";
import type { ImessageStatus } from "@lib/contracts/imessage";
import { MESSAGING_CHANNELS, channelName, type MessagingChannel } from "@lib/contracts/messaging-channel";
import { type RefObject, useCallback, useEffect, useState } from "react";
import { ImessageCard } from "@/app/_components/imessage/imessage-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Connected agents (agent-access design 10): the personal-agent connections
// of the signed-in host, or of one request on its booking page, each with its
// client, where it returns to, its permissions and last use, and Revoke behind
// one inline confirmation. In host apps mode, the dialog also shows the single
// linked messaging channel and reuses its existing connect and unlink flow. It
// opens from a menu rather than a trigger of its own, so on close it returns
// focus to returnFocus, the menu's button.

export type GrantSource = {
  readonly load: () => Promise<readonly AgentGrantView[] | null>;
  readonly revoke: (grantId: string) => Promise<boolean>;
  // Shown when nothing is connected.
  readonly empty: string;
  // Shown under the list whether or not something is connected: how to connect
  // another agent, or switch to one (testing baseline A01 M-4.1).
  readonly connectHint?: (origin: string) => { readonly prompt: string; readonly note: string };
};

const PERMISSION_WORDS: Readonly<Record<string, string>> = {
  "host:decide": "approve, decline and cancel",
  "host:read": "read",
  "host:write": "change",
  "request:decide": "agree, withdraw and cancel",
  "request:read": "read",
  "request:write": "change",
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ConnectedAgentsDialog({
  appsMode = false,
  onOpenChange,
  open,
  returnFocus,
  source,
}: {
  readonly appsMode?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly returnFocus: RefObject<HTMLElement | null>;
  readonly source: GrantSource;
}) {
  const [grants, setGrants] = useState<readonly AgentGrantView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messagingStatus, setMessagingStatus] = useState<ImessageStatus | null>(null);
  const [messagingFailed, setMessagingFailed] = useState(false);
  const [manageMessaging, setManageMessaging] = useState(false);
  const listedChannels = listedMessagingChannels(messagingStatus);
  const { load, revoke } = source;
  // The dialog renders only on the client once opened, so the origin is known here.
  const connectHint = open && source.connectHint ? source.connectHint(window.location.origin) : null;

  const reload = useCallback(async () => {
    const loaded = await load().catch(() => null);
    setFailed(loaded === null);
    setGrants(loaded);
  }, [load]);

  useEffect(() => {
    if (open) void reload();
    else {
      setConfirming(null);
      setManageMessaging(false);
      setMessagingStatus(null);
      setMessagingFailed(false);
    }
  }, [open, reload]);

  useEffect(() => {
    if (!open || !appsMode) return;
    let active = true;
    const readMessagingStatus = async () => {
      const response = await fetch("/api/host/imessage", { cache: "no-store" }).catch(() => null);
      const status = response?.ok ? ((await response.json()) as ImessageStatus) : null;
      if (!active) return;
      setMessagingFailed(status === null);
      if (status) setMessagingStatus(status);
    };
    void readMessagingStatus();
    const timer = window.setInterval(() => void readMessagingStatus(), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [appsMode, open]);

  async function confirmRevoke(grantId: string) {
    setBusy(true);
    const ok = await revoke(grantId).catch(() => false);
    setBusy(false);
    setConfirming(null);
    if (!ok) setFailed(true);
    await reload();
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={appsMode ? "max-h-[85dvh] overflow-y-auto sm:max-w-2xl" : undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{appsMode ? "Connected apps" : "Connected agents"}</DialogTitle>
          <DialogDescription>
            {appsMode
              ? "Review your connected agents and messaging app."
              : "Agents you allowed to work with Find Me a Time. Revoking one stops it at its next request."}
          </DialogDescription>
        </DialogHeader>
        {appsMode ? (
          <section aria-labelledby="messaging-apps-heading" className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold" id="messaging-apps-heading">Messaging app</h3>
            </div>
            {messagingFailed ? <p className="text-destructive text-sm" role="alert">Messaging status could not be loaded.</p> : null}
            {messagingStatus ? null : <p className="text-muted-foreground text-sm">Loading status…</p>}
            {messagingStatus?.state === "unavailable" ? <p className="text-muted-foreground text-sm">Messaging is unavailable right now.</p> : null}
            <ul aria-label="Messaging app connections" className={`grid gap-2 ${listedChannels.length >= 3 ? "sm:grid-cols-3" : listedChannels.length === 2 ? "sm:grid-cols-2" : ""}`}>
              {listedChannels.map((channel) => {
                const result = messagingChannelState(messagingStatus!, channel);
                return (
                  <li className="min-w-0 rounded-xl border p-3" key={channel}>
                    <p className="font-medium">{channelName(channel)}</p>
                    <p className={result.connected ? "mt-1 truncate text-sm text-emerald-700" : "text-muted-foreground mt-1 text-sm"}>
                      {result.label}
                    </p>
                  </li>
                );
              })}
            </ul>
            <Button className="min-h-11" onClick={() => setManageMessaging((value) => !value)} type="button" variant="outline">
              {manageMessaging ? "Hide messaging options" : messagingStatus?.state === "linked" ? "Manage messaging app" : "Connect a messaging app"}
            </Button>
            {manageMessaging ? <ImessageCard expandedInitially /> : null}
          </section>
        ) : null}
        {appsMode ? <div className="h-px bg-border" /> : null}
        <section aria-labelledby="connected-agents-heading" className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold" id="connected-agents-heading">Connected agents</h3>
            <p className="text-muted-foreground mt-1 text-sm">Agents you allowed to work with Find Me a Time. Revoking one stops it at its next request.</p>
          </div>
        {failed ? (
          <p className="text-destructive text-sm" role="alert">
            The list could not be loaded or changed. Try again.
          </p>
        ) : null}
        {grants === null && !failed ? (
          <p className="text-muted-foreground text-sm" role="status">
            Loading...
          </p>
        ) : null}
        {grants?.length === 0 ? <p className="text-muted-foreground text-sm">{source.empty}</p> : null}
        {grants && grants.length > 0 ? (
          <ul aria-label="Connected agents" className="flex flex-col gap-3">
            {grants.map((grant) => (
              <li className="rounded-xl bg-secondary p-3" key={grant.id}>
                <p className="font-medium">{grant.clientName}</p>
                <p className="text-muted-foreground text-sm">
                  Returns to {grant.redirectHost}. Can {grant.scopes.map((scope) => PERMISSION_WORDS[scope] ?? scope).join(", ")}.
                </p>
                <p className="text-muted-foreground text-sm">
                  Connected {when(grant.connectedAt)}
                  {grant.lastUsedAt ? `, last used ${when(grant.lastUsedAt)}` : ", not used yet"}.
                </p>
                {confirming === grant.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm">Revoke {grant.clientName}?</span>
                    <Button className="min-h-11" disabled={busy} onClick={() => void confirmRevoke(grant.id)} type="button" variant="destructive">
                      {busy ? "Revoking..." : "Revoke"}
                    </Button>
                    <Button className="min-h-11" disabled={busy} onClick={() => setConfirming(null)} type="button" variant="outline">
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <Button className="mt-2 min-h-11" onClick={() => setConfirming(grant.id)} type="button" variant="outline">
                    Revoke {grant.clientName}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {connectHint ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{grants && grants.length > 0 ? "Connect or switch to another agent" : "Connect an agent"}</p>
            <p className="text-muted-foreground text-sm">Tell your agent:</p>
            <code className="block rounded-md bg-secondary px-3 py-2 text-sm break-all select-all">{connectHint.prompt}</code>
            <p className="text-muted-foreground text-sm">{connectHint.note}</p>
          </div>
        ) : null}
        </section>
      </DialogContent>
    </Dialog>
  );
}

export const HOST_GRANT_SOURCE: GrantSource = {
  empty: "No agents are connected.",
  connectHint: (origin) => ({
    prompt: `Let me use ${origin}/SKILL.md for my scheduling`,
    note: "When it asks to connect, you allow it in this browser. To switch agents, connect the new one, then revoke the old one above.",
  }),
  load: async () => {
    const response = await fetch("/api/agent-grants", { cache: "no-store" });
    return response.ok ? ((await response.json()) as { grants: AgentGrantView[] }).grants : null;
  },
  revoke: async (grantId) => {
    const response = await fetch("/api/agent-grants/revoke", {
      body: JSON.stringify({ grantId, retryKey: crypto.randomUUID() }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.ok;
  },
};

// The channels the list shows: those this deployment can link, and the one the host's link or attempt
// uses even if it is no longer offered. A channel the deployment does not offer, such as WhatsApp while
// it is hidden (issue #221), is left out rather than shown as "Not configured". Nothing before the
// status loads.
export function listedMessagingChannels(status: ImessageStatus | null): MessagingChannel[] {
  if (!status || status.state === "unavailable") return [];
  return MESSAGING_CHANNELS.filter((channel) => Boolean(status.channels[channel]) || ("channel" in status && status.channel === channel));
}

function messagingChannelState(status: ImessageStatus, channel: MessagingChannel) {
  if (status.state === "unavailable") return { connected: false, label: "Unavailable" };
  if (status.state === "linked" && status.channel === channel) {
    return { connected: true, label: `Connected · ${status.sender}` };
  }
  if ((status.state === "pending" || status.state === "received" || status.state === "fallback") && status.channel === channel) {
    return { connected: false, label: "Connection in progress" };
  }
  return {
    connected: false,
    label: status.state === "linked" ? "Available to switch" : "Available",
  };
}

export function requestGrantSource(bookingId: string): GrantSource {
  return {
    empty: "No agent is connected to this request.",
    load: async () => {
      const response = await fetch(`/api/requests/${bookingId}/agent-grants`, { cache: "no-store" });
      return response.ok ? ((await response.json()) as { grants: AgentGrantView[] }).grants : null;
    },
    revoke: async (grantId) => {
      const response = await fetch(`/api/requests/${bookingId}/commands`, {
        body: JSON.stringify({ input: { grantId }, operation: "agent.revoke_grant", retryKey: crypto.randomUUID() }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return response.ok;
    },
  };
}
