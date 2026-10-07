import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {handoffProof} from '../../../lib/contracts/imessage.ts';
import {PhotonBrowserHandoff} from '../../../lib/server/photon/handoff-browser.ts';
import {browserProof} from '../../../lib/server/photon/proof.ts';
import {ApplicationError} from '../../../lib/server/errors.ts';
import {applicationOrigin} from '../../../lib/server/config.ts';
import {privateHeaders,readJson} from '../../../lib/server/identity/request-credential.ts';

export function imessageCookies(){
 const secure=applicationOrigin().startsWith('https:');
 return {secure,browser:secure?'__Host-fmat-imessage':'fmat-imessage',entry:secure?'__Host-fmat-imessage-entry':'fmat-imessage-entry'};
}
export function entryProof(request:NextRequest){
 const value=request.cookies.get(imessageCookies().entry)?.value;
 if(!value)return null;
 const [handoffId,token,...rest]=value.split('.'),parsed=handoffProof.safeParse({handoffId,token});
 return rest.length===0&&parsed.success?parsed.data:null;
}
export function clearEntry(response:NextResponse){
 const names=imessageCookies();response.cookies.set(names.entry,'',{httpOnly:true,secure:names.secure,sameSite:'lax',path:'/',maxAge:0});return response;
}
export async function imessageEntryBrowser(request:NextRequest,operation:string,service=new PhotonBrowserHandoff()){
 const names=imessageCookies(),browser=request.cookies.get(names.browser)?.value;
 const json=(body:unknown)=>NextResponse.json(body,{headers:{...privateHeaders,'cache-control':'private, no-store',vary:'Cookie'}});
 if(request.method==='POST'&&operation==='bind'){
  z.strictObject({}).parse(await readJson(request));const response=json({bound:true});
  response.cookies.set(names.browser,browser||browserProof(),{httpOnly:true,secure:names.secure,sameSite:'lax',path:'/',maxAge:3600});return response;
 }
 if(request.method==='POST'&&operation==='clear'){
  z.strictObject({}).parse(await readJson(request));return clearEntry(json({cleared:true}));
 }
 if(request.method==='POST'&&operation==='exchange'){
  if(!browser)throw new ApplicationError('CHALLENGE_INVALID',400);
  const proof=handoffProof.parse(await readJson(request)),state=await service.exchange(browser,proof),response=json(state);
  response.cookies.set(names.entry,proof.handoffId+'.'+proof.token,{httpOnly:true,secure:names.secure,sameSite:'lax',path:'/',
   maxAge:Math.max(0,Math.floor((Date.parse(state.expiresAt)-Date.now())/1000))});return response;
 }
 if(request.method==='GET'&&operation==='read'){
  const proof=entryProof(request);if(!browser||!proof)return json(null);
  try{return json(await service.read(browser,proof));}
  catch(error){if(error instanceof ApplicationError&&['CHALLENGE_INVALID','NOT_FOUND'].includes(error.code))return clearEntry(json(null));throw error;}
 }
 throw new ApplicationError('NOT_FOUND',404);
}
