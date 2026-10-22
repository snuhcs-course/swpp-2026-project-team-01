"use client";

import type { AgentGrantView } from "@lib/contracts/agent-access";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Connected agents (agent-access design 10): the personal-agent connections
// of the signed-in host, or of one request on its booking page, each with its
// client, where it returns to, its permissions and last use, and Revoke behind
// one inline confirmation. The source decides where the list comes from and how
// revocation runs; the dialog is the same on both surfaces.

export type GrantSource = {
  readonly load: () => Promise<readonly AgentGrantView[] | null>;
  readonly revoke: (grantId: string) => Promise<boolean>;
  // Shown when nothing is connected.
  readonly empty: string;
};

const PERMISSION_WORDS: Readonly<Record<string, string>> = {
  "host:decide": "prepare decisions",
  "host:read": "read",
  "host:write": "change",
  "request:decide": "agree and withdraw",
  "request:read": "read",
  "request:write": "change",
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ConnectedAgentsDialog({
  onOpenChange,
  open,
  source,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly source: GrantSource;
}) {
  const [grants, setGrants] = useState<readonly AgentGrantView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { load, revoke } = source;

  const reload = useCallback(async () => {
    const loaded = await load().catch(() => null);
    setFailed(loaded === null);
    setGrants(loaded);
  }, [load]);

  useEffect(() => {
    if (open) void reload();
    else setConfirming(null);
  }, [open, reload]);

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connected agents</DialogTitle>
          <DialogDescription>Agents you allowed to work with Find Me a Time. Revoking one stops it at its next request.</DialogDescription>
        </DialogHeader>
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
              <li className="rounded-lg border border-border p-3" key={grant.id}>
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
      </DialogContent>
    </Dialog>
  );
}

export const HOST_GRANT_SOURCE: GrantSource = {
  empty: "No agents are connected. Ask your agent to connect to Find Me a Time; you allow it in this browser.",
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
