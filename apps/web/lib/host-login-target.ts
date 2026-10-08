import {z} from 'zod';
// A navigation hint only. The workspace authorizes the request after login.
export const hostLoginTarget=z.strictObject({requestId:z.uuid(),audience:z.enum(['host_private','request_shared'])});
export const hostLoginStart=z.strictObject({target:hostLoginTarget.optional()});
export function hostLoginPath(value:unknown):string|null{
 const target=hostLoginTarget.safeParse(value);
 return target.success?'/app?request='+target.data.requestId+'&audience='+target.data.audience:null;
}
export function hostLoginCookie(secure:boolean){return (secure?'__Host-':'')+'fmat-host-return';}
export function decodeHostLoginTarget(value:string|undefined):string|null{
 try{return hostLoginPath(JSON.parse(value??''));}catch{return null;}
}
