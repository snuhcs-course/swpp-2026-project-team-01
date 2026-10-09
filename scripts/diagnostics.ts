import {diagnosticArguments,OperatorDiagnostics} from '../lib/operator/diagnostics.ts';
import {ApplicationError} from '../lib/server/errors.ts';
const args=process.argv.slice(2);
try{
 if(args.length===1&&args[0]==='--help')console.log('Usage: npm run --silent diagnostics -- --project <ref|local> [--samples <0-20>]\nRead-only persisted-state snapshot. Credentials come from the server environment.\nMissing telemetry and release readiness are explicitly not assessed.');
 else console.log(JSON.stringify(await new OperatorDiagnostics().inspect(diagnosticArguments(args))));
}catch(error){
 console.error(JSON.stringify({error:error instanceof ApplicationError?error.code:'PROVIDER_UNAVAILABLE'}));process.exitCode=1;
}
