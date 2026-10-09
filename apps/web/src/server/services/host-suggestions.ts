// AI-generated with Claude Code (claude-opus-5-5), 2026-10-06
import { normalizeCalendarEvents } from '@/core/calendar'
import type { AnalysisEvent, Classification } from '@/core/analysis'
import { suggestHostSetup, type HostSuggestions } from '@/core/host-suggestions'
import { DAY_MS, kstDayStart } from '@/core/time'
import { CLASSIFICATION_SCHEMA_VERSION } from '@/llm/classify'
import { all, type Db } from '../db/client'
import { listMeetingTypes, listPlaces } from '../repos/hosting'
import { readCalendarConnection, readScheduleSources } from './calendar-sync'

/** Suggestions from the same eight weeks the history analysis reads. `available` is false until a calendar has been imported. */
export async function hostSuggestions(db: Db, userId: string): Promise<HostSuggestions & { available: boolean }> {
 const calendar = await readCalendarConnection(db, userId), snapshot = calendar.analysis
 if (!snapshot || calendar.status !== 'connected') return { available: false, basedOn: 0, places: [], meetingTypes: [] }
 const fromMs = kstDayStart(snapshot.startedAt) - 56 * DAY_MS, toMs = kstDayStart(snapshot.startedAt)
 // The newest AI label for exactly this content under the current labelling rules (rows come oldest first, so later ones win).
 const labels = new Map((await all<{ calendar_id: string; provider_event_id: string; proposal_json: string }>(db, `SELECT k.calendar_id, k.provider_event_id, k.proposal_json FROM event_classifications k
  JOIN calendar_connections c ON c.id = k.connection_id
  JOIN imported_events e ON e.snapshot_id = c.analysis_snapshot_id AND e.calendar_id = k.calendar_id AND e.provider_event_id = k.provider_event_id AND e.content_fingerprint = k.content_fingerprint
  WHERE c.user_id = ? AND k.schema_version = ? ORDER BY k.seq`, [userId, CLASSIFICATION_SCHEMA_VERSION])).map(r => [JSON.stringify([r.calendar_id, r.provider_event_id]), JSON.parse(r.proposal_json).classification as Classification]))
 const events: AnalysisEvent[] = normalizeCalendarEvents(await readScheduleSources(db, userId, 'analysis')).analysisEvents
  .filter(e => e.startMs >= fromMs && e.startMs < toMs)
  .map(e => ({ ...e, classification: e.sourceKeys.map(k => labels.get(k)).find(Boolean) }))
 return { available: true, ...suggestHostSetup(events, { places: await listPlaces(db, userId), meetingTypes: await listMeetingTypes(db, userId) }) }
}
