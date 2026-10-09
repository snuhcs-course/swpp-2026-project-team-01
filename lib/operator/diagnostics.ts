import {diagnosticInput,operationalSnapshot} from '../contracts/operational-diagnostics.ts';
import {Database} from '../server/database/client.ts';
import {ApplicationError} from '../server/errors.ts';
import {operatorConfiguration} from './configuration.ts';

export function diagnosticArguments(args:string[]){
 const values:Record<string,unknown>={};
 if(args.length%2)throw new ApplicationError('INVALID_INPUT',400);
 for(let i=0;i<args.length;i+=2){
  const name=args[i]==='--project'?'project':args[i]==='--samples'?'sampleLimit':null;
  if(!name||name in values||!args[i+1])throw new ApplicationError('INVALID_INPUT',400);
  if(name==='sampleLimit'&&!/^(?:0|[1-9][0-9]?)$/u.test(args[i+1]))throw new ApplicationError('INVALID_INPUT',400);
  values[name]=name==='sampleLimit'?Number(args[i+1]):args[i+1];
 }
 const parsed=diagnosticInput.safeParse(values);
 if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
 return parsed.data;
}
export class OperatorDiagnostics{
 constructor(private readonly env=process.env,private readonly database=new Database(env)){}
 async inspect(input:unknown){
  const parsed=diagnosticInput.safeParse(input);
  if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
  const {project,sampleLimit}=parsed.data;operatorConfiguration(project,this.env);
  const snapshot=operationalSnapshot.safeParse(await this.database.rpc('fmat_operational_snapshot',{p_sample_limit:sampleLimit}));
  if(!snapshot.success||snapshot.data.sampleLimit!==sampleLimit)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return {project,...snapshot.data};
 }
}
