import {Temporal} from '@js-temporal/polyfill';
import type {CalendarCatalog} from '../../../lib/contracts/calendar';
import type {SetupState} from '../../../lib/contracts/setup';

/** Reuse confirmed conflict choices; never silently narrow the scan. */
export function automaticAnalysisScope(setup:SetupState,catalog:CalendarCatalog,fallbackZone:string,now=Date.now()){
 const calendarIds=catalog.conflictCalendarIds;
 if(!setup.calendarSelected||!catalog.bookingCalendarId||!calendarIds.length)throw new Error('Choose your calendars first.');
 if(calendarIds.length>10)throw new Error('I can analyze up to 10 calendars at once. Adjust the analysis scope or choose preferences manually.');
 if(calendarIds.some(id=>!catalog.calendars.some(c=>c.id===id&&c.accessRole!=='freeBusyReader')))throw new Error('I can’t read events from every selected calendar. Reconnect Google or choose preferences manually.');
 const timezone=setup.draft?.settings.rules?.timezone??setup.confirmed.rules?.timezone??catalog.calendars.find(c=>c.id===catalog.bookingCalendarId)?.timeZone??fallbackZone;
 const today=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timezone).toPlainDate();
 return {calendarIds:[...calendarIds],startDate:today.subtract({days:28}).toString(),endDate:today.add({days:28}).toString(),timezone};
}
