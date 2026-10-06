import {OAuth2Client} from 'google-auth-library';
import {z} from 'zod';
import {calendarEntry} from '../../contracts/calendar.ts';
import {requiredEnv} from '../config.ts';
import {ApplicationError} from '../errors.ts';
import {calendarScopes,tokenBundle,type TokenBundle} from './google.ts';
export type CalendarEntry=z.infer<typeof calendarEntry>;
export interface CalendarProvider {
  refresh(bundle:TokenBundle):Promise<TokenBundle>;
  list(accessToken:string):Promise<CalendarEntry[]>;
}
export class GoogleCalendarProvider implements CalendarProvider {
  constructor(private readonly env=process.env,private readonly fetcher:typeof fetch=fetch){}
  async refresh(bundle:TokenBundle):Promise<TokenBundle>{
    const client=new OAuth2Client({clientId:requiredEnv('GOOGLE_CLIENT_ID',this.env),clientSecret:requiredEnv('GOOGLE_CLIENT_SECRET',this.env),transporterOptions:{timeout:10_000,retry:false}});
    client.setCredentials({refresh_token:bundle.refreshToken});
    try{
      const {credentials}=await client.refreshAccessToken();
      const refreshed=tokenBundle.parse({...bundle,accessToken:credentials.access_token,refreshToken:credentials.refresh_token??bundle.refreshToken,expiresAt:credentials.expiry_date,scopes:credentials.scope?.split(' ').filter(Boolean)??bundle.scopes});
      if(refreshed.expiresAt<=Date.now()+30_000||calendarScopes.host.filter(s=>s.startsWith('https:')).some(s=>!refreshed.scopes.includes(s)))throw new ApplicationError('RECONNECT_REQUIRED',409);
      return refreshed;
    }catch(error){
      const response=error as {response?:{data?:{error?:string};status?:number}};
      if(error instanceof ApplicationError||response.response?.data?.error==='invalid_grant')throw new ApplicationError('RECONNECT_REQUIRED',409);
      throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
    }
  }
  async list(accessToken:string):Promise<CalendarEntry[]>{
    const entries:CalendarEntry[]=[],seen=new Set<string>(),pages=new Set<string>();let pageToken:string|undefined;
    const signal=AbortSignal.timeout(15_000);
    try{
      for(let page=0;page<10;page++){
        const url=new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
        url.searchParams.set('maxResults','250');url.searchParams.set('showHidden','true');url.searchParams.set('fields','nextPageToken,items(id,summary,summaryOverride,accessRole,primary,timeZone,backgroundColor,deleted)');if(pageToken)url.searchParams.set('pageToken',pageToken);
        const response=await this.fetcher(url,{headers:{authorization:'Bearer '+accessToken},signal,cache:'no-store',redirect:'error'});
        if(response.status===401||response.status===403)throw new ApplicationError('RECONNECT_REQUIRED',409);
        if(!response.ok)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
        const body=z.object({items:z.array(z.object({id:z.string().min(1).max(1024),summary:z.string().max(1024).optional(),summaryOverride:z.string().max(1024).optional(),accessRole:calendarEntry.shape.accessRole,primary:z.boolean().optional(),timeZone:z.string().max(100).optional(),backgroundColor:z.string().optional(),deleted:z.boolean().optional()})).max(250).default([]),nextPageToken:z.string().min(1).max(4096).optional()}).parse(await response.json());
        for(const item of body.items){
          if(item.deleted||seen.has(item.id))continue;seen.add(item.id);
          entries.push(calendarEntry.parse({id:item.id,name:item.summaryOverride??item.summary??item.id,accessRole:item.accessRole,primary:item.primary??false,timeZone:item.timeZone??null,color:/^#[a-f0-9]{6}$/iu.test(item.backgroundColor??'')?item.backgroundColor:null}));
        }
        pageToken=body.nextPageToken;if(!pageToken)return entries;
        if(pages.has(pageToken))throw new ApplicationError('PROVIDER_UNAVAILABLE',503);pages.add(pageToken);
      }
      throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
    }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
  }
}
