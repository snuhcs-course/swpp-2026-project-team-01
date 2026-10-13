import { eveChannel } from 'eve/channels/eve';

// No synthetic development principal or project-wide OIDC bypass. The
// application session-binding adapter must be installed before accepting turns.
export default eveChannel({ auth: [] });
