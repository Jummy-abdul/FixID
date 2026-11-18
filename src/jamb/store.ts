import { useSyncExternalStore } from 'react';
import {
  INSTITUTIONS, SESSIONS, UNILAG, baseCounts, baseRecord, baseRecords, institutionByCode, parseRegistration,
  type Institution, type Session, type StudentRecord,
} from './data';

/**
 * What officers do in the JAMB demonstration: verifications, clearances and matriculation confirmations.
 * Kept apart from the rest of the prototype's data (its own browser storage key), so nothing existing is
 * changed. Both demo consoles read and write the same store, so a clearance done by the university
 * appears in JAMB's oversight straight away (in other open tabs too). Browser storage only: illustrative.
 */
export const JAMB_STORAGE_KEY = 'fixid.jamb.v1';

/** A simulated response from JAMB's identity verification service (no real service is called). */
export type VerificationOutcome = 'match' | 'no-match' | 'missing-record' | 'unavailable' | 'not-found' | 'invalid';

export const OUTCOME_LABEL: Record<VerificationOutcome, string> = {
  match: 'Face match successful', 'no-match': 'Face match unsuccessful', 'missing-record': 'Missing identity record',
  unavailable: 'Verification service unavailable', 'not-found': 'Student record not found', invalid: 'Invalid JAMB registration number',
};
/** Success, failure or an exception (which isn't an identity decision). */
export const outcomeKind = (o: VerificationOutcome): 'success' | 'failed' | 'exception' => (o === 'match' ? 'success' : o === 'no-match' ? 'failed' : 'exception');

export interface StudentOverride {
  verification?: StudentRecord['verification'];
  verifiedAt?: string;
  verificationRef?: string;
  captureMode?: 'camera' | 'simulated';
  clearance?: StudentRecord['clearance'];
  clearedAt?: string;
  clearedBy?: string;
  clearanceRef?: string;
  matriculation?: StudentRecord['matriculation'];
  matricNo?: string;
  matriculatedAt?: string;
  matriculatedBy?: string;
}

export interface VerificationEvent {
  ref: string;
  at: string;
  by: string;
  institution: string;
  session: Session;
  /** The registration number entered (as typed when it wasn't valid). */
  input: string;
  reg?: string;
  outcome: VerificationOutcome;
  captureMode: 'camera' | 'simulated';
}

export interface JambState { version: 1; students: Record<string, StudentOverride>; events: VerificationEvent[] }

const empty = (): JambState => ({ version: 1, students: {}, events: [] });
function load(): JambState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(JAMB_STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) as JambState : null;
    return parsed?.version === 1 && parsed.students && Array.isArray(parsed.events) ? parsed : empty();
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


/* ---------------- records and counts ---------------- */

export function recordOf(reg: string, state: JambState = current): StudentRecord | undefined {
  const p = parseRegistration(reg);
  if (!p.ok) return undefined;
  const base = baseRecord(p.institution, p.session, p.index);
  return { ...base, ...(state.students[base.reg] ?? {}) };
}

export function recordsOf(inst: Institution, s: Session, state: JambState = current): StudentRecord[] {
  const base = baseRecords(inst, s);
  return base.map((r) => (state.students[r.reg] ? { ...r, ...state.students[r.reg] } : r));
}

export interface Counts {
  admitted: number;
  /** Identity verified (including those since cleared). */
  verified: number;
  cleared: number;
  matriculated: number;
  /** Admitted but not yet cleared. */
  pending: number;
  failed: number;
  exceptions: number;
  /** Identity verified, clearance not yet confirmed. */
  awaitingClearance: number;
  clearedNotMatriculated: number;
  /** No verification yet. */
  notStarted: number;
}

const zero = (): Counts => ({ admitted: 0, verified: 0, cleared: 0, matriculated: 0, pending: 0, failed: 0, exceptions: 0, awaitingClearance: 0, clearedNotMatriculated: 0, notStarted: 0 });
function bump(c: Counts, r: Pick<StudentRecord, 'verification' | 'clearance' | 'matriculation'>, k: 1 | -1) {
  if (r.verification === 'verified') c.verified += k;
  if (r.clearance === 'cleared') c.cleared += k; else c.pending += k;
  if (r.matriculation === 'matriculated') c.matriculated += k;
  else if (r.clearance === 'cleared') c.clearedNotMatriculated += k;
  if (r.clearance !== 'cleared') {
    if (r.verification === 'failed') c.failed += k;
    else if (r.verification === 'exception') c.exceptions += k;
    else if (r.verification === 'verified') c.awaitingClearance += k;
    else c.notStarted += k;
  }
}
export const add = (a: Counts, b: Counts): Counts => Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof Counts] + b[k as keyof Counts]])) as unknown as Counts;

/** Counts for an institution's session: JAMB's records, adjusted by what's been done in the prototype. */
export function countsOf(code: string, s: Session, state: JambState = current): Counts {
  const b = baseCounts(code, s);
  const c: Counts = {
    admitted: b.admitted, verified: b.cleared + b.verifiedAwaiting, cleared: b.cleared, matriculated: b.matriculated, pending: b.admitted - b.cleared,
    failed: b.failed, exceptions: b.exceptions, awaitingClearance: b.verifiedAwaiting, clearedNotMatriculated: b.cleared - b.matriculated,
    notStarted: b.admitted - b.cleared - b.failed - b.exceptions - b.verifiedAwaiting,
  };
  const inst = institutionByCode(code)!;
  for (const [reg, o] of Object.entries(state.students)) {
    const p = parseRegistration(reg);
    if (!p.ok || p.institution.code !== code || p.session !== s) continue;
    const base = baseRecord(inst, s, p.index);
    bump(c, base, -1);
    bump(c, { ...base, ...o }, 1);
  }
  return c;
}
export const institutionCounts = (code: string, state: JambState = current) => SESSIONS.map((s) => countsOf(code, s, state)).reduce(add, zero());
export const sessionTotals = (s: Session, state: JambState = current) => INSTITUTIONS.map((i) => countsOf(i.code, s, state)).reduce(add, zero());
export const nationalCounts = (state: JambState = current) => INSTITUTIONS.map((i) => institutionCounts(i.code, state)).reduce(add, zero());

/* ---------------- actions ---------------- */

export interface Officer { name: string; role: 'clearance-officer' | 'jamb-officer'; institution?: string }
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ref = (prefix: string) => `${prefix}-${new Date().getFullYear()}-${Array.from({ length: 6 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 34)]).join('')}`;

/**
 * Looks a registration number up within the officer's institution and the chosen admission session. A number
 * from another institution or session is "not found": the officer never learns about other institutions' records.
 */
export function lookupForClearance(input: string, session: Session, officer: Officer): { ok: true; record: StudentRecord } | { ok: false; outcome: 'invalid' | 'not-found' } {
  const p = parseRegistration(input);
  if (!p.ok) return { ok: false, outcome: p.reason === 'format' ? 'invalid' : 'not-found' };
  if (p.institution.code !== officer.institution || p.session !== session) return { ok: false, outcome: 'not-found' };
  return { ok: true, record: recordOf(registrationFor(p))! };
}
const registrationFor = (p: { institution: Institution; session: Session; index: number }) => baseRecord(p.institution, p.session, p.index).reg;

/** What the simulated service answers for a student when no demo response is forced: the record decides. */
export function expectedOutcome(r: StudentRecord): VerificationOutcome {
  const base = baseRecord(institutionByCode(r.institution)!, r.session, r.index);
  return base.verification === 'failed' ? 'no-match' : base.verification === 'exception' ? 'missing-record' : 'match';
}

/**
 * Records a verification attempt (any outcome). Only a match, a non-match or a missing record changes the
 * student's status. The live capture itself is never recorded: it stays on the verification page as evidence.
 */
export function recordVerification(input: { entered: string; session: Session; officer: Officer; outcome: VerificationOutcome; captureMode: 'camera' | 'simulated'; record?: StudentRecord }): Result<VerificationEvent> {
  const { officer } = input;
  if (officer.role !== 'clearance-officer' || !officer.institution) return { ok: false, error: 'Only an institution’s clearance officer can verify students.' };
  if (input.record && (input.record.institution !== officer.institution || input.record.session !== input.session)) return { ok: false, error: 'This student isn’t in your admission session.' };
  if (input.record?.clearance === 'cleared') return { ok: false, error: 'This student has already been cleared.' };
  const at = new Date().toISOString();
  const event: VerificationEvent = {
    ref: ref('FXV'), at, by: officer.name, institution: officer.institution, session: input.session, input: input.entered.trim(), reg: input.record?.reg,
    outcome: input.outcome, captureMode: input.captureMode,
  };
  const students = { ...current.students };
  if (input.record && (input.outcome === 'match' || input.outcome === 'no-match' || input.outcome === 'missing-record')) {
    students[input.record.reg] = {
      ...students[input.record.reg],
      verification: input.outcome === 'match' ? 'verified' : input.outcome === 'no-match' ? 'failed' : 'exception',
      verifiedAt: at, verificationRef: event.ref, captureMode: input.captureMode,
    };
  }
  save({ ...current, students, events: [event, ...current.events] });
  return { ok: true, value: event };
}

/** Institutional clearance: a separate decision, only after a successful identity verification. */
export function confirmClearance(reg: string, officer: Officer): Result<StudentRecord> {
  const r = recordOf(reg);
  if (!r) return { ok: false, error: 'Student record not found.' };
  if (officer.role !== 'clearance-officer' || r.institution !== officer.institution) return { ok: false, error: 'Only this institution’s clearance officer can clear the student.' };
  if (r.clearance === 'cleared') return { ok: false, error: 'This student has already been cleared.' };
  if (r.verification !== 'verified') return { ok: false, error: 'Identity must be verified successfully before clearance.' };
  const at = new Date().toISOString();
  save({ ...current, students: { ...current.students, [reg]: { ...current.students[reg], clearance: 'cleared', clearedAt: at, clearedBy: officer.name, clearanceRef: ref('FXC') } } });
  return { ok: true, value: recordOf(reg)! };
}

/** The institution confirms matriculation; clearance alone never matriculates anyone. */
export function confirmMatriculation(reg: string, officer: Officer, matricNo?: string): Result<StudentRecord> {
  const r = recordOf(reg);
  if (!r) return { ok: false, error: 'Student record not found.' };
  if (officer.role !== 'clearance-officer' || r.institution !== officer.institution) return { ok: false, error: 'Only the institution can confirm matriculation.' };
  if (r.clearance !== 'cleared') return { ok: false, error: 'Only a cleared student can be matriculated.' };
  if (r.matriculation === 'matriculated') return { ok: false, error: 'Matriculation is already confirmed.' };
  const no = matricNo?.trim() || `${r.institution}/${r.session.slice(2, 4)}/${String(r.index + 1).padStart(4, '0')}`;
  save({ ...current, students: { ...current.students, [reg]: { ...current.students[reg], matriculation: 'matriculated', matricNo: no, matriculatedAt: new Date().toISOString(), matriculatedBy: officer.name } } });
  return { ok: true, value: recordOf(reg)! };
}

/** The clearance reference shown on the certificate. */
export const clearanceReference = (r: StudentRecord) => current.students[r.reg]?.clearanceRef ?? (r.verificationRef ? r.verificationRef.replace(/^FXV/, 'FXC') : undefined);
export const eventsFor = (reg: string, state: JambState = current) => state.events.filter((e) => e.reg === reg);
export { UNILAG };
