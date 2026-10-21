import { CommandError } from "./commands";
import { deploymentEnvironment } from "./deployment";

// The messaging-environment gate every transport goes through (email, AgentMail,
// iMessage). Messaging is admitted on the production deployment, and in
// standalone local execution only toward a loopback endpoint, so a local run
// reaches a stand-in provider and never the real one even with a real token in
// .env.local (design decision 13). Previews, Vercel development, custom
// environments and missing or contradictory Vercel metadata are refused with a
// sanitized configuration error before any network access or delivery-state
// read. Admission grants nothing by itself: an admitted send still passes the
// transport's own authority and credential checks.

type Environment = Readonly<Record<string, string | undefined>>;

export type MessagingTransport<Message, Receipt> = {
  // The base URL the transport sends to, as configured.
  readonly endpoint: string;
  readonly send: (message: Message) => Promise<Receipt>;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackEndpoint(endpoint: string) {
  try {
    return LOOPBACK_HOSTS.has(new URL(endpoint).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function messagingAdmitted(endpoint: string, env: Environment = process.env) {
  const environment = deploymentEnvironment(env);
  return environment === "production" || (environment === "local" && isLoopbackEndpoint(endpoint));
}

export function assertMessagingAdmitted(endpoint: string, env: Environment = process.env) {
  if (!messagingAdmitted(endpoint, env)) {
    // The fixed category message reflects no metadata, endpoint or credential.
    throw new CommandError("unavailable_configuration");
  }
}

// Builds a transport whose every send checks admission toward its own endpoint
// first, so a caller that bypasses the delivery worker and invokes the adapter
// directly is refused too.
export function gateTransport<Message, Receipt>(
  transport: MessagingTransport<Message, Receipt>,
  env: Environment = process.env,
): MessagingTransport<Message, Receipt> {
  return {
    endpoint: transport.endpoint,
    send: async (message) => {
      assertMessagingAdmitted(transport.endpoint, env);
      return transport.send(message);
    },
  };
}

// Delivery workers wrap their whole run in this with the endpoint of the
// transport they will use, so a denied environment never claims a lease, marks a
// message or touches uncertainty state.
export async function withMessagingAdmission<T>(
  endpoint: string,
  work: () => Promise<T>,
  env: Environment = process.env,
) {
  assertMessagingAdmitted(endpoint, env);
  return work();
}
