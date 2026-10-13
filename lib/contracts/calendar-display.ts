import type {CalendarCatalog} from './calendar.ts';
type Calendar=CalendarCatalog['calendars'][number];
export const activeCalendars=(calendars:Calendar[])=>calendars.filter(calendar=>calendar.active!==false);
export function calendarLabel(calendar:Calendar,calendars:Calendar[]){
 const email=(value:string)=>/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value);
 const name=(entry:Calendar)=>{
  const title=entry.name.trim();
  if(title&&!/^(?:[a-z][a-z\d+.-]*:\/\/|www\.)/i.test(title)&&(title!==entry.id||email(title)))return title;
  return email(entry.id)?entry.id:'Calendar';
 };
 const label=name(calendar),matches=calendars.filter(entry=>name(entry)===label);
 return matches.length>1?`${label} (${matches.findIndex(entry=>entry.id===calendar.id)+1})`:label;
}
