import type {ErrorCode} from '../../contracts/errors.ts';
import type {RejectionCategory} from '../../contracts/rejection-observations.ts';
import type {Fetch} from './client.ts';

function category(name:string,body:unknown,mappedCode?:ErrorCode):RejectionCategory|undefined{
 if(['fmat_operational_snapshot','fmat_rejection_snapshot','fmat_rejection_record'].includes(name))return;
 if(mappedCode==='STALE_REVISION')return 'stale_action';
 if(mappedCode&&['UNAUTHORIZED','FORBIDDEN','HOST_NOT_ADMITTED'].includes(mappedCode))return 'authorization_denied';
 if((name.startsWith('fmat_oauth_')||name==='fmat_agent_operation'||name==='fmat_agent_intake')&&body&&typeof body==='object'&&'error' in body&&typeof body.error==='string'&&['invalid_grant','invalid_scope','invalid_token','invalid_client'].includes(body.error))return 'authorization_denied';
}

/** Best effort and separate from the rejected transaction. Never recurse through
 * Database.rpc, retry, log upstream content, or let telemetry replace an outcome. */
export async function observeDatabaseRejection(options:{name:string;body?:unknown;mappedCode?:ErrorCode;env:NodeJS.ProcessEnv;origin:string;headers:Record<string,string>;fetcher:Fetch}){
 if(options.env.OPERATIONAL_REJECTIONS_ENABLED!=='true')return;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const controller=new AbortController();
 try{
  const observed=category(options.name,options.body,options.mappedCode);if(!observed)return;
  const deadline=new Promise<void>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve();},250);});
  const attempt=Promise.resolve().then(()=>options.fetcher(options.origin+'/rest/v1/rpc/fmat_rejection_record',{
   method:'POST',headers:options.headers,body:JSON.stringify({p_category:observed}),
   cache:'no-store',redirect:'error',signal:controller.signal,
  })).then(response=>{void response.body?.cancel().catch(()=>{});}).catch(()=>{});
  await Promise.race([attempt,deadline]);
 }catch{/* An observer can never replace the original result, including malformed test transports. */}
 finally{clearTimeout(timer);controller.abort();}
}
