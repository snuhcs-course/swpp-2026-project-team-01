import {Temporal} from '@js-temporal/polyfill';
export function localTimeToInstant(value:string,timezone:string):string {
  try{return Temporal.PlainDateTime.from(value).toZonedDateTime(timezone,{disambiguation:'reject'}).toInstant().toString();}
  catch{throw new Error('This local time is invalid or occurs twice during a clock change. Choose an unambiguous time and check the timezone.');}
}
export function instantToLocalTime(value:string,timezone:string):string{return Temporal.Instant.from(value).toZonedDateTimeISO(timezone).toPlainDateTime().toString({smallestUnit:'minute'});}
