import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
export const ianaTimezone=z.string().min(1).max(100).refine(value=>{
 if(/^[+-]/u.test(value))return false;
 try{Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value);return true;}catch{return false;}
},'Choose an IANA timezone.');
/** Offset-free local input must never silently pick a side of a clock change. */
export function localTimeToInstant(value:string,timezone:string):string {
 try{
  ianaTimezone.parse(timezone);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/u.test(value))throw new Error();
  return Temporal.PlainDateTime.from(value,{overflow:'reject'}).toZonedDateTime(timezone,{disambiguation:'reject'}).toInstant().toString();
 }catch{throw new Error('This local time is invalid or occurs twice during a clock change. Choose an unambiguous time and check the timezone.');}
}
export function instantToLocalTime(value:string,timezone:string):string{
 return Temporal.Instant.from(value).toZonedDateTimeISO(ianaTimezone.parse(timezone)).toPlainDateTime().toString({smallestUnit:'minute'});
}
