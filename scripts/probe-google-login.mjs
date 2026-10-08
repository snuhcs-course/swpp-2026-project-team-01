import {pathToFileURL} from 'node:url';

class ProbeFailure extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ProbeFailure(code);};
const redirects=new Set([301,302,303,307,308]);
/** No account credentials, cookies, tokens, provider bodies or full URLs are logged.
 * Reaching Google sign-in is an initial redirect check, never completed login. */
export async function probeGoogleLogin(origin,projectRef,fetcher=fetch){
 let app;try{app=new URL(origin);}catch{fail('INVALID_TARGET');}
 if(app.protocol!=='https:'||app.origin!==origin||app.username||app.password||!/^[a-z]{20}$/u.test(projectRef))fail('INVALID_TARGET');
 const authOrigin=`https://${projectRef}.supabase.co`,callback=authOrigin+'/auth/v1/callback';
 const signal=AbortSignal.timeout(20000);
 const request=(url,init={})=>fetcher(url,{...init,redirect:'manual',credentials:'omit',signal});
 const start=await request(origin+'/api/browser/auth/start',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
 if(start.status!==200)fail('AUTH_START_FAILED');
 const reader=start.body?.getReader();if(!reader)fail('AUTH_START_INVALID');
 let chunks=[],size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384)fail('AUTH_START_INVALID');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 let url;try{url=new URL(JSON.parse(Buffer.concat(chunks).toString('utf8')).url);}catch{fail('AUTH_START_INVALID');}
 if(url.origin!==authOrigin||url.pathname!=='/auth/v1/authorize'||url.searchParams.get('provider')!=='google'||url.searchParams.get('redirect_to')!==origin+'/auth/callback')fail('AUTH_TARGET_MISMATCH');
 let google=false;
 for(let hop=0;hop<6;hop++){
  if(url.username||url.password||url.protocol!=='https:'||!(url.origin===authOrigin&&!google||url.origin==='https://accounts.google.com'))fail('UNEXPECTED_REDIRECT');
  if(url.origin==='https://accounts.google.com'){
   if(!google){if(url.pathname!=='/o/oauth2/v2/auth'||url.searchParams.get('redirect_uri')!==callback)fail('GOOGLE_CALLBACK_MISMATCH');google=true;}
   if(url.pathname==='/signin/oauth/error'){
    const detail=Buffer.from(url.searchParams.get('authError')??'','base64url').toString('utf8');
    fail(detail.includes('redirect_uri_mismatch')?'GOOGLE_REDIRECT_URI_MISMATCH':'GOOGLE_REQUEST_REJECTED');
   }
  }
  const response=await request(url.href),location=response.headers.get('location');await response.body?.cancel();
  if(redirects.has(response.status)&&location){url=new URL(location,url);continue;}
  if(response.status===200&&google&&/^\/v[23]\/signin\/(identifier|accountchooser|challenge\/pwd)$/u.test(url.pathname))return {origin,projectRef,initialGoogleRedirect:'passed',liveLoginVerified:false};
  fail('BROWSER_VERIFICATION_REQUIRED');
 }
 fail('REDIRECT_LIMIT');
}
export async function main(args,stdout=console.log,stderr=console.error,fetcher=fetch){
 try{
  if(args.length!==4||args[0]!=='--origin'||args[2]!=='--project')fail('INVALID_ARGUMENTS');
  stdout(JSON.stringify(await probeGoogleLogin(args[1],args[3],fetcher)));return 0;
 }catch(error){stderr(JSON.stringify({probe:'google-login',code:error instanceof ProbeFailure?error.code:'PROBE_UNAVAILABLE',liveLoginVerified:false}));return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main(process.argv.slice(2));
