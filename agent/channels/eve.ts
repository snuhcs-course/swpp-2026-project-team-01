import { eveChannel } from "eve/channels/eve";
import { appAuth } from "../../lib/server/eve-auth";

export default eveChannel({
  auth: [appAuth],
  uploadPolicy: "disabled",
});
