import { createDatabase } from "./database";

// What every fmat-admin command shares (lib/server/operator.ts): the
// dependencies, input validation, SQL literals and the two environments, the
// local stack through DATABASE_URL and a hosted project through the Management
// API with the operator's own token.

export type AdminDependencies = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  // Whether a person can answer the typed confirmation.
  readonly interactive: boolean;
  readonly prompt: (question: string) => Promise<string>;
  readonly fetch?: typeof fetch;
  // The Management API origin; tests point it at a fake server.
  readonly managementApiUrl?: string;
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PROJECT_REF = /^[a-z]{20}$/;
// oxlint-disable-next-line no-control-regex -- refusing control characters is the point
export const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export class AdminUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminUsageError";
  }
}

export type AdminTarget = { readonly kind: "local" } | { readonly kind: "project"; readonly ref: string };

export function boundedText(value: string | undefined, name: string, max: number) {
  const text = value?.trim() ?? "";

  if (!text) throw new AdminUsageError(`--${name} is required.`);
  if (text.length > max) throw new AdminUsageError(`--${name} must be at most ${max} characters.`);
  if (CONTROL.test(text)) throw new AdminUsageError(`--${name} must not contain control characters.`);

  return text;
}

// A SQL string literal: the value in single quotes with each quote doubled. The
// inputs were validated first and contain no control characters.
export function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function environmentName(target: AdminTarget) {
  return target.kind === "local" ? "local" : `project:${target.ref}`;
}

export type Row = Record<string, unknown>;

export async function runLocal(sql: string, env: AdminDependencies["env"]): Promise<Row[]> {
  const url = env.DATABASE_URL;

  if (!url) throw new AdminUsageError("--local needs DATABASE_URL.");

  let hostname: string;

  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new AdminUsageError("DATABASE_URL is not a valid URL.");
  }

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new AdminUsageError("--local refuses a DATABASE_URL that is not the local stack (127.0.0.1 or localhost).");
  }

  const db = createDatabase(url);

  try {
    return [...(await db.unsafe<Row[]>(sql))];
  } finally {
    await db.end();
  }
}

export async function runProject(sql: string, ref: string, deps: AdminDependencies): Promise<Row[]> {
  const token = deps.env.SUPABASE_ACCESS_TOKEN;

  if (!token) throw new AdminUsageError("--project needs your own SUPABASE_ACCESS_TOKEN.");

  const base = deps.managementApiUrl ?? "https://api.supabase.com";
  const response = await (deps.fetch ?? fetch)(`${base}/v1/projects/${ref}/database/query`, {
    body: JSON.stringify({ query: sql }),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();

  if (!response.ok) {
    let message = text;

    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // The raw body is the message.
    }

    throw new Error(`The Management API answered ${response.status}: ${message.slice(0, 500)}`);
  }

  return JSON.parse(text) as Row[];
}

// Runs one statement in the selected environment.
export function runIn(target: AdminTarget, sql: string, deps: AdminDependencies): Promise<Row[]> {
  return target.kind === "local" ? runLocal(sql, deps.env) : runProject(sql, target.ref, deps);
}

// A whole number option within bounds, or the fallback when it is absent.
export function boundedInteger(value: string | undefined, name: string, min: number, max: number, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^\d{1,3}$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new AdminUsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  }
  return Number(value);
}

export function identifier(value: string | undefined, name: string) {
  const id = value?.trim().toLowerCase() ?? "";
  if (!UUID.test(id)) throw new AdminUsageError(`--${name} must be an ID.`);
  return id;
}

// Only the options a command uses may be given, so a typo cannot be ignored.
export function onlyOptions(values: Record<string, unknown>, allowed: readonly string[]) {
  const extra = Object.keys(values).filter((key) => values[key] !== undefined && !allowed.includes(key));
  if (extra.length > 0) throw new AdminUsageError(`This command takes no --${extra[0]}.`);
}

export const ENVIRONMENT_OPTIONS = ["local", "project", "operator"] as const;

// The one environment a command names.
export function parseTarget(values: { readonly local?: boolean; readonly project?: string }): AdminTarget {
  if (Boolean(values.local) === (values.project !== undefined)) {
    throw new AdminUsageError("Name exactly one environment: --local or --project <ref>.");
  }

  if (values.project !== undefined && !PROJECT_REF.test(values.project)) {
    throw new AdminUsageError("--project must be a Supabase project ref (20 lowercase letters).");
  }

  return values.project === undefined ? { kind: "local" } : { kind: "project", ref: values.project };
}

// Prints the environment and the action, then asks the operator to type the
// subject unless --yes was given. True when the change may go ahead.
export async function confirmChange(
  deps: AdminDependencies,
  options: { readonly environment: string; readonly action: string; readonly subject: string; readonly yes: boolean },
) {
  deps.stdout(`Environment: ${options.environment}`);
  deps.stdout(`Action: ${options.action} ${options.subject}`);

  if (options.yes) return true;

  if (!deps.interactive) {
    deps.stderr("fmat-admin: refusing to change anything without --yes when no one can confirm interactively.");
    return false;
  }

  const answer = await deps.prompt(`Type ${options.subject} to confirm: `);

  if (answer.trim().toLowerCase() !== options.subject.toLowerCase()) {
    deps.stderr("fmat-admin: confirmation did not match; nothing changed.");
    return false;
  }

  return true;
}

// Maps the fixed refusals an operator function raises to a readable message;
// any other database message is shown as the Management API's errors are.
export function refusalMessage(error: unknown, refusals: readonly (readonly [RegExp, string])[]) {
  const message = (error as Error).message;
  return refusals.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}
