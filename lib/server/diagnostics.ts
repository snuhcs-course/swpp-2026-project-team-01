import type { CommandErrorCategory } from "../contracts/command-errors";
import type { Database } from "./database";

// Rejection observations (operational-diagnostics: bounded rejection
// observations; operations-and-release design 5, D6). The command pipeline
// reports each failed command's category here; only the recognized categories
// are counted, and only while DIAGNOSTICS_REJECTIONS is "1". Recording runs on
// its own pool connection, outside the rolled-back command transaction, waits at
// most REJECTION_WAIT_MS, is never retried, and never changes the command's own
// result: every failure here is swallowed.

export const REJECTION_CATEGORIES: Partial<Record<CommandErrorCategory, "authorization_denied" | "stale_action">> = {
  forbidden: "authorization_denied",
  request_closed: "stale_action",
  stale_revision: "stale_action",
  unauthenticated: "authorization_denied",
};

export const REJECTION_WAIT_MS = 500;

type Environment = Readonly<Record<string, string | undefined>>;

export function rejectionCollectionEnabled(env: Environment = process.env) {
  return env.DIAGNOSTICS_REJECTIONS?.trim() === "1";
}

export async function observeRejection(
  db: Database,
  category: CommandErrorCategory,
  env: Environment = process.env,
  waitMs = REJECTION_WAIT_MS,
) {
  const observed = REJECTION_CATEGORIES[category];

  if (!observed || !rejectionCollectionEnabled(env)) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)));
  const recorded = db`select app.record_rejection(${observed})`.then(
    () => undefined,
    () => undefined,
  );

  try {
    await Promise.race([recorded, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
