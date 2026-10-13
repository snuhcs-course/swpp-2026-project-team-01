import {supabaseOrigin} from '../server/database/client.ts';
import {ApplicationError} from '../server/errors.ts';
import {requiredEnv} from '../server/config.ts';
const loopback=(url:URL)=>['localhost','127.0.0.1','[::1]'].includes(url.hostname);
/** Credential shape is an early rejection check, never proof of authority.
 * The database validates the actual server credential on every RPC. */
export function operatorConfiguration(project:string,env=process.env){
 const url=new URL(supabaseOrigin(env));
 if(project==='local'?!loopback(url):url.origin!==`https://${project}.supabase.co`)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const key=requiredEnv('SUPABASE_SECRET_KEY',env);
 if(/^sb_secret_[A-Za-z0-9_-]{20,}$/u.test(key))return;
 try{
  if(key.length>16384||!(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(key)))throw Error();
  const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));
  if(claims.role!=='service_role'||(project!=='local'&&claims.ref!==project))throw Error();
 }catch{throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);}
}
