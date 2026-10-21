import { eveChannel } from "eve/channels/eve";
import { appAuth, evalRequesterAuth } from "../../lib/server/eve-auth";

// evalRequesterAuth admits only requester evals run under `eve dev` with
// FMAT_EVAL_AUDIENCE=requester and skips everything else; appAuth decides
// every other request and never skips.
export default eveChannel({
  auth: [evalRequesterAuth, appAuth],
  uploadPolicy: "disabled",
});
