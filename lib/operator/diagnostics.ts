import {diagnosticInput,operationalSnapshot} from '../contracts/operational-diagnostics.ts';
import {Database} from '../server/database/client.ts';
import {ApplicationError} from '../server/errors.ts';
import {operatorConfiguration} from './configuration.ts';
import {z} from 'zod';
import {rejectionSnapshot} from '../contracts/rejection-observations.ts';

const inspectionInput=z.union([diagnosticInput,z.strictObject({project:diagnosticInput.shape.project,rejections:z.literal(true)})]);

export function diagnosticArguments(args:string[]){
 const values:Record<string,unknown>={};
 for(let i=0;i<args.length;){
  if(args[i]==='--rejections'){
   if('rejections' in values)throw new ApplicationError('INVALID_INPUT',400);
   values.rejections=true;i++;continue;
  }
  const name=args[i]==='--project'?'project':args[i]==='--samples'?'sampleLimit':null;
  if(!name||name in values||!args[i+1])throw new ApplicationError('INVALID_INPUT',400);
  if(name==='sampleLimit'&&!/^(?:0|[1-9][0-9]?)$/u.test(args[i+1]))throw new ApplicationError('INVALID_INPUT',400);
  values[name]=name==='sampleLimit'?Number(args[i+1]):args[i+1];
  i+=2;
 }
 const parsed=inspectionInput.safeParse(values);
 if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
 return parsed.data;
}
export class OperatorDiagnostics{
 constructor(private readonly env=process.env,private readonly database=new Database(env)){}
 async inspect(input:unknown){
  const parsed=inspectionInput.safeParse(input);
  if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
  const {project}=parsed.data;operatorConfiguration(project,this.env);
  if('rejections' in parsed.data){
   const snapshot=rejectionSnapshot.safeParse(await this.database.rpc('fmat_rejection_snapshot',{}));
   if(!snapshot.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
   return {project,...snapshot.data};
  }
  const {sampleLimit}=parsed.data;
  const snapshot=operationalSnapshot.safeParse(await this.database.rpc('fmat_operational_snapshot',{p_sample_limit:sampleLimit}));
  if(!snapshot.success||snapshot.data.sampleLimit!==sampleLimit)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return {project,...snapshot.data};
 }
}
