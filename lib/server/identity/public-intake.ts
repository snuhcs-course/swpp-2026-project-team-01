import {createHash} from 'node:crypto';
import {publicHandle,intakeDetails,intakeProof,intakeContinuation} from '../../contracts/intake.ts';
import {Database} from '../database/client.ts';
import {GoogleCalendarProvider,type CalendarProvider} from '../calendar/catalog.ts';
import {checkIntakeReadiness} from './intake-readiness.ts';

export class PublicIntake {
 constructor(private readonly database:Pick<Database,'rpc'>=new Database(),private readonly env=process.env,private readonly provider:CalendarProvider=new GoogleCalendarProvider(env)){}
 private call(operation:string,handle:string,token:string|null,input:Record<string,unknown>={}){
  return this.database.rpc('fmat_public_intake',{p_operation:operation,p_token_hash:token===null?null:createHash('sha256').update(intakeProof.parse(token)).digest('hex'),p_input:{...input,handle:publicHandle.parse(handle)}});
 }
 private async current(handle:string){
  return checkIntakeReadiness(await this.call('context',handle,null),{
   refresh:input=>this.call('refresh',handle,null,input),
   check:input=>this.call('check',handle,null,input),
  },this.provider,this.env);
 }
 async profile(handle:string){return (await this.current(handle)).profile;}
 async resume(handle:string,token:string){return intakeContinuation.nullable().parse(await this.call('resume',handle,token));}
 async create(handle:string,token:string,input:unknown){
  const details=intakeDetails.parse(input);
  // Replay a committed request without requiring Google to be available again.
  const replay=intakeContinuation.nullable().parse(await this.call('replay',handle,token,{details}));
  if(replay)return replay;
  const {version}=await this.current(handle);
  return intakeContinuation.parse(await this.call('create',handle,token,{...version,details}));
 }
}
