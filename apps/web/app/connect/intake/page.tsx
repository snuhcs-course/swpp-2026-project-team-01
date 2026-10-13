import {z} from 'zod';
import {AgentIntakeAccess} from '../../../components/agent-intake-access.tsx';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,id=z.uuid().safeParse(params.authorizationId);
 if(!id.success)return <main className="workspace"><section className="workspace-content"><h1>Request access unavailable.</h1><p>Open the request access link from your agent in the browser where you granted consent.</p></section></main>;
 return <AgentIntakeAccess authorizationId={id.data}/>;
}
