import type {CalendarCatalog} from '../../../lib/contracts/calendar';
type Calendar=CalendarCatalog['calendars'][number];
export const activeCalendars=(calendars:Calendar[])=>calendars.filter(calendar=>calendar.active!==false);
export function calendarLabel(calendar:Calendar,calendars:Calendar[]){
 const name=(entry:Calendar)=>entry.name.trim()&&entry.name!==entry.id&&!/^https?:\/\//i.test(entry.name.trim())?entry.name:entry.primary?'Primary calendar':'Untitled calendar';
 const label=name(calendar),matches=calendars.filter(entry=>name(entry)===label);
 return matches.length>1?`${label} (${matches.findIndex(entry=>entry.id===calendar.id)+1})`:label;
}
