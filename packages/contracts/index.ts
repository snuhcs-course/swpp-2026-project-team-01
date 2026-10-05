export type RequestStatus = 'gathering' | 'negotiating' | 'awaiting_approval' | 'booking' | 'booked' | 'declined' | 'withdrawn' | 'expired';
export type MeetingMode = 'online' | 'in_person';
export interface TimeWindow { start: string; end: string }
export interface HostRules {
  timezone: string;
  durationMinutes: number;
  availability: { days: number[]; start: string; end: string }[];
  focusBlocks: TimeWindow[];
  bufferMinutes: number;
  travelMode: 'DRIVE' | 'TRANSIT' | 'WALK' | 'BICYCLE';
  homeLocation?: string;
  preferences: string;
}
export interface HostProfile {
  id: string;
  handle: string;
  displayName: string;
  timezone: string;
  ready: boolean;
  durationMinutes: number;
}
export interface SetupState {
  admitted: boolean;
  profile: HostProfile | null;
  rules: HostRules | null;
  calendarConnected: boolean;
  conflictCalendarIds: string[];
  bookingCalendarId: string | null;
  nextAction: string;
}
export interface SetupSettings {
  handle: string | null;
  displayName: string | null;
  rules: HostRules | null;
}
export interface SetupConversationTurn {
  id: string;
  sequence: number;
  role: 'host' | 'assistant' | 'system';
  channel: 'web' | 'imessage' | 'system';
  text: string;
  createdAt: string;
}
export interface SetupDraftSettings {
  handle: string | null;
  displayName: string | null;
  rules: Partial<HostRules> | null;
}
export interface SetupDraft {
  revision: number;
  baseRulesVersion: number;
  settings: SetupDraftSettings;
  unresolved: string[];
  status: 'active' | 'superseded' | 'confirmed';
  createdAt: string;
}
export interface SetupReview {
  revision: number;
  draftRevision: number;
  settings: SetupSettings;
  status: 'pending' | 'confirmed' | 'superseded';
  createdAt: string;
}
export interface SetupChannelLink {
  id: string;
  provider: 'imessage';
  linkedAt: string;
}
export interface SetupChannelChallenge {
  id: string;
  expiresAt: string;
  claimed: boolean;
  maskedSender: string | null;
}
export interface SetupConversationState {
  id: string;
  revision: number;
  turns: SetupConversationTurn[];
  draft: SetupDraft | null;
  review: SetupReview | null;
  setup: SetupState;
  channelLink: SetupChannelLink | null;
  linkChallenge?: SetupChannelChallenge | null;
}
export interface MeetingDetails {
  requesterName: string;
  requesterEmail: string;
  purpose: string;
  durationMinutes: number;
  timezone: string;
  windows: TimeWindow[];
  mode: MeetingMode;
  location: string;
}
export interface Proposal {
  version: number;
  start: string;
  end: string;
  timezone: string;
  mode: MeetingMode;
  location: string;
  requesterName: string;
  requesterEmail: string;
  purpose: string;
}
export interface RequestView {
  contactVerified: boolean;
  calendarConnected?: boolean;
  privateMessages?: RequestView['messages'];
  id: string;
  hostId: string;
  revision: number;
  status: RequestStatus;
  details: MeetingDetails;
  candidates: TimeWindow[];
  proposal: Proposal | null;
  requesterAgreed: boolean;
  hostApproved: boolean;
  event: { id: string; url: string | null } | null;
  nextAction: string;
  messages: { id: string; role: 'requester' | 'assistant' | 'host'; text: string; createdAt: string }[];
  privateNotes?: string;
  exceptions?: string[];
  deliveryStatus?: string;
}
export interface MutationContext { idempotencyKey: string; expectedRevision?: number; proposalVersion?: number }
export interface ApiError { error: { code: string; message: string; correlationId?: string } }
export interface CalendarOption { id: string; summary: string; accessRole: string; primary?: boolean }
