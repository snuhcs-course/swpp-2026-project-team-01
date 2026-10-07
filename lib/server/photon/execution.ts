import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';

const receipt=z.object({outcome:z.enum(['idle','busy','accepted','revoked','limited'])}).strict();
// Each RPC commits one host's receipt. Bounded requests cannot hold multiple
// hosts' locks while waiting on a busy conversation or on external I/O.
export async function dispatchPhotonInputs(database:Pick<Database,'rpc'>=new Database(),env=process.env){
 const project=z.uuid().safeParse(env.PHOTON_PROJECT_ID);
 if(!project.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const counts={accepted:0,revoked:0,limited:0};
 for(let n=0;n<5;n++){
  const {outcome}=receipt.parse(await database.rpc('fmat_photon_dispatch',{p_project_id:project.data}));
  if(outcome==='idle'||outcome==='busy')break;
  counts[outcome]++;
 }
 return counts;
}
