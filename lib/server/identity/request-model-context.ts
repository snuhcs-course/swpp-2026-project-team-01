import {ApplicationError} from '../errors.ts';

/** Minimize reserved structured contact fields after audience authorization.
 * This is not free-text redaction or an authorization/credential filter. */
export function requestModelContext(value:unknown,depth=0):unknown{
 if(depth>32)throw new ApplicationError('INTERNAL_ERROR',500);
 if(value===null||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(item=>requestModelContext(item,depth+1));
 const source=value as Record<string,unknown>,entries:[string,unknown][]=[];
 for(const [key,item] of Object.entries(source)){
  if(key==='requesterName'||key==='requesterEmail'){
   if(typeof item!=='string')throw new ApplicationError('INTERNAL_ERROR',500);
   entries.push([key+'Provided',item.trim().length>0]);
  }else if(!((key==='requesterNameProvided'&&Object.hasOwn(source,'requesterName'))||
    (key==='requesterEmailProvided'&&Object.hasOwn(source,'requesterEmail')))){
   entries.push([key,requestModelContext(item,depth+1)]);
  }
 }
 return Object.fromEntries(entries);
}
