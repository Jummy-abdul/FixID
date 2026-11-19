import { useSyncExternalStore } from 'react';
import type { ExceptionAction, ExceptionEvent, ExceptionStatus } from '@/domain/exceptions';
import { OPEN_STATUSES } from '@/domain/exceptions';
import {
  ACTIVE_SESSION, EVENTS, INSTITUTIONS, NYSC_EVENT_ID, SESSIONS, UNILAG, baseCounts, baseRecord, baseRecordOf, baseRecords, eventForSession, institutionByCode,
  issueIndexes, normaliseReg, workingHours, officersOf, parseRegistration, rng, scenarioRecords, sessionYear, verifiedIndexes,
  type Institution, type Session, type StudentRecord,
} from './data';
import { JAMB_PERSONAS, type ConsoleRole } from './personas';
import { registrantByReg, scenarioByReg, type PriorClearance, type Registrant } from './scenarios';

/**
 * The platform's shared state: what officers do (verifications, clearances, escalations,
 * NYSC verifications), the exceptions register, delegated users and the audit trail. All three workspaces read
 * and write this one store, so a clearance done by a university appears for JAMB and NYSC straight away (other
 * open tabs too). Kept apart from the rest of the prototype's data under its own browser storage key.
 */
export const JAMB_STORAGE_KEY = 'fixid.jamb.v2';

/* ---------------- types ---------------- */

export interface Officer {
  name: string;
  email: string;
  role: ConsoleRole;
  /** Job title, e.g. Institutional Clearance Officer. */
  title: string;
  organisation: string;
  institution?: string;
}

export type UniversityOutcome = 'identity-confirmed' | 'nin-mismatch' | 'exam-mismatch' | 'duplicate-clearance' | 'admission-not-found' | 'face-mismatch' | 'not-found' | 'invalid';
export type NyscOutcome = 'confirmed' | 'face-mismatch' | 'clearance-not-confirmed' | 'not-found' | 'invalid';
export type ActivityOutcome = UniversityOutcome | NyscOutcome | 'clearance-completed' | 'escalated';

export const OUTCOME_LABEL: Record<ActivityOutcome, string> = {
  'identity-confirmed': 'Identity verified', 'nin-mismatch': 'JAMB/NIN discrepancy', 'exam-mismatch': 'Examination record discrepancy', 'duplicate-clearance': 'Existing clearance found', 'admission-not-found': 'Admission record not found',
  'face-mismatch': 'Face verification failed', 'not-found': 'Record not found', invalid: 'Invalid registration number',
  confirmed: 'Identity confirmed', 'clearance-not-confirmed': 'Admission clearance not confirmed',
  'clearance-completed': 'Clearance completed', escalated: 'Escalated to JAMB',
};
export const outcomeTone = (o: ActivityOutcome): 'success' | 'danger' | 'warning' | 'neutral' =>
  o === 'identity-confirmed' || o === 'confirmed' || o === 'clearance-completed' ? 'success'
    : o === 'face-mismatch' ? 'danger' : o === 'not-found' || o === 'invalid' ? 'neutral' : 'warning';

/** A verification activity: one university clearance check or NYSC verification (or a clearance decision). */
export interface Activity {
  ref: string;
  at: string;
  kind: 'university' | 'nysc';
  eventId: string;
  officer: string;
  officerTitle: string;
  organisation: string;
  institution?: string;
  session?: Session;
  input: string;
  reg?: string;
  outcome: ActivityOutcome;
  checks?: { face?: 'match' | 'no-match'; nin?: 'match' | 'mismatch' };
  captureMode?: 'camera' | 'demo';
  exceptionId?: string;
}

export type ExceptionCategory = 'jamb-nin-discrepancy' | 'exam-impersonation' | 'nysc-identity-discrepancy' | 'nysc-clearance-not-confirmed' | 'admission-inquiry' | 'potential-fraud' | 'duplicate-clearance' | 'record-inconsistency' | 'failed-verification' | 'manual-review';
export const CATEGORY_LABEL: Record<ExceptionCategory, string> = {
  'jamb-nin-discrepancy': 'JAMB and NIN identity discrepancy', 'exam-impersonation': 'Possible examination impersonation', 'nysc-identity-discrepancy': 'Identity discrepancy at NYSC verification', 'nysc-clearance-not-confirmed': 'Admission clearance not confirmed at NYSC verification', 'admission-inquiry': 'Admission record inquiry', 'potential-fraud': 'Potential identity fraud', 'duplicate-clearance': 'Existing clearance at another institution',
  'record-inconsistency': 'Student record inconsistency', 'failed-verification': 'Failed identity verification', 'manual-review': 'Manual review required',
};
export type ExceptionResolution = 'identity-confirmed' | 'identity-not-confirmed' | 'record-corrected' | 'clearance-revoked' | 'no-further-action'
  | 'existing-record-confirmed' | 'release-authorised' | 'previous-clearance-revoked' | 'escalation-rejected'
  | 'identity-discrepancy-confirmed' | 'withdrawal-confirmed' | 'next-step-authorised'
  | 'no-admission-confirmed' | 'admission-located' | 'institution-session-corrected' | 'record-discrepancy-identified'
  | 'clearance-record-located' | 'no-clearance-confirmed';
export const RESOLUTION_LABEL: Record<ExceptionResolution, string> = {
  'identity-confirmed': 'Identity confirmed: clearance may proceed', 'identity-not-confirmed': 'Identity not confirmed: clearance remains blocked',
  'record-corrected': 'Record corrected by JAMB', 'clearance-revoked': 'Earlier clearance upheld: duplicate blocked', 'no-further-action': 'No further action required',
  'existing-record-confirmed': 'Previous clearance confirmed: clearance here is not permitted', 'release-authorised': 'Release authorised by JAMB: clearance may proceed',
  'previous-clearance-revoked': 'Previous clearance revoked by JAMB: clearance may proceed', 'escalation-rejected': 'Escalation rejected',
  'identity-discrepancy-confirmed': 'Identity discrepancy confirmed: clearance remains on hold',
  'withdrawal-confirmed': 'Admission withdrawal confirmed by JAMB: clearance may proceed',
  'next-step-authorised': 'Next step authorised by JAMB: clearance may proceed',
  'no-admission-confirmed': 'No admission record exists for this institution and session',
  'admission-located': 'Admission record located',
  'institution-session-corrected': 'Institution or session corrected',
  'record-discrepancy-identified': 'Record discrepancy identified',
  'clearance-record-located': 'Admission clearance record located',
  'no-clearance-confirmed': 'No admission clearance record exists',
};

/**
 * The kind of case, which decides the decisions JAMB can record. Identity discrepancies (university or NYSC),
 * an existing clearance at another institution, an admission record inquiry, or an NYSC clearance confirmation.
 */
export type CaseType = 'identity-discrepancy' | 'existing-clearance' | 'admission-inquiry' | 'clearance-confirmation' | 'other';
export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  'identity-discrepancy': 'Identity discrepancy', 'existing-clearance': 'Existing clearance', 'admission-inquiry': 'Admission record inquiry',
  'clearance-confirmation': 'Clearance confirmation (NYSC)', other: 'Other',
};
export function caseTypeOf(e: Pick<JambException, 'category'>): CaseType {
  switch (e.category) {
    case 'jamb-nin-discrepancy': case 'exam-impersonation': case 'nysc-identity-discrepancy': case 'potential-fraud': case 'failed-verification': return 'identity-discrepancy';
    case 'duplicate-clearance': return 'existing-clearance';
    case 'admission-inquiry': return 'admission-inquiry';
    case 'nysc-clearance-not-confirmed': return 'clearance-confirmation';
    default: return 'other';
  }
}
/** The decisions available for each kind of case (requesting information and referral are available for all). */
export const CASE_DECISIONS: Record<CaseType, ExceptionResolution[]> = {
  'identity-discrepancy': ['identity-confirmed', 'identity-discrepancy-confirmed'],
  'existing-clearance': ['existing-record-confirmed', 'withdrawal-confirmed', 'next-step-authorised'],
  'admission-inquiry': ['no-admission-confirmed', 'admission-located', 'institution-session-corrected', 'record-discrepancy-identified'],
  'clearance-confirmation': ['clearance-record-located', 'no-clearance-confirmed'],
  other: ['identity-confirmed', 'identity-not-confirmed', 'record-corrected', 'no-further-action'],
};
/** The action name JAMB sees for each decision. */
export const DECISION_ACTION: Partial<Record<ExceptionResolution, string>> = {
  'identity-confirmed': 'Confirm Identity', 'identity-discrepancy-confirmed': 'Confirm Identity Discrepancy',
  'existing-record-confirmed': 'Confirm Previous Clearance', 'withdrawal-confirmed': 'Confirm Admission Withdrawal', 'next-step-authorised': 'Authorise Next Step',
  'no-admission-confirmed': 'Confirm No Admission Record Exists', 'admission-located': 'Admission Record Located', 'institution-session-corrected': 'Correct Institution or Session',
  'record-discrepancy-identified': 'Record Discrepancy Identified', 'clearance-record-located': 'Clearance Record Located', 'no-clearance-confirmed': 'Confirm No Clearance Record',
  'identity-not-confirmed': 'Identity Not Confirmed', 'record-corrected': 'Record Corrected', 'no-further-action': 'No Further Action',
};
/** Decisions that must name the institution and admission session JAMB found. */
export const DECISION_NEEDS_PLACEMENT: ExceptionResolution[] = ['admission-located', 'institution-session-corrected'];
/** JAMB teams a case can be referred to for further investigation. */
export const INVESTIGATION_TEAMS = ['JAMB Identity Investigations Unit', 'JAMB Admissions Records Unit', 'JAMB Legal and Compliance', 'JAMB ICT Data Integrity Unit'];

/** A comparison between two identity sources (predefined per record: no biometric service is called). */
export interface Comparison { label: string; result: 'match' | 'mismatch' | 'pending' }
/** What an institution submitted when it escalated a case to JAMB. */
export interface Escalation {
  comment: string;
  submittedBy: string;
  submittedByTitle: string;
  institution: string;
  submittedAt: string;
  /** Why the institution is escalating (chosen from a list). */
  reason?: string;
  /** Supporting evidence the officer attached. */
  evidence: string[];
  comparisons?: Comparison[];
  /** The live capture, only when the officer attached it as evidence. */
  capture?: string;
  /** Who referred the case: an institution's clearance officer (default) or NYSC. */
  source?: 'university' | 'nysc';
}
/** The case lifecycle: New → Under review → (Awaiting information) → Resolved → Closed. */
export type EscalationStatus = 'open' | 'in-review' | 'awaiting-information' | 'resolved' | 'closed';
export const ESCALATION_STATUS_LABEL: Record<EscalationStatus, string> = { open: 'New', 'in-review': 'Under review', 'awaiting-information': 'Awaiting information', resolved: 'Resolved', closed: 'Closed' };

export interface Evidence { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }
/**
 * What JAMB recorded with its decision. FixID records the decision; it does not change JAMB's own admission or
 * identity records, so an authoritative correction is captured as a reference.
 */
export interface ResolutionDetails {
  /** The institution and session JAMB found (admission record located, or institution/session corrected). */
  institution?: string;
  session?: Session;
  /** Reference of an authoritative correction JAMB completed in its own systems, when there is one. */
  reference?: string;
  /** Instructions for the originating institution. */
  instructions?: string;
}
export interface JambException {
  id: string;
  reg: string;
  institution: string;
  session: Session;
  eventId: string;
  category: ExceptionCategory;
  summary: string;
  raisedAt: string;
  raisedBy: string;
  raisedByOrganisation: string;
  status: ExceptionStatus;
  assignedTo?: string;
  evidence: Evidence[];
  activityRef?: string;
  history: ExceptionEvent[];
  resolution?: { outcome: ExceptionResolution; note: string; at: string; by: string; details?: ResolutionDetails };
  /** When the case was assigned to its JAMB officer. */
  assignedAt?: string;
  /** The JAMB team a case was referred to for further investigation. */
  referredTo?: string;
  closedAt?: string;
  /** Present when an institution escalated the case to JAMB. */
  escalation?: Escalation;
}

export type UserRole = 'jamb-admin' | 'jamb-reviewer' | 'clearance-officer' | 'clearance-supervisor' | 'nysc-officer';
export const USER_ROLE_LABEL: Record<UserRole, string> = {
  'jamb-admin': 'Central Administrator', 'jamb-reviewer': 'Exception Reviewer', 'clearance-officer': 'Clearance Officer',
  'clearance-supervisor': 'Clearance Supervisor', 'nysc-officer': 'NYSC Verification Officer',
};
export const ROLE_ACCESS: Record<UserRole, string> = {
  'jamb-admin': 'All institutions, events, exceptions, student identity records and user access.',
  'jamb-reviewer': 'Exceptions and student identity records, read-only elsewhere.',
  'clearance-officer': 'Their institution’s published clearance events: verify and clear students.',
  'clearance-supervisor': 'Their institution’s clearance records and officers’ activity.',
  'nysc-officer': 'The NYSC Identity Verification event: verify candidates and view their history.',
};
export const rolesFor = (organisation: string): UserRole[] => (organisation === 'JAMB' ? ['jamb-admin', 'jamb-reviewer'] : organisation === 'NYSC' ? ['nysc-officer'] : ['clearance-officer', 'clearance-supervisor']);
export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  /** JAMB, NYSC or an institution code. */
  organisation: string;
  role: UserRole;
  status: 'active' | 'invited' | 'disabled';
  lastActiveAt?: string;
  createdAt: string;
  createdBy: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  user: string;
  role: string;
  organisation: string;
  action: string;
  reg?: string;
  student?: string;
  outcome?: string;
  reference?: string;
}

export interface StudentOverride {
  verification?: StudentRecord['verification'];
  verifiedAt?: string;
  verifiedBy?: string;
  verificationRef?: string;
  nin?: StudentRecord['nin'];
  blocked?: StudentRecord['blocked'] | null;
  clearance?: StudentRecord['clearance'];
  clearedAt?: string;
  clearedBy?: string;
  clearanceRef?: string;
}

export interface JambState {
  version: 2;
  students: Record<string, StudentOverride>;
  activities: Activity[];
  exceptions: Record<string, Partial<JambException>>;
  createdExceptions: JambException[];
  users: Record<string, Partial<PlatformUser>>;
  invitedUsers: PlatformUser[];
  audit: AuditEntry[];
}

/* ---------------- persistence ---------------- */

const empty = (): JambState => ({ version: 2, students: {}, activities: [], exceptions: {}, createdExceptions: [], users: {}, invitedUsers: [], audit: [] });
function load(): JambState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(JAMB_STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) as JambState : null;
    return parsed?.version === 2 ? { ...empty(), ...parsed } : empty();
  } catch { return empty(); }
}

let current: JambState = load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function save(next: JambState) {
  current = next;
  try { localStorage.setItem(JAMB_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable: kept in memory */ }
  emit();
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === JAMB_STORAGE_KEY) { current = load(); emit(); } });
}

export const getJambState = () => current;
/** Re-reads storage (tests, and after a reset elsewhere). */
export function reloadJambState() { current = load(); emit(); }
export function resetJambDemo() { save(empty()); }
export function useJambState(): JambState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => current);
}

const code6 = () => Array.from({ length: 6 }, () => '0123456789'[Math.floor(Math.random() * 10)]).join('');
const now = () => new Date().toISOString();

/* ---------------- records and counts ---------------- */

export function recordOf(reg: string, state: JambState = current): StudentRecord | undefined {
  const base = baseRecordOf(reg);
  if (!base) return undefined;
  const o = state.students[base.reg];
  if (!o) return base;
  const merged = { ...base, ...o } as StudentRecord & { blocked?: StudentRecord['blocked'] | null };
  if (merged.blocked === null) delete merged.blocked;
  return merged as StudentRecord;
}
export const priorClearanceOf = (reg: string): PriorClearance | undefined => scenarioByReg(reg)?.priorClearance;

export function recordsOf(inst: Institution, s: Session, state: JambState = current): StudentRecord[] {
  return baseRecords(inst, s).map((r) => (state.students[r.reg] ? recordOf(r.reg, state)! : r));
}

export interface Counts {
  admitted: number;
  /** Identity verified (including those since cleared). */
  verified: number;
  cleared: number;
  /** Admitted but not yet cleared. */
  pending: number;
  failed: number;
  exceptions: number;
  /** Identity verified, clearance not yet confirmed. */
  awaitingClearance: number;
  /** No verification yet. */
  notStarted: number;
}

const zero = (): Counts => ({ admitted: 0, verified: 0, cleared: 0, pending: 0, failed: 0, exceptions: 0, awaitingClearance: 0, notStarted: 0 });
function bump(c: Counts, r: Pick<StudentRecord, 'verification' | 'clearance'>, k: 1 | -1) {
  if (r.verification === 'verified') c.verified += k;
  if (r.clearance === 'cleared') c.cleared += k; else c.pending += k;
  if (r.clearance !== 'cleared') {
    if (r.verification === 'failed') c.failed += k;
    else if (r.verification === 'exception' || r.verification === 'escalated') c.exceptions += k;
    else if (r.verification === 'verified') c.awaitingClearance += k;
    else c.notStarted += k;
  }
}
export const add = (a: Counts, b: Counts): Counts => Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof Counts] + b[k as keyof Counts]])) as unknown as Counts;

/** Counts for an institution's session: JAMB's records, adjusted by what's been done on the platform. */
export function countsOf(code: string, s: Session, state: JambState = current): Counts {
  const b = baseCounts(code, s);
  const c: Counts = {
    admitted: b.admitted, verified: b.cleared + b.verifiedAwaiting, cleared: b.cleared, pending: b.admitted - b.cleared,
    failed: b.failed, exceptions: b.exceptions, awaitingClearance: b.verifiedAwaiting,
    notStarted: b.admitted - b.cleared - b.failed - b.exceptions - b.verifiedAwaiting,
  };
  for (const r of scenarioRecords(code, s)) { c.admitted += 1; bump(c, recordOf(r.reg, state)!, 1); }
  const inst = institutionByCode(code)!;
  for (const [reg, o] of Object.entries(state.students)) {
    if (scenarioByReg(reg)) continue;
    const p = parseRegistration(reg);
    if (!p.ok || p.institution.code !== code || p.session !== s) continue;
    const base = baseRecord(inst, s, p.index);
    bump(c, base, -1);
    bump(c, { ...base, ...o } as StudentRecord, 1);
  }
  return c;
}
export const institutionCounts = (code: string, state: JambState = current) => SESSIONS.map((s) => countsOf(code, s, state)).reduce(add, zero());
export const sessionTotals = (s: Session, state: JambState = current) => INSTITUTIONS.map((i) => countsOf(i.code, s, state)).reduce(add, zero());
export const nationalCounts = (state: JambState = current) => INSTITUTIONS.map((i) => institutionCounts(i.code, state)).reduce(add, zero());

/* ---------------- officers ---------------- */

export function officerFor(accountEmail: string | undefined): Officer {
  const p = JAMB_PERSONAS.find((x) => x.email === accountEmail) ?? JAMB_PERSONAS[0];
  const inst = p.institution ? institutionByCode(p.institution) : undefined;
  return { name: `${p.firstName} ${p.lastName}`, email: p.email, role: p.consoleRole, title: p.role, organisation: inst?.name ?? p.organization, institution: p.institution };
}

/* ---------------- seeded history (derived, deterministic) ---------------- */

const titleFor = (kind: Activity['kind']) => (kind === 'nysc' ? 'NYSC Verification Officer' : 'Institutional Clearance Officer');
function activityFromRecord(r: StudentRecord): Activity {
  const inst = institutionByCode(r.institution)!;
  const outcome: ActivityOutcome = r.verification === 'failed' ? 'face-mismatch' : r.verification === 'exception' ? 'nin-mismatch' : 'identity-confirmed';
  return {
    ref: r.verificationRef!, at: r.verifiedAt!, kind: 'university', eventId: eventForSession(r.session).id, officer: r.verifiedBy!, officerTitle: titleFor('university'),
    organisation: inst.name, institution: inst.code, session: r.session, input: r.reg, reg: r.reg, outcome,
    checks: { face: outcome === 'face-mismatch' ? 'no-match' : 'match', nin: outcome === 'face-mismatch' ? undefined : outcome === 'nin-mismatch' ? 'mismatch' : 'match' }, captureMode: 'camera',
  };
}

let seededUniversity: Activity[] | null = null;
/** University verifications already on record for the active admission session (newest first). */
export function seededUniversityActivities(): Activity[] {
  if (seededUniversity) return seededUniversity;
  const list: Activity[] = [];
  for (const inst of INSTITUTIONS) {
    for (const index of verifiedIndexes(inst.code, ACTIVE_SESSION)) list.push(activityFromRecord(baseRecord(inst, ACTIVE_SESSION, index)));
  }
  seededUniversity = list.sort((a, b) => b.at.localeCompare(a.at));
  return seededUniversity;
}
/** An institution's verifications on record, all sessions (newest first). */
export function institutionActivities(code: string, state: JambState = current): Activity[] {
  const inst = institutionByCode(code)!;
  const seeded = SESSIONS.flatMap((s) => verifiedIndexes(code, s).map((i) => activityFromRecord(baseRecord(inst, s, i))));
  return [...state.activities.filter((a) => a.institution === code), ...seeded].sort((a, b) => b.at.localeCompare(a.at));
}

export const NYSC_OFFICERS = ['Hadiza Lawal', 'Kelechi Amadi', 'Rotimi Babalola'];
let seededNysc: Activity[] | null = null;
/** NYSC verifications already on record (2022/2023 entrants presenting for NYSC). */
export function seededNyscActivities(): Activity[] {
  if (seededNysc) return seededNysc;
  const r = rng('nysc-seed');
  const out: Activity[] = [];
  const s: Session = '2022/2023';
  const from = Date.UTC(2026, 8, 1, 9); const to = Date.UTC(2026, 10, 14, 16);
  INSTITUTIONS.slice(0, 18).forEach((inst, k) => {
    const c = baseCounts(inst.code, s);
    const order = verifiedIndexes(inst.code, s);
    const picks = [order[k % Math.max(1, c.cleared)], order[(k * 7 + 3) % Math.max(1, c.cleared)]];
    picks.forEach((index, j) => {
      const rec = baseRecord(inst, s, index);
      const roll = r();
      const outcome: NyscOutcome = roll < 0.08 ? 'face-mismatch' : 'confirmed';
      out.push({
        ref: `NYV-2026-${String(400000 + k * 97 + j * 13).padStart(6, '0')}`, at: workingHours(from + r() * (to - from), r), kind: 'nysc', eventId: NYSC_EVENT_ID,
        officer: NYSC_OFFICERS[(k + j) % 3], officerTitle: titleFor('nysc'), organisation: 'National Youth Service Corps', input: rec.reg, reg: rec.reg, outcome,
        checks: { face: outcome === 'face-mismatch' ? 'no-match' : 'match', nin: 'match' }, captureMode: 'camera',
      });
    });
    // A few candidates who never completed clearance.
    if (k % 5 === 2) {
      const pendingIndex = shufflePending(inst.code, s);
      if (pendingIndex !== undefined) {
        const rec = baseRecord(inst, s, pendingIndex);
        out.push({
          ref: `NYV-2026-${String(500000 + k * 31).padStart(6, '0')}`, at: workingHours(from + r() * (to - from), r), kind: 'nysc', eventId: NYSC_EVENT_ID,
          officer: NYSC_OFFICERS[k % 3], officerTitle: titleFor('nysc'), organisation: 'National Youth Service Corps', input: rec.reg, reg: rec.reg,
          outcome: 'clearance-not-confirmed', checks: { face: 'match', nin: 'match' }, captureMode: 'camera',
        });
      }
    }
  });
  seededNysc = out.sort((a, b) => b.at.localeCompare(a.at));
  return seededNysc;
}
function shufflePending(code: string, s: Session): number | undefined {
  const c = baseCounts(code, s);
  for (let i = 0; i < c.admitted; i++) {
    const rec = baseRecord(institutionByCode(code)!, s, i);
    if (rec.verification === 'not-started') return i;
  }
  return undefined;
}

/** Every verification activity: recorded on the platform now, then those on record (newest first). */
export function allActivities(state: JambState = current): Activity[] {
  return [...state.activities, ...seededNyscActivities(), ...seededUniversityActivities()].sort((a, b) => b.at.localeCompare(a.at));
}
export function activitiesFor(reg: string, state: JambState = current): Activity[] {
  const base = baseRecordOf(reg);
  const seeded = base?.verificationRef && base.verifiedAt ? [activityFromRecord(base)] : [];
  return [...state.activities.filter((a) => a.reg === base?.reg), ...seededNyscActivities().filter((a) => a.reg === base?.reg), ...seeded].sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------------- exceptions register ---------------- */

export const JAMB_REVIEWERS = ['Grace Uwaifo', 'Musa Idris', 'Aisha Danjuma'];
const ESCALATING = ['UI', 'ABU', 'OAU', 'UNIBEN', 'UNIPORT', 'LASU', 'UNN'];

/** The identity comparisons shown for an outcome (predefined; no biometric service is called). */
export function comparisonsFor(outcome: UniversityOutcome): Comparison[] {
  if (outcome === 'exam-mismatch') {
    // The live capture is compared independently against each record; JAMB vs NIN isn't needed for the decision.
    return [{ label: 'JAMB examination record vs Live Capture', result: 'mismatch' }, { label: 'NIN identity record vs Live Capture', result: 'match' }];
  }
  // The live capture is compared independently against each record; JAMB and NIN aren't compared with each other.
  const discrepancy = outcome === 'nin-mismatch';
  return [
    { label: 'JAMB vs Live Capture', result: outcome === 'face-mismatch' ? 'mismatch' : 'match' },
    { label: 'NIN vs Live Capture', result: discrepancy ? 'mismatch' : outcome === 'face-mismatch' ? 'pending' : 'match' },
  ];
}
let seededExceptions: JambException[] | null = null;
function ev(id: string, at: string, action: ExceptionAction, actor: string, org: string, from?: ExceptionStatus, to?: ExceptionStatus, comment?: string): ExceptionEvent {
  return { id, at, action, actorId: actor, actorName: actor, actorOrganizationId: org, fromStatus: from, toStatus: to, comment };
}
const plus = (iso: string, hours: number) => new Date(new Date(iso).getTime() + hours * 36e5).toISOString();

/** Exceptions raised by institutional clearance on record (deterministic). */
export function seededExceptionList(): JambException[] {
  if (seededExceptions) return seededExceptions;
  const out: JambException[] = [];
  for (const inst of INSTITUTIONS) {
    for (const s of SESSIONS) {
      for (const { index, kind } of issueIndexes(inst.code, s)) {
        const rec = baseRecord(inst, s, index);
        const r = rng(`${rec.reg}|exc`);
        const roll = r();
        const category: ExceptionCategory = kind === 'failed' ? (roll < 0.72 ? 'failed-verification' : 'potential-fraud')
          : roll < 0.5 ? 'jamb-nin-discrepancy' : roll < 0.82 ? 'record-inconsistency' : 'manual-review';
        const id = `EXC-${sessionYear(s)}-${String(10000 + Math.floor(r() * 89999))}`;
        const reviewer = JAMB_REVIEWERS[Math.floor(r() * 2)];
        const active = s === ACTIVE_SESSION;
        const stRoll = r();
        const status: ExceptionStatus = !active ? (stRoll < 0.6 ? 'resolved' : 'closed')
          : stRoll < 0.3 ? 'resolved' : stRoll < 0.4 ? 'closed' : stRoll < 0.6 ? 'open' : stRoll < 0.75 ? 'assigned' : stRoll < 0.94 ? 'in-review' : 'awaiting-information';
        const raised = rec.verifiedAt!;
        const history: ExceptionEvent[] = [ev(`${id}-1`, raised, 'created', rec.verifiedBy!, inst.name, undefined, 'open', 'Raised at institutional clearance.')];
        if (status !== 'open') history.push(ev(`${id}-2`, plus(raised, 24), 'assigned', 'Aisha Danjuma', 'JAMB', 'open', 'assigned', `Assigned to ${reviewer}.`));
        if (['in-review', 'awaiting-information', 'resolved', 'closed'].includes(status)) history.push(ev(`${id}-3`, plus(raised, 26), 'review-started', reviewer, 'JAMB', 'assigned', 'in-review'));
        if (status === 'awaiting-information') history.push(ev(`${id}-4`, plus(raised, 50), 'information-requested', reviewer, 'JAMB', 'in-review', 'awaiting-information', 'Requested the candidate’s NIN slip and admission letter from the institution.'));
        let resolution: JambException['resolution'];
        if (status === 'resolved' || status === 'closed') {
          const outcome: ExceptionResolution = category === 'failed-verification' || category === 'potential-fraud' ? 'identity-not-confirmed' : category === 'record-inconsistency' ? 'record-corrected' : 'identity-confirmed';
          const note = outcome === 'identity-not-confirmed' ? 'Candidate did not attend the in-person review. Clearance remains blocked.' : outcome === 'record-corrected' ? 'Biodata corrected against the NIMC record; institution notified.' : 'Candidate attended JAMB office with valid NIN; discrepancy explained by a name change.';
          history.push(ev(`${id}-5`, plus(raised, 144), 'resolution-recorded', reviewer, 'JAMB', 'in-review', 'resolved', note));
          if (status === 'closed') history.push(ev(`${id}-6`, plus(raised, 168), 'closed', reviewer, 'JAMB', 'resolved', 'closed'));
          resolution = { outcome, note, at: plus(raised, 144), by: reviewer };
        }
        // A few active-session cases reached JAMB as escalations from the institution.
        const escalated = active && kind === 'exception' && ESCALATING.includes(inst.code) && !out.some((x) => x.institution === inst.code && x.escalation);
        out.push({
          id: escalated ? id.replace(/^EXC-\d{4}/, `ESC-${new Date(raised).getUTCFullYear()}`) : id, reg: rec.reg, institution: inst.code, session: s, eventId: eventForSession(s).id, category,
          escalation: escalated ? {
            comment: category === 'jamb-nin-discrepancy' ? 'The live portrait matches the original JAMB registration portrait. However, the NIN portrait returned during verification does not match the captured face. Kindly investigate and confirm the student’s identity.'
              : 'The student’s name and date of birth on our admission list differ from the JAMB record. Kindly confirm the correct record.',
            submittedBy: rec.verifiedBy!, submittedByTitle: 'Institutional Clearance Officer', institution: inst.code, submittedAt: raised,
            evidence: ['Identity comparison results', 'Verification reference'],
            comparisons: comparisonsFor(category === 'jamb-nin-discrepancy' ? 'nin-mismatch' : 'identity-confirmed'),
          } : undefined,
          summary: summaryFor(category), raisedAt: raised, raisedBy: rec.verifiedBy!, raisedByOrganisation: inst.name, status,
          assignedTo: status === 'open' ? undefined : reviewer, activityRef: rec.verificationRef, history, resolution,
          evidence: kind === 'failed'
            ? [{ label: 'Face match against JAMB registration portrait', value: 'No match', tone: 'bad' }, { label: 'Verification reference', value: rec.verificationRef! }]
            : [{ label: 'Face match against JAMB registration portrait', value: 'Match', tone: 'good' }, { label: 'NIN verification response', value: category === 'jamb-nin-discrepancy' ? 'Mismatch' : 'Match', tone: category === 'jamb-nin-discrepancy' ? 'bad' : 'good' }, { label: 'Verification reference', value: rec.verificationRef! }],
        });
      }
    }
  }
  seededExceptions = out;
  return out;
}
function summaryFor(c: ExceptionCategory) {
  return {
    'jamb-nin-discrepancy': 'The presented face matched the JAMB registration record, but the NIN verification response did not match.',
    'exam-impersonation': 'The live clearance capture matches the NIN identity record but not the face on the JAMB examination verification record.',
    'nysc-identity-discrepancy': 'At NYSC verification the live capture matched the NIN identity record but not the JAMB profile photograph.',
    'admission-inquiry': 'The candidate’s JAMB registration is valid, but no admission offer was found for the institution and admission session checked.',
    'nysc-clearance-not-confirmed': 'At NYSC verification the candidate’s identity was confirmed, but no confirmed institutional admission clearance record was found.',
    'potential-fraud': 'The presented face did not match the JAMB registration record; the person presenting may not be the candidate.',
    'duplicate-clearance': 'The same JAMB admission record has already been cleared by another institution.',
    'record-inconsistency': 'The candidate’s biodata differs between the JAMB record and the institution’s admission list.',
    'failed-verification': 'The presented face did not match the JAMB registration record.',
    'manual-review': 'The verification result needs a manual review by JAMB before clearance.',
  }[c];
}

export function exceptionsOf(state: JambState = current): JambException[] {
  const all = [...state.createdExceptions, ...seededExceptionList()];
  return all.map((e) => (state.exceptions[e.id] ? { ...e, ...state.exceptions[e.id] } as JambException : e)).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
}
export const exceptionById = (id: string, state: JambState = current) => exceptionsOf(state).find((e) => e.id === id);
export const exceptionsForReg = (reg: string, state: JambState = current) => exceptionsOf(state).filter((e) => e.reg === reg);
export const isOpenException = (e: JambException) => OPEN_STATUSES.includes(e.status);

/* ---------------- users ---------------- */

let seededUsers: PlatformUser[] | null = null;
const emailOf = (name: string, domain: string) => `${name.split(' ')[0][0].toLowerCase()}.${name.split(' ').slice(-1)[0].toLowerCase()}@${domain}`;
export function seededUserList(): PlatformUser[] {
  if (seededUsers) return seededUsers;
  const at = '2025-10-06T09:00:00.000Z';
  const list: PlatformUser[] = [
    { id: 'usr-jamb-1', name: 'Aisha Danjuma', email: 'jamb.officer@jamb-demo.example', organisation: 'JAMB', role: 'jamb-admin', status: 'active', createdAt: '2022-08-01T09:00:00.000Z', createdBy: 'System', lastActiveAt: '2026-11-14T15:20:00.000Z' },
    { id: 'usr-jamb-2', name: 'Emmanuel Okoro', email: 'e.okoro@jamb-demo.example', organisation: 'JAMB', role: 'jamb-admin', status: 'active', createdAt: '2022-08-01T09:00:00.000Z', createdBy: 'System', lastActiveAt: '2026-11-13T10:05:00.000Z' },
    { id: 'usr-jamb-3', name: 'Grace Uwaifo', email: 'g.uwaifo@jamb-demo.example', organisation: 'JAMB', role: 'jamb-reviewer', status: 'active', createdAt: '2023-03-14T09:00:00.000Z', createdBy: 'Emmanuel Okoro', lastActiveAt: '2026-11-14T11:42:00.000Z' },
    { id: 'usr-jamb-4', name: 'Musa Idris', email: 'm.idris@jamb-demo.example', organisation: 'JAMB', role: 'jamb-reviewer', status: 'active', createdAt: '2024-01-22T09:00:00.000Z', createdBy: 'Aisha Danjuma', lastActiveAt: '2026-11-12T16:30:00.000Z' },
    { id: 'usr-nysc-1', name: 'Hadiza Lawal', email: 'nysc.officer@nysc-demo.example', organisation: 'NYSC', role: 'nysc-officer', status: 'active', createdAt: '2026-02-24T09:00:00.000Z', createdBy: 'Aisha Danjuma', lastActiveAt: '2026-11-14T13:10:00.000Z' },
    { id: 'usr-nysc-2', name: 'Kelechi Amadi', email: 'k.amadi@nysc-demo.example', organisation: 'NYSC', role: 'nysc-officer', status: 'active', createdAt: '2026-02-24T09:00:00.000Z', createdBy: 'Aisha Danjuma', lastActiveAt: '2026-11-13T12:00:00.000Z' },
    { id: 'usr-nysc-3', name: 'Rotimi Babalola', email: 'r.babalola@nysc-demo.example', organisation: 'NYSC', role: 'nysc-officer', status: 'active', createdAt: '2026-03-10T09:00:00.000Z', createdBy: 'Aisha Danjuma', lastActiveAt: '2026-11-11T09:40:00.000Z' },
  ];
  for (const inst of INSTITUTIONS) {
    officersOf(inst.code).forEach((name, k) => {
      const demo = inst.code === UNILAG.code && k === 0;
      list.push({
        id: `usr-${inst.code.toLowerCase()}-${k + 1}`, name, email: demo ? 'clearance.officer@unilag-demo.example' : emailOf(name, `${inst.code.toLowerCase()}-demo.example`),
        organisation: inst.code, role: k === 2 ? 'clearance-supervisor' : 'clearance-officer', status: 'active', createdAt: at, createdBy: 'Aisha Danjuma',
        lastActiveAt: new Date(Date.UTC(2026, 10, 14 - ((inst.n + k) % 9), 10 + k)).toISOString(),
      });
    });
  }
  seededUsers = list;
  return list;
}
export function usersOf(state: JambState = current): PlatformUser[] {
  return [...seededUserList(), ...state.invitedUsers].map((u) => (state.users[u.id] ? { ...u, ...state.users[u.id] } as PlatformUser : u));
}
export const organisationName = (org: string) => (org === 'JAMB' ? 'Joint Admissions and Matriculation Board' : org === 'NYSC' ? 'National Youth Service Corps' : institutionByCode(org)?.name ?? org);
/** Whether JAMB has disabled this person's access. */
export const accessDisabled = (email: string | undefined, state: JambState = current) => !!email && usersOf(state).some((u) => u.email === email && u.status === 'disabled');

/* ---------------- audit ---------------- */

function audit(state: JambState, officer: Officer, action: string, extra: Partial<AuditEntry> = {}): JambState {
  const entry: AuditEntry = { id: `AUD-${Date.now().toString(36)}-${code6()}`, at: now(), user: officer.name, role: officer.title, organisation: officer.organisation, action, ...extra };
  return { ...state, audit: [entry, ...state.audit] };
}
/** The audit trail: platform actions, then verifications on record. */
export function auditLog(state: JambState = current): AuditEntry[] {
  const seeded: AuditEntry[] = [...seededNyscActivities(), ...seededUniversityActivities().slice(0, 150)].map((a) => {
    const r = a.reg ? recordOf(a.reg, state) : undefined;
    return { id: `AUD-${a.ref}`, at: a.at, user: a.officer, role: a.officerTitle, organisation: a.organisation, action: a.kind === 'nysc' ? 'NYSC identity verification' : 'Identity verification at clearance', reg: a.reg, student: r ? `${r.firstName} ${r.lastName}` : undefined, outcome: OUTCOME_LABEL[a.outcome], reference: a.ref };
  });
  return [...state.audit, ...seeded].sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------------- actions ---------------- */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const studentName = (r: StudentRecord) => `${r.firstName} ${r.lastName}`;

/** The registration numbers a clearance officer may open: their own institution's admission records. */
export type ClearanceLookup =
  | { ok: true; record: StudentRecord }
  | { ok: false; outcome: 'invalid' | 'not-found' }
  /** Valid JAMB registration, but no admission offer for the institution and session checked (Scenario 4). */
  | { ok: false; outcome: 'admission-not-found'; registrant: Registrant; session: Session };
export function lookupForClearance(input: string, officer: Officer, session: Session = ACTIVE_SESSION): ClearanceLookup {
  const registrant = registrantByReg(input);
  if (registrant) return { ok: false, outcome: 'admission-not-found', registrant, session };
  const p = parseRegistration(input);
  if (!p.ok) return { ok: false, outcome: p.reason === 'format' ? 'invalid' : 'not-found' };
  if (p.institution.code !== officer.institution || p.session !== session) return { ok: false, outcome: 'not-found' };
  return { ok: true, record: recordOf(normaliseReg(input))! };
}

/** What JAMB's identity services return for the student at clearance (predefined per record; no live service is called). */
export function universityResponse(r: StudentRecord): Exclude<UniversityOutcome, 'not-found' | 'invalid'> {
  const s = scenarioByReg(r.reg);
  // JAMB has adjudicated the NIN discrepancy and confirmed the identity: it no longer blocks verification.
  if (ninResolvedByJamb(r.reg) || duplicateReleasedByJamb(r.reg)) return 'identity-confirmed';
  if (s?.university) return s.university;
  if (priorClearanceOf(r.reg)) return 'duplicate-clearance';
  const base = baseRecordOf(r.reg)!;
  return base.verification === 'failed' ? 'face-mismatch' : base.verification === 'exception' ? 'nin-mismatch' : 'identity-confirmed';
}

/** Whether JAMB resolved the student's latest JAMB/NIN discrepancy as identity confirmed. */
export function ninResolvedByJamb(reg: string, state: JambState = current): boolean {
  return !!resolvedDiscrepancy(reg, state);
}
/** Which identity discrepancy JAMB resolved as identity confirmed, if any: the NIN record, or the examination record. */
export function resolvedDiscrepancy(reg: string, state: JambState = current): 'nin' | 'exam' | undefined {
  const e = exceptionsOf(state).find((x) => x.reg === reg && (x.category === 'jamb-nin-discrepancy' || x.category === 'exam-impersonation'));
  if (e?.resolution?.outcome !== 'identity-confirmed') return undefined;
  return e.category === 'exam-impersonation' ? 'exam' : 'nin';
}

/** Whether JAMB released the student to clear here despite a previous clearance elsewhere. */
export function duplicateReleasedByJamb(reg: string, state: JambState = current): boolean {
  const e = exceptionsOf(state).find((x) => x.reg === reg && x.category === 'duplicate-clearance');
  return ['release-authorised', 'previous-clearance-revoked', 'withdrawal-confirmed', 'next-step-authorised'].includes(e?.resolution?.outcome ?? '');
}

function newException(state: JambState, r: StudentRecord, officer: Officer, category: ExceptionCategory, evidence: Evidence[], activityRef: string): [JambState, JambException] {
  const id = `EXC-${new Date().getFullYear()}-${code6().slice(0, 5)}`;
  const at = now();
  const e: JambException = {
    id, reg: r.reg, institution: r.institution, session: r.session, eventId: eventForSession(r.session).id, category, summary: summaryFor(category),
    raisedAt: at, raisedBy: officer.name, raisedByOrganisation: officer.organisation, status: 'open', evidence, activityRef,
    history: [ev(`${id}-1`, at, 'created', officer.name, officer.organisation, undefined, 'open', officer.role === 'nysc-officer' ? 'Referred by NYSC for review.' : 'Raised automatically at institutional clearance.')],
  };
  return [{ ...state, createdExceptions: [e, ...state.createdExceptions] }, e];
}

/**
 * An existing clearance at another institution found when the officer looks the student up. It's a record
 * issue (no capture, no biometric result): clearance is held until JAMB decides. Recorded once.
 */
export function recordExistingClearance(reg: string, officer: Officer): Result<StudentRecord> {
  const r = recordOf(reg);
  if (!r) return { ok: false, error: 'Student record not found.' };
  if (officer.role !== 'clearance-officer' || r.institution !== officer.institution) return { ok: false, error: 'Only this institution’s clearance officer can check the student.' };
  if (!priorClearanceOf(reg) || duplicateReleasedByJamb(reg) || r.clearance === 'cleared' || r.blocked === 'duplicate-clearance') return { ok: true, value: r };
  const at = now();
  const ref = `JIV-${officer.institution}-${new Date().getFullYear()}-${code6()}`;
  let state: JambState = { ...current, students: { ...current.students, [reg]: { ...current.students[reg], verification: 'exception', blocked: 'duplicate-clearance', verifiedAt: at, verifiedBy: officer.name, verificationRef: ref } } };
  state = { ...state, activities: [{ ref, at, kind: 'university', eventId: eventForSession(r.session).id, officer: officer.name, officerTitle: officer.title, organisation: officer.organisation, institution: r.institution, session: r.session, input: reg, reg, outcome: 'duplicate-clearance' }, ...state.activities] };
  save(audit(state, officer, 'Existing clearance record found', { reg, student: studentName(r), outcome: OUTCOME_LABEL['duplicate-clearance'], reference: ref }));
  return { ok: true, value: recordOf(reg)! };
}

/** Records a university identity verification (any outcome) and its consequences for the student. */
export function recordUniversityVerification(input: { entered: string; officer: Officer; captureMode: 'camera' | 'demo'; record?: StudentRecord; outcome?: 'not-found' | 'invalid' | 'admission-not-found'; session?: Session }): Result<Activity> {
  const { officer, record } = input;
  if (officer.role !== 'clearance-officer' || !officer.institution) return { ok: false, error: 'Only an institution’s clearance officer can verify students.' };
  if (record && record.institution !== officer.institution) return { ok: false, error: 'This student isn’t on your institution’s admission list.' };
  if (record?.clearance === 'cleared') return { ok: false, error: 'This student has already been cleared.' };
  const outcome = record ? universityResponse(record) : input.outcome ?? 'not-found';
  const at = now();
  const year = new Date().getFullYear();
  const activity: Activity = {
    ref: `JIV-${officer.institution}-${year}-${code6()}`, at, kind: 'university', eventId: eventForSession(record?.session ?? input.session ?? ACTIVE_SESSION).id, officer: officer.name, officerTitle: officer.title,
    organisation: officer.organisation, institution: officer.institution, session: record?.session ?? input.session ?? ACTIVE_SESSION, input: input.entered.trim(), reg: record?.reg, outcome,
    checks: record ? (() => {
      const resolved = outcome === 'identity-confirmed' ? resolvedDiscrepancy(record.reg) : undefined;
      return {
        face: outcome === 'face-mismatch' || outcome === 'exam-mismatch' || resolved === 'exam' ? 'no-match' as const : 'match' as const,
        nin: outcome === 'face-mismatch' ? undefined : outcome === 'nin-mismatch' || resolved === 'nin' ? 'mismatch' as const : 'match' as const,
      };
    })() : undefined,
    captureMode: record ? input.captureMode : undefined,
  };
  let state = current;
  if (record) {
    const o: StudentOverride = { verifiedAt: at, verifiedBy: officer.name, verificationRef: activity.ref };
    if (outcome === 'identity-confirmed') Object.assign(o, { verification: 'verified', nin: activity.checks?.nin ?? 'match', blocked: null });
    else if (outcome === 'face-mismatch') Object.assign(o, { verification: 'failed' });
    else if (outcome === 'nin-mismatch') Object.assign(o, { verification: 'exception', nin: 'mismatch', blocked: 'nin-mismatch' });
    else if (outcome === 'exam-mismatch') Object.assign(o, { verification: 'exception', nin: 'match', blocked: 'exam-mismatch' });
    else Object.assign(o, { verification: 'exception', nin: 'match', blocked: 'duplicate-clearance' });
    state = { ...state, students: { ...state.students, [record.reg]: { ...state.students[record.reg], ...o } } };
    // A failed face match is raised automatically. Discrepancies and existing clearances wait for the officer to escalate.
    if (outcome === 'face-mismatch') {
      const category: ExceptionCategory = 'failed-verification';
      const evidence: Evidence[] = [{ label: 'Face match against JAMB registration portrait', value: 'No match', tone: 'bad' }];
      evidence.push({ label: 'Capture', value: input.captureMode === 'camera' ? 'Live camera capture' : 'Demo face' }, { label: 'Verification reference', value: activity.ref });
      const [next, e] = newException(state, record, officer, category, evidence, activity.ref);
      state = next;
      activity.exceptionId = e.id;
    }
  }
  state = { ...state, activities: [activity, ...state.activities] };
  state = audit(state, officer, 'Identity verification at clearance', { reg: record?.reg, student: record ? studentName(record) : undefined, outcome: OUTCOME_LABEL[outcome], reference: activity.ref });
  save(state);
  return { ok: true, value: activity };
}

/** Institutional clearance: a separate decision, only after a successful identity verification and never while blocked. */
export function confirmClearance(reg: string, officer: Officer): Result<StudentRecord> {
  const r = recordOf(reg);
  if (!r) return { ok: false, error: 'Student record not found.' };
  if (officer.role !== 'clearance-officer' || r.institution !== officer.institution) return { ok: false, error: 'Only this institution’s clearance officer can clear the student.' };
  if (r.clearance === 'cleared') return { ok: false, error: 'This student has already been cleared.' };
  if (r.blocked) return { ok: false, error: 'Clearance is blocked until JAMB resolves the exception.' };
  if (r.verification !== 'verified') return { ok: false, error: 'Identity must be verified successfully before clearance.' };
  const at = now();
  const ref = `JCL-${r.institution}-${new Date().getFullYear()}-${code6()}`;
  let state: JambState = { ...current, students: { ...current.students, [reg]: { ...current.students[reg], clearance: 'cleared', clearedAt: at, clearedBy: officer.name, clearanceRef: ref } } };
  state = { ...state, activities: [{ ref, at, kind: 'university', eventId: eventForSession(r.session).id, officer: officer.name, officerTitle: officer.title, organisation: officer.organisation, institution: r.institution, session: r.session, input: reg, reg, outcome: 'clearance-completed' }, ...state.activities] };
  save(audit(state, officer, 'Clearance completed', { reg, student: studentName(r), outcome: 'Cleared', reference: ref }));
  return { ok: true, value: recordOf(reg)! };
}

/* ---------------- NYSC ---------------- */

/** What NYSC verification establishes (the face response is predefined per candidate; no live service is called). */
export function nyscResponse(r: StudentRecord): Exclude<NyscOutcome, 'not-found' | 'invalid'> {
  const s = scenarioByReg(r.reg);
  if (s?.nysc === 'face-mismatch') return 'face-mismatch';
  return r.clearance === 'cleared' ? 'confirmed' : 'clearance-not-confirmed';
}

export function lookupForNysc(input: string): { ok: true; record: StudentRecord } | { ok: false; outcome: 'invalid' | 'not-found' } {
  const p = parseRegistration(input);
  if (!p.ok) return { ok: false, outcome: p.reason === 'format' ? 'invalid' : 'not-found' };
  return { ok: true, record: recordOf(normaliseReg(input))! };
}

export function recordNyscVerification(input: { entered: string; officer: Officer; captureMode: 'camera' | 'demo'; record?: StudentRecord; outcome?: 'not-found' | 'invalid' }): Result<Activity> {
  const { officer, record } = input;
  if (officer.role !== 'nysc-officer') return { ok: false, error: 'Only an NYSC verification officer can verify candidates.' };
  const outcome: NyscOutcome = record ? nyscResponse(record) : input.outcome ?? 'not-found';
  const activity: Activity = {
    ref: `NYV-${new Date().getFullYear()}-${code6()}`, at: now(), kind: 'nysc', eventId: NYSC_EVENT_ID, officer: officer.name, officerTitle: officer.title,
    organisation: officer.organisation, input: input.entered.trim(), reg: record?.reg, outcome, checks: record ? nyscChecks(record) : undefined,
    captureMode: record ? input.captureMode : undefined,
  };
  const state = { ...current, activities: [activity, ...current.activities] };
  save(audit(state, officer, 'NYSC identity verification', { reg: record?.reg, student: record ? studentName(record) : undefined, outcome: OUTCOME_LABEL[outcome], reference: activity.ref }));
  return { ok: true, value: activity };
}

/**
 * The two independent NYSC comparisons: the live capture against the JAMB profile photograph, and against the NIN
 * identity photograph (predefined per candidate; no biometric service is called). JAMB and NIN aren't compared.
 */
export function nyscChecks(r: StudentRecord): { face: 'match' | 'no-match'; nin: 'match' | 'mismatch' } {
  return { face: scenarioByReg(r.reg)?.nysc === 'face-mismatch' ? 'no-match' : 'match', nin: 'match' };
}
export function nyscComparisons(a: Pick<Activity, 'checks'>): Comparison[] {
  return [
    { label: 'JAMB vs Live Capture', result: a.checks?.face === 'no-match' ? 'mismatch' : 'match' },
    { label: 'NIN vs Live Capture', result: a.checks?.nin === 'mismatch' ? 'mismatch' : 'match' },
  ];
}
/** Identity assurance and institutional clearance are separate results of an NYSC verification. */
export function nyscStatuses(a: Pick<Activity, 'outcome'>): { identity: 'confirmed' | 'not-confirmed'; clearance: 'confirmed' | 'not-confirmed' | 'not-assessed' } {
  if (a.outcome === 'face-mismatch') return { identity: 'not-confirmed', clearance: 'not-assessed' };
  return { identity: 'confirmed', clearance: a.outcome === 'confirmed' ? 'confirmed' : 'not-confirmed' };
}

/**
 * NYSC refers a verification to JAMB with the officer's comment: an identity discrepancy (face didn't match the JAMB
 * profile) or an admission clearance that can't be confirmed. It's recorded as an exception for JAMB to review; the
 * candidate is not classified as fraudulent.
 */
export function referToJamb(activityRef: string, officer: Officer, comment = '', capture?: string): Result<JambException> {
  if (officer.role !== 'nysc-officer') return { ok: false, error: 'Only an NYSC verification officer can refer a candidate.' };
  const a = current.activities.find((x) => x.ref === activityRef);
  const r = a?.reg ? recordOf(a.reg) : undefined;
  if (!a || !r) return { ok: false, error: 'Verification not found.' };
  if (a.exceptionId) return { ok: false, error: `Already referred to JAMB (${a.exceptionId}).` };
  if (a.outcome !== 'face-mismatch' && a.outcome !== 'clearance-not-confirmed') return { ok: false, error: 'Only an unconfirmed verification can be referred.' };
  if (!comment.trim()) return { ok: false, error: 'Add a comment for JAMB.' };
  const category: ExceptionCategory = a.outcome === 'face-mismatch' ? 'nysc-identity-discrepancy' : 'nysc-clearance-not-confirmed';
  const comparisons = nyscComparisons(a);
  const inst = institutionByCode(r.institution);
  const evidence: Evidence[] = [
    ...comparisons.map((c): Evidence => ({ label: c.label, value: c.result === 'match' ? 'Match' : 'Mismatch', tone: c.result === 'match' ? 'good' : 'bad' })),
    { label: 'Historical admission clearance', value: r.clearance === 'cleared' ? `Cleared: ${inst?.name}, ${r.clearanceRef}` : `No confirmed clearance record (${inst?.name}, ${r.session})` },
    { label: 'NYSC verification reference', value: a.ref },
  ];
  const at = now();
  const id = `ESC-${new Date().getFullYear()}-${code6().slice(0, 5)}`;
  const e: JambException = {
    id, reg: r.reg, institution: r.institution, session: r.session, eventId: NYSC_EVENT_ID, category, summary: summaryFor(category),
    raisedAt: at, raisedBy: officer.name, raisedByOrganisation: officer.organisation, status: 'open', evidence, activityRef: a.ref,
    history: [ev(`${id}-1`, at, 'created', officer.name, officer.organisation, undefined, 'open', comment.trim())],
    escalation: {
      comment: comment.trim(), submittedBy: officer.name, submittedByTitle: officer.title, institution: r.institution, submittedAt: at, source: 'nysc',
      evidence: category === 'nysc-identity-discrepancy' ? ['Identity comparison results', 'Live capture', 'Historical clearance record'] : ['Identity comparison results', 'Historical clearance record'],
      comparisons, capture,
    },
  };
  let state: JambState = { ...current, createdExceptions: [e, ...current.createdExceptions] };
  state = { ...state, activities: state.activities.map((x) => (x.ref === activityRef ? { ...x, exceptionId: id } : x)) };
  save(audit(state, officer, 'Referred to JAMB for review', { reg: r.reg, student: studentName(r), outcome: CATEGORY_LABEL[category], reference: id }));
  return { ok: true, value: exceptionById(id)! };
}

/* ---------------- JAMB: exceptions ---------------- */

function patchException(id: string, officer: Officer, action: ExceptionAction, change: Partial<JambException>, comment?: string): Result<JambException> {
  const e = exceptionById(id);
  if (!e) return { ok: false, error: 'Exception not found.' };
  if (officer.role !== 'jamb-officer') return { ok: false, error: 'Only JAMB can manage exceptions.' };
  const to = change.status ?? e.status;
  const event = ev(`${id}-${e.history.length + 1}-${code6()}`, now(), action, officer.name, 'JAMB', e.status, to, comment);
  const next = { ...current.exceptions[id], ...change, history: [...e.history, event] };
  let state: JambState = { ...current, exceptions: { ...current.exceptions, [id]: next } };
  state = audit(state, officer, `Exception: ${action.replace(/-/g, ' ')}`, { reg: e.reg, outcome: change.status ? change.status : undefined, reference: id });
  save(state);
  return { ok: true, value: exceptionById(id)! };
}
export const assignException = (id: string, officer: Officer, reviewer: string) => patchException(id, officer, 'assigned', { assignedTo: reviewer, status: 'assigned' }, `Assigned to ${reviewer}.`);
export const startReview = (id: string, officer: Officer) => {
  const e = exceptionById(id);
  return patchException(id, officer, 'review-started', { status: 'in-review', assignedTo: e?.assignedTo ?? officer.name, assignedAt: e?.assignedTo ? e.assignedAt : now() });
};
/** A JAMB officer takes ownership of a case (or assigns it to a colleague). A new case moves to Under review. */
export function assignCase(id: string, officer: Officer, assignee: string = officer.name): Result<JambException> {
  const e = exceptionById(id);
  if (!e) return { ok: false, error: 'Case not found.' };
  if (!assignee.trim()) return { ok: false, error: 'Choose an officer.' };
  if (e.status === 'resolved' || e.status === 'closed') return { ok: false, error: 'This case is already decided.' };
  const status: ExceptionStatus = e.status === 'awaiting-information' ? e.status : 'in-review';
  return patchException(id, officer, 'assigned', { assignedTo: assignee, assignedAt: now(), status }, assignee === officer.name ? `${officer.name} took ownership of the case.` : `Assigned to ${assignee}.`);
}
/** Refers a case to another authorised JAMB team. The case stays under review; the referral is recorded. */
export function referForInvestigation(id: string, officer: Officer, team: string, note: string): Result<JambException> {
  if (!note.trim()) return { ok: false, error: 'Explain why the case is being referred.' };
  const e = exceptionById(id);
  if (!e) return { ok: false, error: 'Case not found.' };
  if (e.status === 'resolved' || e.status === 'closed') return { ok: false, error: 'This case is already decided.' };
  return patchException(id, officer, 'escalated', { status: 'in-review', referredTo: team, assignedTo: e.assignedTo ?? officer.name, assignedAt: e.assignedAt ?? now() }, `Referred to ${team} for further investigation. ${note.trim()}`);
}
/** Closes a decided case. The record, its evidence and its history are kept. */
export function closeCase(id: string, officer: Officer, note = ''): Result<JambException> {
  const e = exceptionById(id);
  if (!e) return { ok: false, error: 'Case not found.' };
  if (e.status !== 'resolved') return { ok: false, error: 'Record a decision before closing the case.' };
  return patchException(id, officer, 'closed', { status: 'closed', closedAt: now() }, note.trim() || 'Case closed. The decision was returned to the originating institution.');
}
export const addExceptionNote = (id: string, officer: Officer, note: string) => (note.trim() ? patchException(id, officer, 'note-added', {}, note.trim()) : { ok: false as const, error: 'Write a note first.' });
export const requestInformation = (id: string, officer: Officer, note: string) => patchException(id, officer, 'information-requested', { status: 'awaiting-information' }, note.trim() || 'Further information requested from the institution.');
export const closeException = (id: string, officer: Officer) => patchException(id, officer, 'closed', { status: 'closed' });
export const reopenException = (id: string, officer: Officer, note: string) => patchException(id, officer, 'reopened', { status: 'reopened', resolution: undefined }, note.trim() || 'Reopened for further review.');

/** Records JAMB's resolution. Confirming identity on a JAMB/NIN discrepancy lifts the clearance block. */
export function resolveException(id: string, officer: Officer, outcome: ExceptionResolution, note: string, details: ResolutionDetails = {}): Result<JambException> {
  if (!note.trim()) return { ok: false, error: 'Explain the decision.' };
  const e = exceptionById(id);
  if (!e) return { ok: false, error: 'Exception not found.' };
  if (e.status === 'resolved' || e.status === 'closed') return { ok: false, error: 'This case is already decided.' };
  if (DECISION_NEEDS_PLACEMENT.includes(outcome) && (!details.institution || !details.session)) return { ok: false, error: 'Record the institution and admission session JAMB found.' };
  const clean: ResolutionDetails = Object.fromEntries(Object.entries(details).filter(([, v]) => typeof v === 'string' && v.trim())) as ResolutionDetails;
  const r = patchException(id, officer, 'resolution-recorded', {
    status: 'resolved', assignedTo: e.assignedTo ?? officer.name, assignedAt: e.assignedAt ?? now(),
    resolution: { outcome, note: note.trim(), at: now(), by: officer.name, ...(Object.keys(clean).length ? { details: clean } : {}) },
  }, note.trim());
  const s = current.students[e.reg] ?? {};
  if (r.ok && outcome === 'identity-confirmed' && (e.category === 'jamb-nin-discrepancy' || e.category === 'exam-impersonation')) {
    if (s.blocked === 'nin-mismatch' || s.blocked === 'exam-mismatch') save({ ...current, students: { ...current.students, [e.reg]: { ...s, blocked: null, verification: 'verified' } } });
  } else if (r.ok && (outcome === 'release-authorised' || outcome === 'previous-clearance-revoked' || outcome === 'withdrawal-confirmed' || outcome === 'next-step-authorised') && e.category === 'duplicate-clearance') {
    if (s.blocked === 'duplicate-clearance') save({ ...current, students: { ...current.students, [e.reg]: { ...s, blocked: null, verification: 'verified' } } });
  } else if (r.ok && s.verification === 'escalated') {
    // Decided without lifting the block: the student stays blocked, no longer awaiting JAMB.
    save({ ...current, students: { ...current.students, [e.reg]: { ...s, verification: 'exception' } } });
  }
  return r.ok ? { ok: true, value: exceptionById(id)! } : r;
}

/* ---------------- escalations ---------------- */

export const escalationsOf = (state: JambState = current) => exceptionsOf(state).filter((e) => e.escalation);
export const escalationFor = (reg: string, state: JambState = current) => escalationsOf(state).find((e) => e.reg === reg);
export function escalationStatus(e: JambException): EscalationStatus {
  if (e.status === 'closed') return 'closed';
  if (e.status === 'resolved') return 'resolved';
  if (e.status === 'in-review' || e.status === 'assigned') return 'in-review';
  if (e.status === 'awaiting-information') return 'awaiting-information';
  return 'open';
}
/** JAMB's latest response on an escalation (a comment, an information request or the decision). */
export function jambResponse(e: JambException): ExceptionEvent | undefined {
  return [...e.history].reverse().find((h) => h.actorOrganizationId === 'JAMB' && (h.comment || h.action === 'review-started'));
}

/** The university escalates a discrepancy or an existing clearance to JAMB. Clearance stays pending JAMB's review. */
export function escalateToJamb(input: { reg: string; officer: Officer; category: ExceptionCategory; reason?: string; comment: string; evidence: string[]; capture?: string }): Result<JambException> {
  const { officer } = input;
  const r = recordOf(input.reg);
  if (!r) return { ok: false, error: 'Student record not found.' };
  if (officer.role !== 'clearance-officer' || r.institution !== officer.institution) return { ok: false, error: 'Only this institution’s clearance officer can escalate the student.' };
  if (r.clearance === 'cleared') return { ok: false, error: 'This student has already been cleared.' };
  if (!input.comment.trim()) return { ok: false, error: 'Describe the issue for JAMB.' };
  const open = escalationsOf().find((e) => e.reg === r.reg && ['open', 'in-review', 'awaiting-information'].includes(escalationStatus(e)));
  if (open) return { ok: false, error: `This student is already escalated (${open.id}).` };
  const at = now();
  const id = `ESC-${new Date().getFullYear()}-${code6().slice(0, 5)}`;
  const outcome: UniversityOutcome = r.blocked === 'duplicate-clearance' ? 'duplicate-clearance' : r.blocked === 'exam-mismatch' ? 'exam-mismatch' : r.nin === 'mismatch' ? 'nin-mismatch' : r.verification === 'failed' ? 'face-mismatch' : 'identity-confirmed';
  const prior = priorClearanceOf(r.reg);
  // An existing clearance is a record issue, not a biometric result: no face comparisons are attached.
  const comparisons = input.category === 'duplicate-clearance' ? [] : comparisonsFor(outcome);
  const evidence: Evidence[] = comparisons.map((c) => ({ label: c.label, value: c.result === 'match' ? 'Match' : c.result === 'mismatch' ? 'Mismatch' : 'Pending', tone: c.result === 'match' ? 'good' : c.result === 'mismatch' ? 'bad' : 'neutral' }));
  if (prior && input.category === 'duplicate-clearance') {
    evidence.push({ label: 'Previous institution', value: institutionByCode(prior.institution)?.name ?? prior.institution }, { label: 'Previous clearance', value: `${prior.reference}, ${prior.clearedBy}` },
      { label: 'Previous admission session', value: prior.session }, { label: 'Previous clearance status', value: 'Cleared' });
  }
  if (input.reason) evidence.unshift({ label: 'Escalation reason', value: input.reason });
  if (r.verificationRef && input.category !== 'duplicate-clearance') evidence.push({ label: 'Verification reference', value: r.verificationRef });
  const e: JambException = {
    id, reg: r.reg, institution: r.institution, session: r.session, eventId: eventForSession(r.session).id, category: input.category, summary: summaryFor(input.category),
    raisedAt: at, raisedBy: officer.name, raisedByOrganisation: officer.organisation, status: 'open', evidence, activityRef: r.verificationRef,
    history: [ev(`${id}-1`, at, 'created', officer.name, officer.organisation, undefined, 'open', input.comment.trim())],
    escalation: { comment: input.comment.trim(), submittedBy: officer.name, submittedByTitle: officer.title, institution: r.institution, submittedAt: at, reason: input.reason, evidence: input.evidence, comparisons, capture: input.capture },
  };
  let state: JambState = { ...current, createdExceptions: [e, ...current.createdExceptions], students: { ...current.students, [r.reg]: { ...current.students[r.reg], verification: 'escalated' } } };
  state = { ...state, activities: [{ ref: id, at, kind: 'university', eventId: e.eventId, officer: officer.name, officerTitle: officer.title, organisation: officer.organisation, institution: r.institution, session: r.session, input: r.reg, reg: r.reg, outcome: 'escalated', exceptionId: id }, ...state.activities] };
  save(audit(state, officer, 'Escalated to JAMB', { reg: r.reg, student: studentName(r), outcome: CATEGORY_LABEL[input.category], reference: id }));
  return { ok: true, value: exceptionById(id)! };
}

/** The institution answers JAMB's request for information. */
export function respondToEscalation(id: string, officer: Officer, text: string): Result<JambException> {
  const e = exceptionById(id);
  if (!e?.escalation) return { ok: false, error: 'Escalation not found.' };
  if (officer.role !== 'clearance-officer' || e.institution !== officer.institution) return { ok: false, error: 'Only the escalating institution can respond.' };
  if (!text.trim()) return { ok: false, error: 'Write a response first.' };
  const to: ExceptionStatus = e.status === 'awaiting-information' ? 'in-review' : e.status;
  const event = ev(`${id}-${e.history.length + 1}-${code6()}`, now(), 'note-added', officer.name, officer.organisation, e.status, to, text.trim());
  const state: JambState = { ...current, exceptions: { ...current.exceptions, [id]: { ...current.exceptions[id], status: to, history: [...e.history, event] } } };
  save(audit(state, officer, 'Escalation response sent', { reg: e.reg, reference: id }));
  return { ok: true, value: exceptionById(id)! };
}

/**
 * The candidate a case is about: an admitted student record, or (for an admission record inquiry) a JAMB registrant
 * with no admission record at the institution checked.
 */
export interface CaseSubject { reg: string; firstName: string; middleName: string; lastName: string; gender: 'Female' | 'Male'; record?: StudentRecord; registrant?: Registrant }
export function caseSubject(reg: string, state: JambState = current): CaseSubject | undefined {
  const record = recordOf(reg, state);
  if (record) return { reg: record.reg, firstName: record.firstName, middleName: record.middleName, lastName: record.lastName, gender: record.gender, record };
  const registrant = registrantByReg(reg);
  return registrant ? { reg: registrant.reg, firstName: registrant.firstName, middleName: registrant.middleName, lastName: registrant.lastName, gender: registrant.gender, registrant } : undefined;
}

/**
 * The university asks JAMB to investigate a missing admission record (Scenario 4). Separate from identity
 * escalations: nothing about the candidate's identity is in question, and no clearance record exists.
 */
export function raiseAdmissionInquiry(input: { reg: string; session: Session; officer: Officer; reason: string; comment: string }): Result<JambException> {
  const { officer } = input;
  const registrant = registrantByReg(input.reg);
  if (!registrant) return { ok: false, error: 'No registrant without an admission record matches this number.' };
  if (officer.role !== 'clearance-officer' || !officer.institution) return { ok: false, error: 'Only an institution’s clearance officer can raise an admission record inquiry.' };
  if (!input.comment.trim()) return { ok: false, error: 'Describe why the admission record should exist.' };
  const open = escalationsOf().find((e) => e.reg === registrant.reg && e.institution === officer.institution && e.session === input.session && ['open', 'in-review', 'awaiting-information'].includes(escalationStatus(e)));
  if (open) return { ok: false, error: `An inquiry is already open for this candidate and session (${open.id}).` };
  const at = now();
  const id = `ESC-${new Date().getFullYear()}-${code6().slice(0, 5)}`;
  const inst = institutionByCode(officer.institution)!;
  const evidence: Evidence[] = [
    { label: 'Escalation reason', value: input.reason },
    { label: 'JAMB registration', value: 'Valid', tone: 'good' },
    { label: 'Admission record', value: `Not found for ${inst.name}, ${input.session}`, tone: 'bad' },
    { label: 'Clearance record', value: 'None created' },
  ];
  const e: JambException = {
    id, reg: registrant.reg, institution: officer.institution, session: input.session, eventId: eventForSession(input.session).id, category: 'admission-inquiry', summary: summaryFor('admission-inquiry'),
    raisedAt: at, raisedBy: officer.name, raisedByOrganisation: officer.organisation, status: 'open', evidence,
    history: [ev(`${id}-1`, at, 'created', officer.name, officer.organisation, undefined, 'open', input.comment.trim())],
    escalation: { comment: input.comment.trim(), submittedBy: officer.name, submittedByTitle: officer.title, institution: officer.institution, submittedAt: at, reason: input.reason, evidence: ['JAMB registration check', 'Admission record check'], comparisons: [] },
  };
  const state: JambState = { ...current, createdExceptions: [e, ...current.createdExceptions] };
  save(audit(state, officer, 'Admission record inquiry raised', { reg: registrant.reg, student: `${registrant.firstName} ${registrant.lastName}`, outcome: CATEGORY_LABEL['admission-inquiry'], reference: id }));
  return { ok: true, value: exceptionById(id)! };
}

/** JAMB rejects an escalation, with a reason. The student stays blocked; the institution can escalate again. */
export function rejectEscalation(id: string, officer: Officer, reason: string): Result<JambException> {
  if (!reason.trim()) return { ok: false, error: 'Give a reason for rejecting the escalation.' };
  const e = exceptionById(id);
  const r = patchException(id, officer, 'closed', { status: 'closed', resolution: { outcome: 'escalation-rejected', note: reason.trim(), at: now(), by: officer.name } }, reason.trim());
  if (r.ok && e) {
    const s = current.students[e.reg] ?? {};
    if (s.verification === 'escalated') save({ ...current, students: { ...current.students, [e.reg]: { ...s, verification: 'exception' } } });
  }
  return r.ok ? { ok: true, value: exceptionById(id)! } : r;
}

/* ---------------- JAMB: users ---------------- */

export function inviteUser(officer: Officer, input: { name: string; email: string; organisation: string; role: UserRole }): Result<PlatformUser> {
  if (officer.role !== 'jamb-officer') return { ok: false, error: 'Only JAMB can grant access.' };
  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) return { ok: false, error: 'Enter the person’s name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (usersOf().some((u) => u.email.toLowerCase() === email)) return { ok: false, error: 'Someone with this email already has access.' };
  if (!rolesFor(input.organisation).includes(input.role)) return { ok: false, error: 'This role isn’t available for the organisation.' };
  const u: PlatformUser = { id: `usr-inv-${code6()}`, name: input.name.trim(), email, organisation: input.organisation, role: input.role, status: 'invited', createdAt: now(), createdBy: officer.name };
  save(audit({ ...current, invitedUsers: [...current.invitedUsers, u] }, officer, 'User invited', { outcome: `${USER_ROLE_LABEL[u.role]}, ${organisationName(u.organisation)}`, reference: u.email }));
  return { ok: true, value: u };
}
export function setUserStatus(officer: Officer, id: string, status: 'active' | 'disabled'): Result<PlatformUser> {
  if (officer.role !== 'jamb-officer') return { ok: false, error: 'Only JAMB can change access.' };
  const u = usersOf().find((x) => x.id === id);
  if (!u) return { ok: false, error: 'User not found.' };
  if (u.email === officer.email) return { ok: false, error: 'You can’t disable your own access.' };
  save(audit({ ...current, users: { ...current.users, [id]: { ...current.users[id], status } } }, officer, status === 'disabled' ? 'Access disabled' : 'Access enabled', { outcome: `${u.name}, ${organisationName(u.organisation)}`, reference: u.email }));
  return { ok: true, value: usersOf().find((x) => x.id === id)! };
}
export function setUserRole(officer: Officer, id: string, role: UserRole): Result<PlatformUser> {
  if (officer.role !== 'jamb-officer') return { ok: false, error: 'Only JAMB can change roles.' };
  const u = usersOf().find((x) => x.id === id);
  if (!u) return { ok: false, error: 'User not found.' };
  if (!rolesFor(u.organisation).includes(role)) return { ok: false, error: 'This role isn’t available for the organisation.' };
  save(audit({ ...current, users: { ...current.users, [id]: { ...current.users[id], role } } }, officer, 'Role changed', { outcome: `${u.name}: ${USER_ROLE_LABEL[role]}`, reference: u.email }));
  return { ok: true, value: usersOf().find((x) => x.id === id)! };
}

/* ---------------- events ---------------- */

export interface EventSummary { assigned: number; cleared: number; pending: number; failed: number; exceptions: number; notConfirmed: number; verifications: number }
export function eventSummary(id: string, state: JambState = current): EventSummary {
  const e = EVENTS.find((x) => x.id === id)!;
  if (e.session) {
    const c = sessionTotals(e.session, state);
    return { assigned: c.admitted, cleared: c.cleared, pending: c.pending, failed: c.failed, exceptions: c.exceptions, notConfirmed: 0, verifications: c.verified + c.failed + c.exceptions };
  }
  const acts = allActivities(state).filter((a) => a.kind === 'nysc');
  return {
    assigned: 0, cleared: acts.filter((a) => a.outcome === 'confirmed').length, pending: 0, failed: acts.filter((a) => a.outcome === 'face-mismatch').length,
    exceptions: exceptionsOf(state).filter((x) => x.eventId === NYSC_EVENT_ID).length, notConfirmed: acts.filter((a) => a.outcome === 'clearance-not-confirmed').length, verifications: acts.length,
  };
}
export const clearanceReference = (r: StudentRecord) => r.clearanceRef;
export { UNILAG };
