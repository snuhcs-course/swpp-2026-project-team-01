import { CommandError } from "./commands";
import { deploymentEnvironment } from "./deployment";

// The messaging-environment gate every transport goes through (email, AgentMail,
// iMessage). Messaging is admitted only on the production deployment and in
// standalone local execution, as the messaging-environments contract states;
// previews, Vercel development, custom environments and missing or contradictory
// Vercel metadata are refused with a sanitized configuration error before any
// network access or delivery-state read. Admission grants nothing by itself: an
// admitted send still passes the transport's own authority and credential checks.

type Environment = Readonly<Record<string, string | undefined>>;

export type MessagingTransport<Message, Receipt> = {
  readonly send: (message: Message) => Promise<Receipt>;
};

export function messagingAdmitted(env: Environment = process.env) {
  const environment = deploymentEnvironment(env);
  return environment === "production" || environment === "local";
}

export function assertMessagingAdmitted(env: Environment = process.env) {
  if (!messagingAdmitted(env)) {
    // The fixed category message reflects no metadata or credential.
    throw new CommandError("unavailable_configuration");
  }
}

// Builds a transport whose every send checks admission first, so a caller that
// bypasses the delivery worker and invokes the adapter directly is refused too.
export function gateTransport<Message, Receipt>(
  transport: MessagingTransport<Message, Receipt>,
  env: Environment = process.env,
): MessagingTransport<Message, Receipt> {
  return {
    send: async (message) => {
      assertMessagingAdmitted(env);
      return transport.send(message);
    },
  };
}

// Delivery workers wrap their whole run in this, so a denied environment never
// claims a lease, marks a message or touches uncertainty state.
export async function withMessagingAdmission<T>(work: () => Promise<T>, env: Environment = process.env) {
  assertMessagingAdmitted(env);
  return work();
}
