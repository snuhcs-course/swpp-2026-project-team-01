import {
  evaluateCandidates,
  evaluateSlot,
  resolveLocalDateTime,
  SchedulingInputError,
  travelAllowanceContext,
} from './index.ts';
import type { RouteQuery, SchedulingInput } from './index.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
  );
}
const slot = { start: '2026-10-05T10:00:00Z', end: '2026-10-05T10:30:00Z' };
function input(): SchedulingInput {
  return {
    rules: {
      timezone: 'UTC',
      durationMinutes: 30,
      availability: [{ days: [1], start: '09:00', end: '17:00' }],
      focusBlocks: [],
      bufferMinutes: 10,
      travelMode: 'DRIVE',
      preferences: '',
      homeLocation: 'Unconfirmed home',
    },
    details: {
      requesterName: 'Requester',
      requesterEmail: 'guest@example.invalid',
      purpose: 'Synthetic test',
      durationMinutes: 30,
      timezone: 'UTC',
      windows: [{ ...slot }],
      mode: 'online',
      location: 'Video link',
    },
    hostEvents: [],
  };
}
function physical(): SchedulingInput {
  const value = input();
  value.details.mode = 'in_person';
  value.details.location = 'Meeting';
  value.hostEvents = [
    {
      start: '2026-10-05T09:00:00Z',
      end: '2026-10-05T09:30:00Z',
      mode: 'in_person',
      location: 'Previous private address',
    },
    {
      start: '2026-10-05T11:00:00Z',
      end: '2026-10-05T11:30:00Z',
      mode: 'in_person',
      location: 'Next private address',
    },
  ];
  value.route = () => Promise.resolve({ durationMinutes: 20 });
  return value;
}

Deno.test('generates only explicit public windows on fifteen minute boundaries', async () => {
  const value = input();
  value.details.windows = [{
    start: '2026-10-05T10:01:00Z',
    end: '2026-10-05T11:00:00Z',
  }];
  const result = await evaluateCandidates(value);
  equal(result.candidates, [
    { start: '2026-10-05T10:15:00.000Z', end: '2026-10-05T10:45:00.000Z' },
    { start: '2026-10-05T10:30:00.000Z', end: '2026-10-05T11:00:00.000Z' },
  ]);
  assert(!result.unresolved);
});

Deno.test('checks entire duration, focus time, buffers and requester busy before routes', async () => {
  for (const kind of ['host', 'focus', 'requester'] as const) {
    const value = physical();
    let calls = 0;
    value.route = () => {
      calls++;
      return Promise.resolve({ durationMinutes: 0 });
    };
    const interval = {
      start: '2026-10-05T10:25:00Z',
      end: '2026-10-05T10:40:00Z',
    };
    if (kind === 'host') value.hostEvents.push(interval);
    if (kind === 'focus') value.rules.focusBlocks.push(interval);
    if (kind === 'requester') value.requesterBusy = [interval];
    const result = await evaluateSlot(value, slot);
    assert(!result.feasible);
    assert(!result.unresolved);
    equal(calls, 0);
  }
  const value = input();
  value.hostEvents = [{
    start: '2026-10-05T10:35:00Z',
    end: '2026-10-05T11:00:00Z',
  }];
  assert(
    !(await evaluateSlot(value, slot)).feasible,
    'host post-meeting buffer must remain free',
  );
});

Deno.test('availability uses host timezone and covers whole interval including buffers', async () => {
  const value = input();
  value.rules.timezone = 'Asia/Seoul';
  value.details.timezone = 'America/Los_Angeles';
  value.rules.availability = [{ days: [1], start: '19:00', end: '20:00' }];
  assert(
    !(await evaluateSlot(value, slot)).feasible,
    '19:00 start lacks buffer before 19:00',
  );
  value.rules.availability[0].start = '18:50';
  assert((await evaluateSlot(value, slot)).feasible);
  value.rules.availability[0].end = '19:20';
  assert(
    !(await evaluateSlot(value, slot)).feasible,
    'start fitting is not sufficient',
  );
});

Deno.test('duration is required and no matches never relaxes rules', async () => {
  const value = input();
  value.rules.availability = [];
  const result = await evaluateCandidates(value);
  equal(result.candidates, []);
  assert(!result.unresolved);
  value.details.durationMinutes = 45;
  const invalid = await evaluateCandidates(value);
  equal(invalid.candidates, []);
  assert(invalid.unresolved);
  assert(invalid.privateDiagnostics.some((d) => d.code === 'invalid_duration'));
});

Deno.test('both adjacent route estimates plus buffers must fit with correct departure and mode', async () => {
  const value = physical();
  const queries: RouteQuery[] = [];
  value.rules.travelMode = 'TRANSIT';
  value.route = (query) => {
    queries.push(query);
    return Promise.resolve({ durationMinutes: 20 });
  };
  const result = await evaluateSlot(value, slot);
  assert(result.feasible);
  equal(result.privateTravelChecks.length, 2);
  equal(queries, [
    {
      origin: 'Previous private address',
      destination: 'Meeting',
      mode: 'TRANSIT',
      departureTime: '2026-10-05T09:30:00.000Z',
    },
    {
      origin: 'Meeting',
      destination: 'Next private address',
      mode: 'TRANSIT',
      departureTime: '2026-10-05T10:30:00.000Z',
    },
  ]);
  for (const badEdge of ['before', 'after'] as const) {
    value.route = (query) =>
      Promise.resolve({
        durationMinutes: (badEdge === 'before'
            ? query.origin === 'Previous private address'
            : query.destination === 'Next private address')
          ? 25
          : 20,
      });
    const invalid = await evaluateSlot(value, slot);
    assert(!invalid.feasible);
    assert(!invalid.unresolved);
    assert(
      invalid.privateDiagnostics.some((d) =>
        d.code === 'insufficient_travel_gap' && d.edge === badEdge
      ),
    );
  }
});

Deno.test('unknown virtual whereabouts never implies home or video event location', async () => {
  const value = physical();
  value.hostEvents[0].mode = 'online';
  value.hostEvents[0].location = 'https://video.example.invalid/room';
  const result = await evaluateSlot(value, slot);
  assert(!result.feasible && result.unresolved);
  assert(
    result.privateDiagnostics.some((d) => d.code === 'adjacent_physical_location_unknown'),
  );
  value.hostEvents[0].physicalLocation = 'Confirmed office';
  assert((await evaluateSlot(value, slot)).feasible);
});

Deno.test('confirmed whereabouts after a virtual event can resolve travel', async () => {
  const value = physical();
  value.hostEvents[0].mode = 'online';
  value.physicalContext = [{
    at: '2026-10-05T09:30:00Z',
    location: 'Confirmed office',
  }];
  assert((await evaluateSlot(value, slot)).feasible);
  value.physicalContext[0].at = '2026-10-05T09:00:00Z';
  assert(
    (await evaluateSlot(value, slot)).unresolved,
    'context from before virtual event cannot establish whereabouts after it',
  );
});

Deno.test('physical meeting without initial whereabouts is unresolved despite home setting', async () => {
  const value = physical();
  value.hostEvents = [];
  assert((await evaluateSlot(value, slot)).unresolved);
  value.physicalContext = [{
    at: '2026-10-05T09:00:00Z',
    location: 'Confirmed office',
  }];
  assert((await evaluateSlot(value, slot)).feasible);
});

Deno.test('online candidate cannot hide the trip between adjacent physical commitments', async () => {
  const value = physical();
  value.details.mode = 'online';
  assert((await evaluateSlot(value, slot)).unresolved);
  value.candidatePhysicalLocation = 'Meeting';
  assert((await evaluateSlot(value, slot)).feasible);
});

Deno.test('missing locations, absent routes, invalid estimates and provider failure are unresolved', async () => {
  const missing = physical();
  delete missing.hostEvents[1].location;
  assert((await evaluateSlot(missing, slot)).unresolved);
  for (
    const route of [
      undefined,
      () => Promise.resolve(null),
      () => Promise.resolve({ durationMinutes: -1 }),
      () => Promise.resolve({ durationMinutes: NaN }),
      () => Promise.reject(new Error('private provider response')),
    ]
  ) {
    const value = physical();
    value.route = route;
    const result = await evaluateSlot(value, slot);
    assert(!result.feasible && result.unresolved);
    assert(!JSON.stringify(result).includes('private provider response'));
  }
});

Deno.test('requester candidates reveal no adjacent event addresses or travel diagnostics', async () => {
  const result = await evaluateCandidates(physical());
  equal(result.candidates.length, 1);
  equal(Object.keys(result.candidates[0]).sort(), ['end', 'start']);
  assert(!JSON.stringify(result.candidates).includes('private'));
  equal(result.privateTravelChecks[0].checks.length, 2);
});

Deno.test('DST local gaps and repeated clocks require resolution', () => {
  for (
    const [local, code] of [['2026-03-08T02:30', 'nonexistent_local_time'], [
      '2026-11-01T01:30',
      'ambiguous_local_time',
    ]]
  ) {
    let failure: unknown;
    try {
      resolveLocalDateTime(local, 'America/New_York');
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof SchedulingInputError);
    equal(failure.code, code);
  }
  equal(
    resolveLocalDateTime('2026-11-01T01:30', 'America/New_York', -240),
    '2026-11-01T05:30:00.000Z',
  );
  equal(
    resolveLocalDateTime('2026-11-01T01:30', 'America/New_York', -300),
    '2026-11-01T06:30:00.000Z',
  );
  equal(
    resolveLocalDateTime('2026-10-05T19:00', 'Asia/Seoul'),
    '2026-10-05T10:00:00.000Z',
  );
});

Deno.test('real-time interval is checked across DST transitions', async () => {
  const value = input();
  value.rules.timezone = 'America/New_York';
  value.rules.bufferMinutes = 0;
  value.rules.availability = [{ days: [0], start: '01:00', end: '03:00' }];
  value.details.windows = [{
    start: '2026-03-08T06:45:00Z',
    end: '2026-03-08T07:15:00Z',
  }];
  assert(
    !(await evaluateSlot(value, value.details.windows[0])).feasible,
    'clock jumps to 03:00 mid-meeting',
  );
});

Deno.test('invalid timestamps, timezone, limits and oversized searches never create candidates', async () => {
  for (
    const mutation of [
      (value: SchedulingInput) => {
        value.details.windows[0].start = '2026-10-05T10:00';
      },
      (value: SchedulingInput) => {
        value.details.windows[0].start = '2026-02-30T10:00Z';
      },
      (value: SchedulingInput) => {
        value.rules.timezone = 'Not/AZone';
      },
      (value: SchedulingInput) => {
        value.limit = 100000;
      },
      (value: SchedulingInput) => {
        value.details.windows = [{
          start: '2026-01-01T00:00Z',
          end: '2027-01-01T00:00Z',
        }];
      },
    ]
  ) {
    const value = input();
    mutation(value);
    const result = await evaluateCandidates(value);
    equal(result.candidates, []);
    assert(result.unresolved);
  }
});

Deno.test('overlapping windows are merged, result limit is honored, half-open busy endpoints are accepted', async () => {
  const value = input();
  value.limit = 1;
  value.rules.bufferMinutes = 0;
  value.details.windows.push({
    start: '2026-10-05T09:45:00Z',
    end: '2026-10-05T10:45:00Z',
  });
  value.requesterBusy = [{
    start: '2026-10-05T09:00:00Z',
    end: '2026-10-05T10:00:00Z',
  }];
  const result = await evaluateCandidates(value);
  equal(result.candidates, [{
    start: '2026-10-05T10:00:00.000Z',
    end: '2026-10-05T10:30:00.000Z',
  }]);
});

Deno.test('overnight availability belongs to the preceding local weekday', async () => {
  const value = input();
  value.rules.bufferMinutes = 0;
  value.rules.availability = [{ days: [1], start: '22:00', end: '02:00' }];
  value.details.windows = [{
    start: '2026-10-06T01:00:00Z',
    end: '2026-10-06T01:30:00Z',
  }];
  assert((await evaluateSlot(value, value.details.windows[0])).feasible);
});

function allow(value: SchedulingInput, edge: 'before' | 'after', durationMinutes = 20) {
  value.hostId = 'host-test';
  value.rulesVersion = 3;
  const context = travelAllowanceContext(value, slot, edge);
  assert(context);
  value.manualTravelAllowances ??= [];
  value.manualTravelAllowances.push({
    id: `allow-${edge}`,
    hostId: value.hostId,
    confirmedAt: '2026-10-04T12:00:00Z',
    durationMinutes,
    context,
  });
}

Deno.test('specific confirmed manual allowances resolve both missing routes with required buffers', async () => {
  const value = physical();
  value.route = () => Promise.resolve(null);
  allow(value, 'before');
  assert(!(await evaluateSlot(value, slot)).feasible, 'one allowance cannot resolve the other leg');
  allow(value, 'after');
  const result = await evaluateSlot(value, slot);
  assert(result.feasible && !result.unresolved);
  equal(result.privateTravelChecks.map((t) => t.source), ['manual', 'manual']);
  equal(result.privateTravelChecks.map((t) => t.manualAllowanceId), [
    'allow-before',
    'allow-after',
  ]);
  equal(result.privateTravelChecks.map((t) => t.bufferMinutes), [10, 10]);
  value.manualTravelAllowances![1].durationMinutes = 25;
  const invalid = await evaluateSlot(value, slot);
  assert(!invalid.feasible && !invalid.unresolved);
  assert(
    invalid.privateDiagnostics.some((d) =>
      d.code === 'insufficient_travel_gap' && d.edge === 'after'
    ),
  );
});

Deno.test('manual allowance may resolve unknown virtual location but never invents a physical endpoint', async () => {
  const value = physical();
  value.hostEvents[0].mode = 'online';
  value.hostEvents[0].location = 'https://video.example.invalid/room';
  allow(value, 'before');
  const result = await evaluateSlot(value, slot);
  assert(result.feasible);
  equal(value.manualTravelAllowances![0].context.origin, null);
  equal(result.privateTravelChecks[0].source, 'manual');
  assert(!JSON.stringify(result.privateTravelChecks[0]).includes('Unconfirmed home'));
});

Deno.test('changed rules, version, slot, locations, mode, neighboring events invalidate manual allowance', async () => {
  for (
    const mutation of [
      (value: SchedulingInput) => {
        value.rulesVersion = 4;
      },
      (value: SchedulingInput) => {
        value.rules.bufferMinutes = 11;
      },
      (value: SchedulingInput) => {
        value.rules.travelMode = 'WALK';
      },
      (value: SchedulingInput) => {
        value.details.location = 'Changed meeting';
      },
      (value: SchedulingInput) => {
        value.details.mode = 'online';
        value.candidatePhysicalLocation = 'Meeting';
      },
      (value: SchedulingInput) => {
        value.hostEvents[0].location = 'Changed previous';
      },
      (value: SchedulingInput) => {
        value.hostEvents[1].id = 'Changed neighbor event';
      },
      (value: SchedulingInput) => {
        value.physicalContext = [{ at: '2026-10-05T09:30:00Z', location: 'New whereabouts' }];
      },
    ]
  ) {
    const value = physical();
    value.route = () => Promise.resolve(null);
    allow(value, 'before');
    allow(value, 'after');
    mutation(value);
    const result = await evaluateSlot(value, slot);
    assert(!result.feasible && result.unresolved);
    assert(result.privateTravelChecks.every((t) => t.source !== 'manual'));
  }
  const value = physical();
  value.route = () => Promise.resolve(null);
  allow(value, 'before');
  allow(value, 'after');
  const changed = { start: '2026-10-05T10:15:00Z', end: '2026-10-05T10:45:00Z' };
  value.details.windows = [changed];
  assert((await evaluateSlot(value, changed)).unresolved);
});

Deno.test('wrong host, wrong leg, invalid confirmation and zero allowance cannot resolve failed travel', async () => {
  for (
    const mutation of [
      (value: SchedulingInput) => {
        value.hostId = 'different-host';
      },
      (value: SchedulingInput) => {
        value.manualTravelAllowances![0].context.edge = 'after';
      },
      (value: SchedulingInput) => {
        value.manualTravelAllowances![0].confirmedAt = 'yesterday';
      },
      (value: SchedulingInput) => {
        value.manualTravelAllowances![0].durationMinutes = 0;
      },
      (value: SchedulingInput) => {
        value.manualTravelAllowances!.push(structuredClone(value.manualTravelAllowances![0]));
      },
    ]
  ) {
    const value = physical();
    value.route = () => Promise.resolve(null);
    allow(value, 'before');
    allow(value, 'after');
    mutation(value);
    assert((await evaluateSlot(value, slot)).unresolved);
  }
});

Deno.test('manual allowance cannot waive busy/focus hard constraints or reveal private details', async () => {
  const value = physical();
  value.route = () => Promise.resolve(null);
  allow(value, 'before');
  allow(value, 'after');
  const publicResult = await evaluateCandidates(value);
  equal(publicResult.candidates.length, 1);
  assert(!JSON.stringify(publicResult.candidates).includes('allow-before'));
  value.rules.focusBlocks = [{ start: '2026-10-05T10:15:00Z', end: '2026-10-05T10:25:00Z' }];
  assert(!(await evaluateSlot(value, slot)).feasible);
});
