import {Database} from '../../lib/server/database/client.ts';
import {dispatchContactShares} from '../../lib/server/photon/contact-delivery.ts';
const env=process.env,endpoint=new URL(env.FMAT_CONTACT_PROVIDER!);
if(endpoint.hostname!=='127.0.0.1'||new URL(env.SUPABASE_URL!).hostname!=='127.0.0.1')throw Error('Local fixture only');
async function crash(point:string){
 if(env.FMAT_CONTACT_CRASH!==point)return;
 await new Promise<void>(resolve=>process.send!({fault:point},()=>resolve()));process.kill(process.pid,'SIGKILL');await new Promise(()=>{});
}
const db=new Database(env),database:Pick<Database,'rpc'>={async rpc(name,input){const result=await db.rpc(name,input);await crash('after:'+input.p_operation);return result;}};
const result=await dispatchContactShares(database,env,{async shareContact(_route,_phone,authorize){
 await authorize();
 const response=await fetch(endpoint,{method:'POST',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Synthetic provider failed');
 await response.text();await crash('after:provider');return {status:'accepted'};
}});
process.send!({result},()=>process.disconnect?.());
