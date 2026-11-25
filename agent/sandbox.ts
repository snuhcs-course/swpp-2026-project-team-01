import { defineSandbox } from "eve/sandbox";
import { JustBashSandbox } from "eve/sandbox/just-bash";

// Domain tools and private memory run on the server/Postgres. No authored tool
// uses a sandbox or native process; keep eve's required environment local and
// inert rather than provisioning a Docker/VM/Blob dependency for account memory.
export const environment = JustBashSandbox.environment();
export default defineSandbox(() => environment.open());
