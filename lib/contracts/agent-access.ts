// The personal-agent access contract (agent-access D3, design 4 and 10): the
// two roles, their scopes with the words the consent page and the connected
// agents list show, and the grant view both surfaces render. Browser-safe.

export const AGENT_ROLES = ["host", "requester"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const HOST_SCOPES = ["host:read", "host:write", "host:decide"] as const;
export const REQUESTER_SCOPES = ["request:read", "request:write", "request:decide"] as const;
export const AGENT_SCOPES = [...HOST_SCOPES, ...REQUESTER_SCOPES] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export function roleScopes(role: AgentRole): readonly AgentScope[] {
  return role === "host" ? HOST_SCOPES : REQUESTER_SCOPES;
}

export function isAgentScope(value: string): value is AgentScope {
  return (AGENT_SCOPES as readonly string[]).includes(value);
}

// What each permission lets the agent do, in the consent page's words.
export const SCOPE_DESCRIPTIONS: Readonly<Record<AgentScope, string>> = {
  "host:read": "See your setup, your requests and their booking status",
  "host:write": "Change your setup draft, check times, suggest and share changes, and allow exceptions",
  "host:decide": "Prepare approvals and declines for you to confirm in Find Me a Time",
  "request:read": "See the host's public profile and your request",
  "request:write": "Create your request, change its details, find and choose times",
  "request:decide": "Agree to the proposed time and withdraw the request for you",
};

// One connected agent as /app and the booking page list it.
export type AgentGrantView = {
  readonly id: string;
  readonly clientName: string;
  // The host of the client's redirect URI, which the consent page showed.
  readonly redirectHost: string;
  readonly scopes: readonly AgentScope[];
  readonly connectedAt: string;
  readonly lastUsedAt: string | null;
};
