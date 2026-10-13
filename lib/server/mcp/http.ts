import {AgentIntake} from '../oauth/intake.ts';
import {agentIntakeTools} from '../../contracts/agent-intake.ts';
import {relayAgentHistory} from '../oauth/history-relay.ts';
import {McpServer,WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {agentToolsForActor,agentToolCommand,agentToolScope} from '../../contracts/agent-tools.ts';
import {applicationOrigin} from '../config.ts';
import {ApplicationError,publicError} from '../errors.ts';
import {AgentCredentials} from '../oauth/credentials.ts';
import {AgentOperations} from '../oauth/operations.ts';
import {AgentOAuthError} from '../oauth/protocol.ts';
import {oauthJson,readOAuthBody} from '../oauth/http.ts';

function allowedOrigins(env:NodeJS.ProcessEnv):Set<string>{
 const origins=new Set([applicationOrigin(env)]);
 if(env.MCP_ALLOWED_ORIGINS){
  let parsed:unknown;try{parsed=JSON.parse(env.MCP_ALLOWED_ORIGINS);}catch{throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);}
  const values=z.array(z.string()).max(20).safeParse(parsed);
  if(!values.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  for(const value of values.data){
   const canonical=applicationOrigin({...env,APP_ORIGIN:value});
   if(canonical!==value)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
   origins.add(value);
  }
 }
 return origins;
}
/** Fresh SDK server per request: no process-global session can carry authority. */
export function agentMcpHttp(env=process.env,credentials:Pick<AgentCredentials,'verify'>=new AgentCredentials(env),operations:Pick<AgentOperations,'execute'>=new AgentOperations(),intake:Pick<AgentIntake,'context'|'create'>=new AgentIntake(undefined,env)){
 return async(request:Request):Promise<Response>=>{
  let origin:string|undefined,allowedOrigin:string|undefined,server:McpServer|undefined;
  const finish=(response:Response)=>{
   response.headers.set('cache-control','private, no-store');response.headers.set('pragma','no-cache');
   response.headers.set('x-content-type-options','nosniff');response.headers.set('referrer-policy','no-referrer');
   response.headers.set('vary','Origin, Authorization');
   if(allowedOrigin){response.headers.set('access-control-allow-origin',allowedOrigin);response.headers.set('access-control-expose-headers','WWW-Authenticate, MCP-Protocol-Version');}
   return response;
  };
  const challenge=(code?:string,scope?:string)=>{
   const response=oauthJson({error:code??'unauthorized'},scope?403:401);
   response.headers.set('www-authenticate',`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"${code?`, error="${code}"`:''}${scope?`, scope="${scope}"`:''}`);
   return finish(response);
  };
  try{
   origin=applicationOrigin(env);const origins=allowedOrigins(env),suppliedOrigin=request.headers.get('origin');
   if(suppliedOrigin!==null){if(!origins.has(suppliedOrigin))return finish(oauthJson({error:'forbidden_origin'},403));allowedOrigin=suppliedOrigin;}
   if(new URL(request.url).search)return finish(oauthJson({error:'invalid_request'},400));
   if(request.method==='OPTIONS'){
    const method=request.headers.get('access-control-request-method');
    const headers=(request.headers.get('access-control-request-headers')??'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
    if(method!=='POST'||headers.some(h=>!['authorization','content-type','accept','mcp-protocol-version','mcp-session-id'].includes(h)))return finish(oauthJson({error:'invalid_request'},400));
    return finish(new Response(null,{status:204,headers:{'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id'}}));
   }
   const authorization=request.headers.get('authorization')??'';
   if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/iu.test(authorization)||authorization.length>8192)return challenge(authorization?'invalid_token':undefined);
   const credential=await credentials.verify(authorization.slice(7));
   if(request.method!=='POST')return finish(new Response(null,{status:405,headers:{allow:'POST, OPTIONS'}}));
   const raw=await readOAuthBody(request,'json');let body:unknown;
   try{body=JSON.parse(raw);}catch{return finish(oauthJson({error:'invalid_request'},400));}
   // No JSON-RPC batches: one authorized operation per bounded HTTP request.
   if(!body||typeof body!=='object'||Array.isArray(body))return finish(oauthJson({error:'invalid_request'},400));
   // Discovery describes capabilities, not current request authority. Pending
   // intakes can call only intake tools; SQL denies every unbound request call.
   const actor=credential.claims.actor_kind==='intake'?'guest':credential.claims.actor_kind;
   const tools=agentToolsForActor(actor);
   const intakeTools=credential.claims.actor_kind==='intake'?agentIntakeTools:[];
   const call=z.object({method:z.literal('tools/call'),params:z.object({name:z.string()})}).safeParse(body);
   if(call.success){const tool=tools.find(t=>t.name===call.data.params.name);if(tool){const scope=agentToolScope(tool,actor);if(!credential.claims.scope.split(' ').includes(scope))return challenge('insufficient_scope',scope);}}
   if(call.success&&intakeTools.some(t=>t.name===call.data.params.name)&&!credential.claims.scope.split(' ').includes('request:intake'))return challenge('insufficient_scope','request:intake');
   server=new McpServer({name:'find-me-a-time',version:'0.1.0'});
   for(const tool of intakeTools)server.registerTool(tool.name,{
    title:tool.title,description:tool.description,inputSchema:tool.inputSchema,
    outputSchema:z.object({result:tool.outputSchema}),
    annotations:{readOnlyHint:tool.readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:false},
   },async (input:unknown)=>{
    try{
     const result=tool.outputSchema.parse(tool.name==='fmat_get_intake_context'?await intake.context(credential):await intake.create(credential,input));
     const structuredContent={result};return {content:[{type:'text' as const,text:JSON.stringify(structuredContent)}],structuredContent};
    }catch(error){
     const safe=error instanceof AgentOAuthError?{error:{code:error.code,message:'Reconnect the agent and review its requested permissions.'}}:publicError(error).body;
     return {isError:true,content:[{type:'text' as const,text:JSON.stringify(safe)}]};
    }
   });
   for(const tool of tools)server.registerTool(tool.name,{
    title:tool.title,description:tool.description,inputSchema:tool.inputSchema,
    outputSchema:z.object({result:z.unknown()}),annotations:tool.annotations,
   },async input=>{
    try{
     const command=agentToolCommand(tool.name,input);
     const result=command.operation==='conversation_read'
      ?await relayAgentHistory(command.input,authorization.slice(7),request.signal,env)
      :await operations.execute(credential,command);
     const structuredContent={result};return {content:[{type:'text' as const,text:JSON.stringify(structuredContent)}],structuredContent};
    }catch(error){
     const safe=error instanceof AgentOAuthError?{error:{code:error.code,message:'Reconnect the agent and review its requested permissions.'}}:publicError(error).body;
     return {isError:true,content:[{type:'text' as const,text:JSON.stringify(safe)}]};
    }
   });
   const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:16384});
   await server.connect(transport);
   return finish(await transport.handleRequest(request,{parsedBody:body}));
  }catch(error){
   if(error instanceof AgentOAuthError){if(error.code==='invalid_token'||error.code==='invalid_grant')return challenge('invalid_token');return finish(oauthJson({error:error.code},error.status));}
   const safe=publicError(error);return finish(oauthJson(safe.body,safe.status));
  }finally{await server?.close();}
 };
}
