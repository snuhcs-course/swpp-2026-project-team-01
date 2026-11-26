// The group meeting contract shared by the server and the booking page
// (group-scheduling). A participant request carries the group's terms in its
// details like any request; these are what only a group adds.

// The expiry a collecting group's participant requests and booking links
// carry, so neither expires while the group is open (D14). The close sets both
// again.
export const GROUP_OPEN_EXPIRY = new Date("9999-12-31T00:00:00.000Z");

// The participant's steps after identity and Calendar (design 3).
export const GROUP_STEPS = ["question", "review", "done"] as const;
export type GroupStep = (typeof GROUP_STEPS)[number];

// One unavailable time on the participant's review: from their calendar or
// what they said. An all-day time has local dates, end exclusive; a timed one
// has instants. The place is never shown to anyone else.
export type GroupUnavailableTime = {
  readonly source: "calendar" | "stated";
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
};

export type GroupReview = {
  readonly times: readonly GroupUnavailableTime[];
  // A hash of the listed times; confirming names it, so what is stored is
  // what was shown (D11).
  readonly fingerprint: string;
};

// What the participant's page knows of the group.
export type GroupParticipantView = {
  readonly purpose: string;
  readonly durationMinutes: number;
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly step: GroupStep | null;
  // The group stopped admitting before this participant was done.
  readonly full: boolean;
};
