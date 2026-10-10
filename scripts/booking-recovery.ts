import {BookingRecovery,recoveryInput} from '../lib/server/booking/recovery.ts';
import {ApplicationError} from '../lib/server/errors.ts';

const usage='Usage: npm run booking:recover -- --project <ref|local> --operator <audit-id> --request <uuid> --action <retry|reconcile> --key <uuid>';
try{
 const args=process.argv.slice(2),values:Record<string,string>={},names:Record<string,string>={'--project':'project','--operator':'operator','--request':'requestId','--action':'action','--key':'idempotencyKey'};
 if(args.length===1&&args[0]==='--help'){console.log(usage);}
 else{
  if(args.length!==10)throw new Error('USAGE');
  for(let i=0;i<args.length;i+=2){const name=names[args[i]];if(!name||name in values)throw new Error('USAGE');values[name]=args[i+1];}
  const parsed=recoveryInput.safeParse(values);if(!parsed.success)throw new Error('USAGE');
  console.log(JSON.stringify(await new BookingRecovery().run(parsed.data)));
 }
}catch(error){
 // Never expose credential, SQL, response body or provider details on failure.
 console.error(error instanceof ApplicationError?JSON.stringify({error:error.code,message:error.message}):usage);
 process.exitCode=1;
}
