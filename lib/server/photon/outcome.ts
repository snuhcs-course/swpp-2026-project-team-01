import {ApplicationError} from '../errors.ts';

/** Preserve known provider evidence across one transient receipt-write failure. */
export async function recordPhotonOutcome(write:()=>Promise<unknown>,providerReference:string|null):Promise<void>{
 try{await write();}
 catch(error){
  // The caller closes over the identical lease and outcome. This never retries
  // provider I/O, reacquires authority or treats an expired lease as success.
  if(!providerReference||!(error instanceof ApplicationError)||error.code!=='PROVIDER_UNAVAILABLE')throw error;
  await write();
 }
}
