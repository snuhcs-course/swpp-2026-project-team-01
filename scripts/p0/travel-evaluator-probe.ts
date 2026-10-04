/**
 * Opt-in, billable P0 probe for the production Routes adapter and deterministic evaluator.
 *
 * Public Seoul landmarks only. The probe makes at most 12 Routes API requests and never
 * prints the API key. Run from the repository root:
 *
 * FMAT_LIVE_TRAVEL_PROBE=1 deno run --env-file=.env \
 *   --allow-env=FMAT_LIVE_TRAVEL_PROBE,GOOGLE_ROUTES_API_KEY,GOOGLE_MAPS_API_KEY \
 *   --allow-net=routes.googleapis.com scripts/p0/travel-evaluator-probe.ts
 */
import { createRoutes } from '../../supabase/functions/_shared/providers/calendar.ts';
import type { Environment } from '../../supabase/functions/_shared/env.ts';
import {
  evaluateSlot,
  type SchedulingInput,
  type SlotEvaluation,
  travelAllowanceContext,
} from '../../supabase/functions/_shared/modules/scheduling/index.ts';
import type { HostRules, TimeWindow } from '../../packages/contracts/index.ts';

const MODES = ['DRIVE', 'WALK', 'TRANSIT'] as const;
const MAX_BILLABLE_CALLS = 12;
const BUFFER_MINUTES = 10;
const WIDE_GAP_MINUTES = 120;
const TIGHT_GAP_MINUTES = 15;
const MANUAL_MINUTES = 20;

const LANDMARKS = {
  previous: 'Seoul City Hall, 110 Sejong-daero, Jung-gu, Seoul, South Korea',
  candidate: 'Seoul Station, 405 Hangang-daero, Yongsan-gu, Seoul, South Korea',
  next: 'N Seoul Tower, 105 Namsangongwon-gil, Yongsan-gu, Seoul, South Korea',
} as const;

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}

function futureSlot(): TimeWindow {
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function at(iso: string, deltaMinutes: number): string {
  return new Date(new Date(iso).getTime() + deltaMinutes * 60 * 1_000).toISOString();
}

function input(
  mode: HostRules['travelMode'],
  slot: TimeWindow,
  gapMinutes: number,
): SchedulingInput {
  return {
    rules: {
      timezone: 'UTC',
      durationMinutes: 30,
      availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '24:00' }],
      focusBlocks: [],
      bufferMinutes: BUFFER_MINUTES,
      travelMode: mode,
      preferences: '',
    },
    details: {
      requesterName: 'P0 synthetic probe',
      requesterEmail: 'probe@example.invalid',
      purpose: 'Public-landmark travel compatibility probe',
      durationMinutes: 30,
      timezone: 'UTC',
      windows: [slot],
      mode: 'in_person',
      location: LANDMARKS.candidate,
    },
    hostEvents: [
      {
        id: 'public-landmark-before',
        start: at(slot.start, -gapMinutes - 30),
        end: at(slot.start, -gapMinutes),
        mode: 'in_person',
        location: LANDMARKS.previous,
      },
      {
        id: 'public-landmark-after',
        start: at(slot.end, gapMinutes),
        end: at(slot.end, gapMinutes + 30),
        mode: 'in_person',
        location: LANDMARKS.next,
      },
    ],
    hostId: 'p0-public-landmark-probe',
    rulesVersion: 1,
  };
}

function summarize(result: SlotEvaluation) {
  return {
    feasible: result.feasible,
    unresolved: result.unresolved,
    diagnostics: result.privateDiagnostics.map(({ code, edge }) => ({ code, edge })),
    trips: result.privateTravelChecks.map((trip) => ({
      edge: trip.edge,
      source: trip.source,
      durationMinutes: Number(trip.durationMinutes.toFixed(3)),
      bufferMinutes: trip.bufferMinutes,
      gapMinutes: trip.gapMinutes,
    })),
  };
}

function withFreshManualAllowances(value: SchedulingInput, slot: TimeWindow): SchedulingInput {
  const confirmedAt = new Date().toISOString();
  const manualTravelAllowances = (['before', 'after'] as const).map((edge) => {
    const context = travelAllowanceContext(value, slot, edge);
    if (!context) fail(`Could not build ${edge} manual allowance context`);
    return {
      id: `p0-${value.rules.travelMode.toLowerCase()}-${edge}`,
      hostId: value.hostId!,
      confirmedAt,
      durationMinutes: MANUAL_MINUTES,
      context,
    };
  });
  return { ...value, manualTravelAllowances };
}

if (Deno.env.get('FMAT_LIVE_TRAVEL_PROBE') !== '1') {
  fail('Refusing billable probe: set FMAT_LIVE_TRAVEL_PROBE=1 explicitly.');
}
const routesKey = Deno.env.get('GOOGLE_ROUTES_API_KEY') || Deno.env.get('GOOGLE_MAPS_API_KEY');
if (!routesKey) fail('GOOGLE_ROUTES_API_KEY or GOOGLE_MAPS_API_KEY is required.');

const slot = futureSlot();
let billableCalls = 0;
const adapter = createRoutes({ routesKey } as Environment);
const route: NonNullable<SchedulingInput['route']> = async (query) => {
  if (billableCalls >= MAX_BILLABLE_CALLS) return null;
  billableCalls++;
  return await adapter(query);
};

const modes: Record<string, unknown> = {};
for (const mode of MODES) {
  const wide = input(mode, slot, WIDE_GAP_MINUTES);
  wide.route = route;
  const enough = await evaluateSlot(wide, slot);

  const tight = input(mode, slot, TIGHT_GAP_MINUTES);
  tight.route = route;
  const tightResult = await evaluateSlot(tight, slot);

  const result: Record<string, unknown> = {
    enough_gap: summarize(enough),
    tight_gap: summarize(tightResult),
  };
  if (enough.unresolved || tightResult.unresolved) {
    const manualWide = withFreshManualAllowances(input(mode, slot, WIDE_GAP_MINUTES), slot);
    const manualTight = withFreshManualAllowances(input(mode, slot, TIGHT_GAP_MINUTES), slot);
    result.manual_allowance_fallback = {
      durationMinutes: MANUAL_MINUTES,
      syntheticFreshHostConfirmation: true,
      enough_gap: summarize(await evaluateSlot(manualWide, slot)),
      tight_gap: summarize(await evaluateSlot(manualTight, slot)),
    };
  }
  modes[mode] = result;
}

console.log(JSON.stringify(
  {
    observedAt: new Date().toISOString(),
    scope:
      'Public Seoul landmarks; one probe run, not a global or regional availability guarantee.',
    officialCoverageReference: 'https://developers.google.com/maps/coverage',
    officialTravelModesReference:
      'https://developers.google.com/maps/documentation/routes/vehicles',
    slot,
    fixture: {
      landmarks: Object.values(LANDMARKS),
      bufferMinutes: BUFFER_MINUTES,
      enoughGapMinutes: WIDE_GAP_MINUTES,
      tightGapMinutes: TIGHT_GAP_MINUTES,
    },
    billableRoutesCalls: billableCalls,
    maxBillableRoutesCalls: MAX_BILLABLE_CALLS,
    modes,
  },
  null,
  2,
));
