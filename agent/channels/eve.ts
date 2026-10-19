import { eveChannel } from "eve/channels/eve";
import { appAuth } from "../../apps/web/lib/eve-auth";

export default eveChannel({
  auth: [appAuth],
  uploadPolicy: "disabled",
});
