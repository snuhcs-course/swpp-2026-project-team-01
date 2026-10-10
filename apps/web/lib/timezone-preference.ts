import {ianaTimezone} from '../../../lib/contracts/time.ts';
export const timezonePreferenceKey='fmat-display-timezone-v1';
export function validTimezone(value:string){return ianaTimezone.safeParse(value).success;}
export function detectedTimezone(){try{const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;return validTimezone(zone)?zone:'';}catch{return '';}}
// Only a display preference is stored: never identity, request IDs, or credentials.
export function readTimezonePreference():string|null{
 try{const value=sessionStorage.getItem(timezonePreferenceKey);return value===null?null:validTimezone(value)?value:'';}catch{return null;}
}
export function saveTimezonePreference(value:string):boolean{
 try{sessionStorage.setItem(timezonePreferenceKey,validTimezone(value)?value:'');return true;}catch{return false;}
}
export function intervalLabel(start:string,end:string,timezone:string){
 if(!validTimezone(timezone))return 'Choose an IANA timezone to display these times.';
 try{const format=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'shortOffset',timeZone:timezone});return `${format.format(new Date(start))} – ${format.format(new Date(end))}`;}
 catch{return 'Time details need review. Refresh before choosing a time.';}
}
