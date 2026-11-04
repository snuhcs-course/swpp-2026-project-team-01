import { eveChannel } from "eve/channels/eve";
import { appAuth, evalHostReviewAuth, evalRequesterAuth } from "../../lib/server/eve-auth";

// evalRequesterAuth and evalHostReviewAuth admit only requester and host-review
// evals run under `eve dev` with FMAT_EVAL_AUDIENCE set, and skip everything
// else; appAuth decides every other request and never skips.
export default eveChannel({
  auth: [evalRequesterAuth, evalHostReviewAuth, appAuth],
  uploadPolicy: "disabled",
});
