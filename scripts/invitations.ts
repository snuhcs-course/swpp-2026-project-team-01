import {invitationIssueInput,invitationStatusInput,invitationRevokeInput} from '../lib/server/identity/invitations.ts';
import {InvitationOperator,invitationOperatorConfiguration} from '../lib/server/identity/invitation-operator.ts';
import {ApplicationError} from '../lib/server/errors.ts';
import {ArtifactFailure,privateArtifact} from '../lib/operator/private-artifact.ts';
const usage=`Usage: npm run --silent invitations -- <issue|status|revoke|recover> --project <ref|local> --operator <audit-id> [options]
issue: --email <recipient> --key <uuid> [--delivery <cloudflare|manual>] [--output <absolute-private-file>]
status: --invitation <uuid>
revoke: --invitation <uuid> --key <uuid>
recover: --invitation <uuid> --output <absolute-private-file>
Manual issuance requires --output. Output must be new, under an owner-only 0700 directory.
Credentials and INVITATION_CODE_KEY come from the server environment, never arguments.`;
let artifact:Awaited<ReturnType<typeof privateArtifact>>|undefined;
let diagnostic:Record<string,string>={};
try{
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--help')console.log(usage);
 else{
  const action=args.shift(),values:Record<string,string>={},names:Record<string,string>={'--project':'project','--operator':'operator','--email':'email','--key':'idempotencyKey','--delivery':'delivery','--output':'output','--invitation':'invitationId'};
  if(!action||!['issue','status','revoke','recover'].includes(action)||args.length%2)throw Error();
  for(let i=0;i<args.length;i+=2){const name=names[args[i]];if(!name||name in values||!args[i+1]||args[i+1].startsWith('--'))throw Error();values[name]=args[i+1];}
  const {output,...input}=values,parsed=(action==='issue'?invitationIssueInput:action==='revoke'?invitationRevokeInput:invitationStatusInput).safeParse(input);if(!parsed.success)throw Error();
  const command=parsed.data,manual=action==='recover'||(action==='issue'&&'delivery'in command&&command.delivery==='manual');
  if(manual?!output:output!==undefined)throw Error();
  diagnostic={action,project:command.project,...('idempotencyKey'in command?{idempotencyKey:command.idempotencyKey}:{}),...('invitationId'in command?{invitationId:command.invitationId}:{})};
  invitationOperatorConfiguration(command.project);
  if(manual)artifact=await privateArtifact(output);
  const service=new InvitationOperator();
  if(action==='recover'){
   const recovered=await service.recover(command);await artifact!.write(recovered);
   console.log(JSON.stringify({action,project:command.project,invitationId:recovered.invitationId,expiresAt:recovered.expiresAt,output}));
  }else{
   const result=action==='issue'?await service.issue(command):action==='revoke'?await service.revoke(command):await service.status(command);
   diagnostic.invitationId=result.invitationId;
   if(manual){const recovered=await service.recover({project:command.project,operator:command.operator,invitationId:result.invitationId});await artifact!.write(recovered);}
   console.log(JSON.stringify({action,...result,...(output?{output}:{})}));
  }
 }
}catch(error){console.error(JSON.stringify({...diagnostic,error:error instanceof ApplicationError?error.code:error instanceof ArtifactFailure?error.message:'INVALID_INPUT'}));process.exitCode=1;}
finally{try{await artifact?.close();}catch{console.error(JSON.stringify({error:'PRIVATE_OUTPUT_UNAVAILABLE'}));process.exitCode=1;}}
