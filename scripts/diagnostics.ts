import {diagnosticArguments,OperatorDiagnostics} from '../lib/operator/diagnostics.ts';
import {ApplicationError} from '../lib/server/errors.ts';
const args=process.argv.slice(2);
try{
 if(args.length===1&&args[0]==='--help')console.log('Usage: npm run --silent diagnostics -- --project <ref|local> [--contacts] [--samples <0-20>] | --project <ref|local> --rejections\nRead-only persisted-state, native contact-sharing or best-effort database rejection snapshot. Credentials come from the server environment.\nRejection mode has no samples. Device delivery, contact saving and release readiness are not inferred.');
 else console.log(JSON.stringify(await new OperatorDiagnostics().inspect(diagnosticArguments(args))));
}catch(error){
 console.error(JSON.stringify({error:error instanceof ApplicationError?error.code:'PROVIDER_UNAVAILABLE'}));process.exitCode=1;
}
