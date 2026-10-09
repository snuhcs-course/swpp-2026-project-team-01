// AI-generated with Codex (gpt-6-astra), 2026-10-05
import { z } from 'zod'
import { DomainError } from '@/contracts/common'
const page = z.object({items:z.array(z.unknown()).default([]),nextPageToken:z.string().min(1).optional()})
export interface CalendarProvider {
 listCalendars(connectionId:string,input:{pageToken?:string}):Promise<{items:unknown[];nextPageToken?:string}>
 listEvents(connectionId:string,calendarId:string,input:{fromMs:number;toMs:number;pageToken?:string}):Promise<{items:unknown[];nextPageToken?:string}>
 freeBusy(connectionId:string,calendarIds:string[],input:{fromMs:number;toMs:number}):Promise<unknown>
}
export class GoogleCalendarProvider implements CalendarProvider {
 constructor(private options:{accessToken:(connectionId:string)=>Promise<string>;fetch?:typeof fetch;now?:()=>number}){}
 private async request(connectionId:string,path:string,body?:unknown):Promise<unknown> {
  for(let attempt=0;attempt<2;attempt++) {
   const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
   try {
    return await Promise.race([
     (async()=>{
      const access=await this.options.accessToken(connectionId)
      const result=await (this.options.fetch??fetch)(`https://www.googleapis.com/calendar/v3/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${access}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:abort.signal})
      if(result.status===401||result.status===403)throw new DomainError('calendar_reconnect_required','Calendar 읽기 권한을 다시 연결해 주세요')
      if(!result.ok)throw new DomainError('calendar_fetch_failed','Calendar를 가져오지 못했어요',result.status===429||result.status>=500)
      try{return await result.json()}catch{throw new DomainError('calendar_fetch_failed','Calendar 응답을 확인할 수 없어요',true)}
     })(),
     new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new DomainError('operation_timeout','Calendar 응답 시간이 초과됐어요',true))},15000)}),
    ])
   } catch(e) {
    const error=e instanceof DomainError?e:new DomainError('calendar_fetch_failed','Calendar에 연결하지 못했어요',true)
    if(attempt===1||!error.retryable)throw error
   } finally {if(timer)clearTimeout(timer);abort.abort()}
  }
  throw new DomainError('calendar_fetch_failed','Calendar를 가져오지 못했어요',true)
 }
 private parsePage(raw:unknown) {const result=page.safeParse(raw);if(!result.success)throw new DomainError('calendar_fetch_failed','Calendar 응답을 확인할 수 없어요',true);return result.data}
 async listCalendars(connectionId:string,input:{pageToken?:string}) {
  const query=new URLSearchParams({maxResults:'250',...(input.pageToken?{pageToken:input.pageToken}:{})})
  return this.parsePage(await this.request(connectionId,`users/me/calendarList?${query}`))
 }
 async listEvents(connectionId:string,calendarId:string,input:{fromMs:number;toMs:number;pageToken?:string}) {
  const query=new URLSearchParams({singleEvents:'true',showDeleted:'false',maxResults:'2500',timeMin:new Date(input.fromMs).toISOString(),timeMax:new Date(input.toMs).toISOString(),...(input.pageToken?{pageToken:input.pageToken}:{})})
  return this.parsePage(await this.request(connectionId,`calendars/${encodeURIComponent(calendarId)}/events?${query}`))
 }
 async freeBusy(connectionId:string,calendarIds:string[],input:{fromMs:number;toMs:number}) {
  return this.request(connectionId,'freeBusy',{timeMin:new Date(input.fromMs).toISOString(),timeMax:new Date(input.toMs).toISOString(),items:calendarIds.map(id=>({id}))})
 }
}
