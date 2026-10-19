// The deployment environment, read from Vercel's system variables. Production is
// recognized only when VERCEL=1 and VERCEL_ENV=production agree (and a custom
// target, when present, is production too). A process with no Vercel metadata is
// local. Anything partial or contradictory is "unknown", which every gate treats
// as non-production.
export type DeploymentEnvironment = "production" | "preview" | "development" | "local" | "unknown";

type Environment = Readonly<Record<string, string | undefined>>;

function value(env: Environment, name: string) {
  return env[name]?.trim() || undefined;
}

export function deploymentEnvironment(env: Environment = process.env): DeploymentEnvironment {
  const vercel = value(env, "VERCEL");
  const vercelEnv = value(env, "VERCEL_ENV");
  const target = value(env, "VERCEL_TARGET_ENV");

  if (vercel === undefined && vercelEnv === undefined && target === undefined) {
    return "local";
  }

  if (vercel !== "1") {
    return "unknown";
  }

  if (vercelEnv === "production") {
    return target === undefined || target === "production" ? "production" : "unknown";
  }

  // Custom environments deploy with VERCEL_ENV=preview and their own target name.
  if (vercelEnv === "preview") {
    return target === "production" || target === "development" ? "unknown" : "preview";
  }

  if (vercelEnv === "development") {
    return target === undefined || target === "development" ? "development" : "unknown";
  }

  return "unknown";
}
