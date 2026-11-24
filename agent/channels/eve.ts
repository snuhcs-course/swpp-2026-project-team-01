import { eveChannel } from "eve/channels/eve";
import { appAuth, evalHostReviewAuth, evalHostSetupAuth, evalRequesterAuth } from "../../lib/server/eve-auth";

// evalRequesterAuth, evalHostReviewAuth and evalHostSetupAuth admit only
// requester, host-review and host setup evals run under `eve dev` with
// FMAT_EVAL_AUDIENCE set, and skip everything else; appAuth decides every
// other request and never skips.
export default eveChannel({
  auth: [evalRequesterAuth, evalHostReviewAuth, evalHostSetupAuth, appAuth],
  uploadPolicy: "disabled",
});
