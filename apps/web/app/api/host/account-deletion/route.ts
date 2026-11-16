import { createAccountDeletionHandler } from "@lib/server/account-deletion";

// Schedules the signed-in host's own account deletion
// (self-service-account-deletion D2).
export const POST = createAccountDeletionHandler();
