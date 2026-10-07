import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {HostIMessage} from '../../../lib/server/photon/linking.ts';
import {browserProof} from '../../../lib/server/photon/proof.ts';
import {ApplicationError} from '../../../lib/server/errors.ts';
import {applicationOrigin} from '../../../lib/server/config.ts';
import {readJson,privateHeaders} from '../../../lib/server/identity/request-credential.ts';
import type {Credential} from '../../../lib/server/identity/credentials.ts';

export async function imessageBrowser(request:NextRequest,operation:string,credential:Credential,service=new HostIMessage()){
 const secure=applicationOrigin().startsWith('https:'),name=secure?'__Host-fmat-imessage':'fmat-imessage';
 const browser=request.cookies.get(name)?.value;
 const json=(body:unknown)=>NextResponse.json(body,{headers:{...privateHeaders,'cache-control':'private, no-store',vary:'Cookie'}});
 if(operation==='read'&&request.method==='GET')return json(await service.read(credential,browser));
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
 if(operation==='start'||operation==='verify'){
  if(!browser)throw new ApplicationError('CHALLENGE_INVALID',400);
  return json(await service[operation](credential,browser,await readJson(request)));
 }
 if(operation==='cancel'||operation==='unlink')return json(await service[operation](credential,browser,await readJson(request)));
 if(operation==='skip'){z.strictObject({}).parse(await readJson(request));return json(await service.skip(credential,browser));}
 throw new ApplicationError('NOT_FOUND',404);
}
