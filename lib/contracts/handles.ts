// Public handle rules (host-admission: handle format and reserved names). The
// database enforces the same format on app.host_handles; this module is what
// setup, the public routes and the administrator CLI share.

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
export const HANDLE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// After the first assignment, at most this many assignments in any rolling window.
export const HANDLE_CHANGE_LIMIT = 2;
export const HANDLE_CHANGE_WINDOW_DAYS = 30;

// Every current and planned top-level route, plus operational, product and
// impersonation names. A new top-level route is added here before it ships.
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "about",
  "account",
  "accounts",
  "admin",
  "administrator",
  "api",
  "app",
  "apple-icon",
  "assets",
  "auth",
  "billing",
  "blog",
  "booking",
  "bookings",
  "cli",
  "connect",
  "connections",
  "contact",
  "dashboard",
  "docs",
  "email",
  "eve",
  "favicon",
  "find-me-a-time",
  "findmeatime",
  "health",
  "help",
  "home",
  "icon",
  "inbox",
  "internal",
  "jobs",
  "legal",
  "llms",
  "login",
  "logout",
  "mail",
  "mcp",
  "me",
  "new",
  "null",
  "oauth",
  "operator",
  "pricing",
  "privacy",
  "public",
  "robots",
  "root",
  "security",
  "settings",
  "sign-in",
  "sign-out",
  "sign-up",
  "signin",
  "signout",
  "signup",
  "sitemap",
  "skill",
  "static",
  "status",
  "support",
  "system",
  "team",
  "terms",
  "thyme",
  "undefined",
  "webhooks",
  "well-known",
  "www",
]);

export type HandleProblem = "format" | "reserved";

export function normalizeHandle(candidate: string) {
  return candidate.trim().toLowerCase();
}

// Why a normalized handle cannot be used, before availability is checked; null
// when the format is valid and the name is not reserved.
export function handleProblem(handle: string): HandleProblem | null {
  if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH || !HANDLE_PATTERN.test(handle)) {
    return "format";
  }

  return RESERVED_HANDLES.has(handle) ? "reserved" : null;
}

export function isUsableHandle(handle: string) {
  return handleProblem(handle) === null;
}

// The starting point for a proposed handle: an address's local part reduced to
// the handle format. The caller adds a numeric suffix when it is taken or reserved.
export function handleBaseFromEmail(email: string) {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  let base = local
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+/g, "-")
    .replace(/-$/, "")
    .slice(0, HANDLE_MAX_LENGTH - 4)
    .replace(/-$/, "");

  while (base.length < HANDLE_MIN_LENGTH) base += "x";
  return base;
}
