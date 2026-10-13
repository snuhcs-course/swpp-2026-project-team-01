import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {PhotonBrowserHandoff} from '../../../lib/server/photon/handoff-browser.ts';
import {imessageCookies,entryProof,clearEntry} from './imessage-entry-browser.ts';
import {HostIMessage} from '../../../lib/server/photon/linking.ts';
import {browserProof} from '../../../lib/server/photon/proof.ts';
import {ApplicationError} from '../../../lib/server/errors.ts';
import {readJson,privateHeaders} from '../../../lib/server/identity/request-credential.ts';
import type {Credential} from '../../../lib/server/identity/credentials.ts';

export async function imessageBrowser(request:NextRequest,operation:string,credential:Credential,service=new HostIMessage(),entries=new PhotonBrowserHandoff()){
 const {secure,browser:name}=imessageCookies();
 const browser=request.cookies.get(name)?.value;
 const json=(body:unknown)=>NextResponse.json(body,{headers:{...privateHeaders,'cache-control':'private, no-store',vary:'Cookie'}});
 if(operation==='read'&&request.method==='GET'){
  const state=await service.read(credential,browser),entry=entryProof(request);
  if(state.link||!entry||!browser)return json({...state,handoff:null});
  try{return json({...state,handoff:await entries.read(browser,entry)});}
  catch(error){if(error instanceof ApplicationError&&['CHALLENGE_INVALID','NOT_FOUND'].includes(error.code))return clearEntry(json({...state,handoff:null}));throw error;}
 }
 if(request.method!=='POST')throw new ApplicationError('NOT_FOUND',404);
 if(operation==='bind'){
  z.strictObject({}).parse(await readJson(request));
  // Establish the proof before a separate Send code request. A lost start
  // response cannot strand a challenge behind an undelivered Set-Cookie.
  await service.read(credential,browser);
  const response=json({bound:true});
  response.cookies.set(name,browser||browserProof(),{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:3600});
  return response;
 }
 if(operation==='continue'){
  const entry=entryProof(request);if(!browser||!entry)throw new ApplicationError('CHALLENGE_INVALID',400);
  return json(await entries.start(credential,browser,entry,await readJson(request)));
 }
 if(operation==='start'||operation==='verify'){
  if(!browser)throw new ApplicationError('CHALLENGE_INVALID',400);
  const state=await service[operation](credential,browser,await readJson(request)),response=json(state);
  return state.link?clearEntry(response):response;
 }
 if(operation==='cancel'||operation==='unlink')return clearEntry(json(await service[operation](credential,browser,await readJson(request))));
 if(operation==='skip'){z.strictObject({}).parse(await readJson(request));return clearEntry(json(await service.skip(credential,browser)));}
 throw new ApplicationError('NOT_FOUND',404);
}
