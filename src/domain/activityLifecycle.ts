import type { CustomIntegration } from './integrations';
import type { ActivityConfig, Member, Recurrence, ScheduleKind, VerificationAttempt } from './types';
import { formatDate } from '@/lib/dates';

/**
 * Verification Activities as administrators see them: the lifecycle status, the schedule in words, how
 * people are verified (prescribed by the identity source, never chosen) and each participant's outcomes.
 * Identity verification and eligibility are always separate results.
 */

/* ---------------- Status ---------------- */

export type ActivityDisplayStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'completed';

export const DISPLAY_STATUS_LABEL: Record<ActivityDisplayStatus, string> = {
  draft: 'Draft', scheduled: 'Scheduled', active: 'Active', paused: 'Paused', completed: 'Completed',
};

/**
 * Draft until activated; Completed once marked completed or when a scheduled end has passed; Paused while
 * deactivated; Scheduled while its start is still ahead; otherwise Active. Activities created before
 * schedules existed (no `schedule.kind`) are never Scheduled or Completed by date.
 */
export function displayStatus(a: Pick<ActivityConfig, 'status' | 'schedule' | 'completedAt'>, now: Date = new Date()): ActivityDisplayStatus {
  if (a.status === 'draft') return 'draft';
  if (a.completedAt) return 'completed';
  const s = a.schedule;
  if (s?.kind && s.endsAt && now > new Date(s.endsAt)) return 'completed';
  if (a.status === 'inactive') return 'paused';
  if (s?.kind && s.startsAt && now < new Date(s.startsAt)) return 'scheduled';
  return 'active';
}

/* ---------------- Schedule ---------------- */

export const SCHEDULE_KIND_LABEL: Record<ScheduleKind, string> = { 'one-time': 'One-time', recurring: 'Recurring', 'open-ended': 'Open-ended' };
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dateTime = (iso: string) => `${formatDate(iso)}, ${time(iso)}`;

export function recurrenceText(r: Recurrence): string {
  const days = r.frequency === 'weekly' && r.days?.length ? ` on ${[...r.days].sort((a, b) => a - b).map((d) => WEEKDAY[d]).join(', ')}` : '';
  return `${{ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[r.frequency]}${days} · ${r.startTime}–${r.endTime}`;
}

/** The schedule in one line, or null when the activity has none. */
export function scheduleSummary(s?: ActivityConfig['schedule']): string | null {
  if (!s) return null;
  if (s.kind === 'one-time' && s.startsAt && s.endsAt) return `${dateTime(s.startsAt)} – ${dateTime(s.endsAt)}`;
  if (s.kind === 'open-ended' && s.startsAt) return `From ${dateTime(s.startsAt)} · no end date`;
  if (s.kind === 'recurring' && s.startsAt && s.recurrence) {
    return `${recurrenceText(s.recurrence)} · from ${formatDate(s.startsAt)}${s.endsAt ? ` until ${formatDate(s.endsAt)}` : ''}`;
  }
  if (s.startsAt || s.endsAt) return `${s.startsAt ? dateTime(s.startsAt) : '…'} – ${s.endsAt ? dateTime(s.endsAt) : '…'}`;
  return null;
}

/** A compact schedule for lists: the kind and its dates. The full pattern is on the activity. */
export function scheduleShort(s?: ActivityConfig['schedule']): string | null {
  if (!s?.startsAt && !s?.endsAt) return null;
  const from = s.startsAt ? formatDate(s.startsAt) : '…';
  if (s.kind === 'open-ended') return `Open-ended · from ${from}`;
  if (s.kind === 'recurring') return `Recurring · from ${from}${s.endsAt ? ` to ${formatDate(s.endsAt)}` : ''}`;
  const to = s.endsAt ? formatDate(s.endsAt) : '…';
  return from === to ? `One-time · ${from}` : `${s.kind ? 'One-time · ' : ''}${from} – ${to}`;
}

/* ---------------- Eligibility mode ---------------- */

export function eligibilityMode(a: Pick<ActivityConfig, 'eligibilityMode' | 'participants'>): 'selected' | 'open' {
  if (a.eligibilityMode) return a.eligibilityMode;
  return (a.participants?.groupIds.length ?? 0) + (a.participants?.memberIds.length ?? 0) > 0 ? 'selected' : 'open';
}

export const ELIGIBILITY_MODE_LABEL = { selected: 'Selected participants', open: 'Open verification' } as const;

/* ---------------- Prescribed verification process ---------------- */

export interface SourceDescription {
  /** Short name of the source. */
  name: string;
  external: boolean;
  /** The steps every verification follows, in order. Read-only: nothing here is chosen by the administrator. */
  steps: string[];
  /** Whether part of the process is simulated in this prototype. */
  simulated: boolean;
}

/**
 * The verification process an identity source prescribes. A record is only ever retrieved with an identifier;
 * the portrait match against the reference portrait is always required and can't be bypassed.
 */
export function describeSource(source: { kind: 'local' } | { kind: 'external'; integration?: Pick<CustomIntegration, 'name' | 'referenceLabel' | 'connection'> }, mode: 'selected' | 'open', localSimulated: boolean): SourceDescription {
  if (source.kind === 'external') {
    const i = source.integration;
    const name = i?.name ?? 'The connected identity source';
    return {
      name, external: true, simulated: i?.connection.target === 'simulated',
      steps: [
        `Retrieve the person’s record from ${name} using their ${i?.referenceLabel ?? 'reference'}.`,
        'Confirm a live person is present.',
        `Perform the required portrait match against the reference portrait held by ${name}.`,
        mode === 'selected' ? 'Confirm the person is one of the selected participants.' : `Eligibility comes from the record status ${name} returns.`,
      ],
    };
  }
  return {
    name: 'FixID records', external: false, simulated: localSimulated,
    steps: [
      'Retrieve the person’s FixID record using their registered identifier.',
      'Confirm a live person is present.',
      'Perform the required portrait match against the reference portrait enrolled in FixID.',
      mode === 'selected' ? 'Confirm the person is one of the selected participants.' : 'Anyone with an active FixID record in your organization can be verified.',
    ],
  };
}

export const PORTRAIT_BASELINE = 'The portrait match is required for every verification. Retrieving a record with an identifier never verifies anyone on its own.';

/* ---------------- Outcomes ---------------- */

export type VerificationStatus = 'verified' | 'unsuccessful' | 'pending' | 'unable' | 'not-attempted';
export type EligibilityOutcome = 'eligible' | 'not-eligible' | 'unknown' | 'not-required' | 'not-checked';

export const VERIFICATION_STATUS_LABEL: Record<VerificationStatus, string> = {
  verified: 'Verified', unsuccessful: 'Unsuccessful', pending: 'Pending', unable: 'Unable to complete', 'not-attempted': 'Not yet verified',
};
export const ELIGIBILITY_OUTCOME_LABEL: Record<EligibilityOutcome, string> = {
  eligible: 'Eligible', 'not-eligible': 'Not eligible', unknown: 'Unknown', 'not-required': 'Not required', 'not-checked': 'Not checked',
};
export const VERIFICATION_STATUS_TONE = { verified: 'success', unsuccessful: 'danger', pending: 'violet', unable: 'warning', 'not-attempted': 'neutral' } as const;
export const ELIGIBILITY_OUTCOME_TONE = { eligible: 'success', 'not-eligible': 'danger', unknown: 'warning', 'not-required': 'neutral', 'not-checked': 'neutral' } as const;

/** The identity verification result of one attempt (never its eligibility). */
export function identityStatus(a: VerificationAttempt): Exclude<VerificationStatus, 'not-attempted'> {
  if (a.status === 'in-progress') return 'pending';
  if (a.status !== 'completed') return 'unable';
  if (a.liveness?.status === 'failed') return 'unsuccessful';
  const m = a.match?.status;
  if (m === 'match' || m === 'record-confirmed') return 'verified';
  if (m === 'no-match') return 'unsuccessful';
  if (m === 'inconclusive') return 'pending';
  if (m) return 'unable';
  // Records from local verification without a match field.
  return a.verificationResult === 'verified' ? 'verified' : a.verificationResult === 'not-verified' ? 'unsuccessful' : a.verificationResult === 'pending-review' ? 'pending' : 'unable';
}

/** The eligibility result of one attempt, kept apart from identity. */
export function eligibilityOutcome(a: VerificationAttempt): EligibilityOutcome {
  switch (a.eligibilityStatus) {
    case 'eligible': return 'eligible';
    case 'ineligible': return 'not-eligible';
    case 'unknown': return 'unknown';
    case 'not-required': return 'not-required';
    case 'not-evaluated': return 'not-checked';
    default: break;
  }
  switch (a.eligibilityResult) {
    case 'eligible': return 'eligible';
    case 'not-eligible': return 'not-eligible';
    case 'not-required': return 'not-required';
    case undefined: return 'not-checked';
    default: return 'unknown';
  }
}

/** A plain explanation of an attempt's identity result. Never mentions images, scores or biometric data. */
export function outcomeExplanation(a: VerificationAttempt | undefined): string {
  if (!a) return 'No verification has been recorded for this person yet.';
  const st = identityStatus(a);
  if (a.status === 'expired' || a.status === 'cancelled') return 'The verification was started but not finished, so there is no result.';
  if (st === 'verified') return 'The record was retrieved and the portrait match confirmed the person’s identity.';
  if (st === 'unsuccessful') {
    return a.liveness?.status === 'failed'
      ? 'The live presence check didn’t pass, so identity wasn’t confirmed.'
      : 'The portrait match didn’t confirm that the person presenting is the person in the record.';
  }
  if (st === 'pending') return a.status === 'in-progress' ? 'The verification is still in progress.' : 'The portrait match was inconclusive, so identity hasn’t been confirmed.';
  if (a.lookup && a.lookup.status !== 'FOUND') {
    return a.lookup.status === 'NOT_FOUND' ? 'No record was found for the identifier provided, so the portrait match couldn’t run.'
      : a.lookup.status === 'MULTIPLE_MATCHES' ? 'The identifier matched more than one record, so the portrait match couldn’t run.'
        : 'The identity source couldn’t be reached, so verification couldn’t be completed.';
  }
  return 'The identity source or portrait matching service was unavailable, so verification couldn’t be completed.';
}

/** Keeps only the last four characters of an identifier. */
export function maskIdentifier(v?: string): string {
  if (!v) return '—';
  const t = v.trim();
  return t.length <= 4 ? '••••' : `••••${t.slice(-4)}`;
}

/* ---------------- Participants ---------------- */

export interface ParticipantRow {
  key: string;
  name: string;
  /** Masked: never the full identifier. */
  identifier: string;
  memberId?: string;
  /** On the activity's list of selected participants. */
  listed: boolean;
  eligibility: EligibilityOutcome;
  status: VerificationStatus;
  /** Latest attempt first. */
  attempts: VerificationAttempt[];
  latest?: VerificationAttempt;
}

/**
 * One row per person: everyone selected (whether or not they've attempted), and everyone who attempted.
 * The latest attempt decides the row's results; earlier ones are kept for the details view.
 */
export function participantRows(attempts: VerificationAttempt[], listed: Set<string>, memberById: Map<string, Pick<Member, 'id' | 'displayName' | 'identifier'>>): ParticipantRow[] {
  const byKey = new Map<string, VerificationAttempt[]>();
  const keyOf = (a: VerificationAttempt) => (a.subject?.memberId ? `m:${a.subject.memberId}` : a.lookup?.referenceId ? `r:${a.lookup.referenceId}` : a.lookup?.reference ? `x:${a.lookup.reference}` : `a:${a.id}`);
  for (const a of [...attempts].sort((x, y) => (y.completedAt ?? y.startedAt).localeCompare(x.completedAt ?? x.startedAt))) {
    byKey.set(keyOf(a), [...(byKey.get(keyOf(a)) ?? []), a]);
  }
  for (const id of listed) if (!byKey.has(`m:${id}`)) byKey.set(`m:${id}`, []);
  return [...byKey.entries()].map(([key, list]): ParticipantRow => {
    const latest = list[0];
    const memberId = key.startsWith('m:') ? key.slice(2) : undefined;
    const m = memberId ? memberById.get(memberId) : undefined;
    const isListed = !!memberId && listed.has(memberId);
    return {
      key, memberId, listed: isListed, attempts: list, latest,
      name: m?.displayName ?? latest?.lookup?.displayName ?? (latest?.lookup?.status === 'FOUND' ? 'Unnamed record' : 'Unidentified person'),
      identifier: maskIdentifier(m?.identifier?.value ?? latest?.lookup?.reference),
      status: latest ? identityStatus(latest) : 'not-attempted',
      eligibility: latest ? eligibilityOutcome(latest) : isListed ? 'eligible' : 'not-checked',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Overview figures, counted from the same attempts as the participant table so they always add up. */
export function activityCounts(attempts: VerificationAttempt[]) {
  const c = { attempts: attempts.length, verified: 0, unsuccessful: 0, pending: 0, unable: 0 };
  for (const a of attempts) c[identityStatus(a)] += 1;
  return c;
}
