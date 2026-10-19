import { type AuthFn, UnauthenticatedError } from "eve/channels/auth";

// The only entry in the eve channel's auth list. It never returns null, so the
// walk cannot fall through to another authenticator. Until the internal bearer
// and the session-index ownership check exist, every request is refused.
export const appAuth: AuthFn<Request> = async () => {
  throw new UnauthenticatedError({
    code: "authentication_required",
    message: "Sign in to continue.",
  });
};
