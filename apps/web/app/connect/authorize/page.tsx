import {z} from 'zod';
import {AgentConsent} from '../../../components/agent-consent.tsx';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,id=z.uuid().safeParse(params.authorizationId),request=z.uuid().safeParse(params.requestId);
 if(params.authorizationId!==undefined&&!id.success||params.requestId!==undefined&&!request.success)return <main className="workspace"><section className="workspace-content"><h1>Connection unavailable.</h1><p>Start again from your agent or your private meeting link.</p></section></main>;
 return <AgentConsent authorizationId={id.success?id.data:null} initialRequestId={request.success?request.data:undefined} loginExpired={params.auth==='expired'}/>;
}
