import { useSyncExternalStore } from 'react';
import { fingerprintImage, personOf, photoUrl, presentingFace } from './media';
import { IIV_PERSONAS } from './personas';

/**
 * JAMB Institutional Identity Verification: participating institutions, admission verification events, the
 * identity records institutions verify candidates against, and the verification results institutions submit.
 * One store serves the JAMB administrator and institution portals (and other tabs, through storage events).
 */
export const IIV_STORAGE_KEY = 'fixid.iiv.v1';

export const SESSIONS = ['2024/2025', '2025/2026', '2026/2027'] as const;
export type Session = (typeof SESSIONS)[number];
export const INSTITUTION_TYPES = ['Federal University', 'State University', 'Private University', 'Federal Polytechnic', 'State Polytechnic', 'College of Education'] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];
export type InstitutionStatus = 'active' | 'invited' | 'inactive';
export const INSTITUTION_STATUS_LABEL: Record<InstitutionStatus, string> = { active: 'Active', invited: 'Invitation sent', inactive: 'Inactive' };

export interface InstitutionOfficer { name: string; email: string; role: string; status: 'active' | 'invited'; addedAt: string }
export interface Institution {
  code: string;
  name: string;
  type: InstitutionType;
  email: string;
  contactPerson: string;
  status: InstitutionStatus;
  createdAt: string;
  invitedAt?: string;
  invitationRef?: string;
  activatedAt?: string;
  officers: InstitutionOfficer[];
}

export type EventStatus = 'draft' | 'published' | 'closed';
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = { draft: 'Draft', published: 'Published', closed: 'Closed' };
export interface VerificationEvent {
  id: string;
  name: string;
  session: Session;
  /** Participating institutions: all active institutions, or the listed codes. */
  institutions: 'all' | string[];
  startsAt: string;
  endsAt: string;
  description: string;
  status: EventStatus;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  closedAt?: string;
}

/** A candidate's identity record: JAMB biodata with the JAMB and NIN reference images and fingerprint reference. */
export interface IdentityRecord {
  reg: string;
  fullName: string;
  dateOfBirth?: string;
  gender?: 'Female' | 'Male';
  stateOfOrigin?: string;
  institution: string;
  course: string;
  session: Session;
  jambPhoto?: string;
  ninPhoto?: string;
  /** Last four digits of the National Identification Number. */
  ninLast4?: string;
  fingerprint?: { source: 'scanned' | 'uploaded'; image: string; at: string };
  enrolledAt: string;
  enrolledBy: string;
  updatedAt: string;
  updatedBy: string;
}

export type Method = 'face' | 'fingerprint';
export const METHOD_LABEL: Record<Method, string> = { face: 'Face verification', fingerprint: 'Fingerprint verification' };
export type MatchResult = 'match' | 'mismatch';
export type Outcome = 'verified' | 'discrepancy';
export const OUTCOME_LABEL: Record<Outcome, string> = { verified: 'Identity Verified', discrepancy: 'Identity Discrepancy' };

/** What an institution submitted: the exact evidence JAMB reviews. */
export interface VerificationResult {
  ref: string;
  at: string;
  eventId: string;
  eventName: string;
  session: Session;
  institution: string;
  institutionName: string;
  officer: string;
  officerEmail: string;
  reg: string;
  candidate: { fullName: string; dateOfBirth?: string; course: string; institution: string; session: Session };
  method: Method;
  capturedAt: string;
  capture: string;
  ninImage: string;
  jambImage: string;
  ninResult: MatchResult;
  jambResult: MatchResult;
  outcome: Outcome;
  remarks?: string;
}

export interface IivState { version: 1; institutions: Institution[]; events: VerificationEvent[]; records: IdentityRecord[]; verifications: VerificationResult[] }

/* ---------------- initial records ---------------- */

const ADMIN = IIV_PERSONAS[0];
const OFFICER = IIV_PERSONAS[1];
const adminName = `${ADMIN.firstName} ${ADMIN.lastName}`;

function seed(): IivState {
  const t = '2025-10-06T09:00:00.000Z';
  const inst = (code: string, name: string, type: InstitutionType, contactPerson: string, email: string, status: InstitutionStatus, officers: [string, string][], extra: Partial<Institution> = {}): Institution => ({
    code, name, type, contactPerson, email, status, createdAt: t, ...(status === 'active' ? { activatedAt: '2025-10-09T10:30:00.000Z' } : {}),
    officers: officers.map(([n, e]) => ({ name: n, email: e, role: 'Admissions Clearance Officer', status: 'active', addedAt: '2025-10-10T09:00:00.000Z' })), ...extra,
  });
  const institutions: Institution[] = [
    inst('UI', 'University of Ibadan', 'Federal University', 'Dr. Olufemi Adeleke', 'admissions@ui.example', 'active', [[`${OFFICER.firstName} ${OFFICER.lastName}`, OFFICER.email], ['Kunle Fashola', 'k.fashola@ui.example']]),
    inst('UNN', 'University of Nigeria, Nsukka', 'Federal University', 'Prof. Ngozi Ugwu', 'admissions@unn.example', 'active', [['Chinedu Okafor', 'c.okafor@unn.example']]),
    inst('ABU', 'Ahmadu Bello University', 'Federal University', 'Dr. Sani Abdullahi', 'admissions@abu.example', 'active', [['Aminu Bello', 'a.bello@abu.example']]),
    inst('LASU', 'Lagos State University', 'State University', 'Mrs. Funmilayo Ajayi', 'admissions@lasu.example', 'active', [['Damilola Ige', 'd.ige@lasu.example']]),
    inst('CU', 'Covenant University', 'Private University', 'Dr. Esther Ojo', 'admissions@cu.example', 'active', [['Samuel Adeyinka', 's.adeyinka@cu.example']]),
    inst('FUTA', 'Federal University of Technology, Akure', 'Federal University', 'Engr. Bode Akinola', 'admissions@futa.example', 'invited', [], { invitedAt: '2026-11-10T11:15:00.000Z', invitationRef: 'INV-2026-30418' }),
    inst('YABATECH', 'Yaba College of Technology', 'Federal Polytechnic', 'Mr. Kayode Bamidele', 'admissions@yabatech.example', 'inactive', [['Ifeoma Nwosu', 'i.nwosu@yabatech.example']]),
  ];
  const events: VerificationEvent[] = [
    { id: 'EVT-2025-ADM', name: '2025/2026 Admission Clearance', session: '2025/2026', institutions: 'all', startsAt: '2025-11-03T08:00:00.000Z', endsAt: '2026-12-18T17:00:00.000Z', description: 'Identity verification of admitted candidates during 2025/2026 admission clearance.', status: 'published', createdAt: '2025-10-20T09:00:00.000Z', createdBy: adminName, publishedAt: '2025-10-27T09:00:00.000Z' },
    { id: 'EVT-2024-ADM', name: '2024/2025 Admission Clearance', session: '2024/2025', institutions: 'all', startsAt: '2024-10-01T08:00:00.000Z', endsAt: '2025-08-29T17:00:00.000Z', description: 'Identity verification of admitted candidates during 2024/2025 admission clearance.', status: 'closed', createdAt: '2024-09-16T09:00:00.000Z', createdBy: adminName, publishedAt: '2024-09-23T09:00:00.000Z', closedAt: '2025-08-29T17:00:00.000Z' },
  ];
  const rec = (reg: string, fullName: string, gender: 'Female' | 'Male', dob: string, state: string, institution: string, course: string, jamb: string, nin: string, ninLast4: string): IdentityRecord => ({
    reg, fullName, gender, dateOfBirth: dob, stateOfOrigin: state, institution, course, session: '2025/2026', jambPhoto: photoUrl(jamb), ninPhoto: photoUrl(nin), ninLast4,
    fingerprint: { source: 'scanned', image: fingerprintImage(personOf(photoUrl(jamb), reg)!), at: '2025-02-11T10:20:00.000Z' },
    enrolledAt: '2025-10-15T10:00:00.000Z', enrolledBy: adminName, updatedAt: '2025-10-15T10:00:00.000Z', updatedBy: adminName,
  });
  const records: IdentityRecord[] = [
    rec('20250110421NE', 'Ngozi Amarachi Eze', 'Female', '2006-04-18', 'Enugu', 'UI', 'B.Sc. Computer Science', 's1_jamb.jpg', 's1_nin.jpg', '4821'),
    rec('20250110436MD', 'Musa Ibrahim Danladi', 'Male', '2005-12-02', 'Kaduna', 'UI', 'B.Sc. Electrical and Electronics Engineering', 's2_jamb.jpg', 's2_nin.jpg', '7390'),
    rec('20250110452HS', 'Hauwa Aliyu Sani', 'Female', '2006-07-25', 'Kano', 'UI', 'MBBS Medicine and Surgery', 'nysc_b_jamb.jpg', 'nysc_b_nin.jpg', '1546'),
    rec('20250140318TA', 'Temitope Grace Alabi', 'Female', '2006-01-09', 'Ogun', 'LASU', 'LL.B. Law', 's3_jamb.jpg', 's3_jamb.jpg', '6203'),
  ];
  const state: IivState = { version: 1, institutions, events, records, verifications: [] };
  // Verifications already submitted by other institutions.
  const r = records[3];
  state.verifications.push(buildResult(state, r, events[0], { name: 'Damilola Ige', email: 'd.ige@lasu.example', institution: 'LASU' }, 'face', '2026-11-12T10:42:00.000Z', 'IVR-2026-104377'));
  return state;
}

/* ---------------- storage ---------------- */

function load(): IivState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(IIV_STORAGE_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as IivState) : null;
    return parsed?.version === 1 ? parsed : seed();
  } catch { return seed(); }
}
// Loaded at the end of the module, once every helper the initial records use is defined.
let current: IivState;
const listeners = new Set<() => void>();
function save(next: IivState) {
  current = next;
  try { localStorage.setItem(IIV_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable: kept in memory */ }
  listeners.forEach((l) => l());
}
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === IIV_STORAGE_KEY) { current = load(); listeners.forEach((l) => l()); } });
export const getIiv = () => current;
export const useIiv = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => current);
/** Restores the initial records (tests). */
export function resetIiv() { save(seed()); }
export function reloadIiv() { current = load(); listeners.forEach((l) => l()); }

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const now = () => new Date().toISOString();
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const REG_PATTERN = /^\d{11}[A-Z]{2}$/;
export const normaliseReg = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');

export const institutionByCode = (code: string, s: IivState = current) => s.institutions.find((i) => i.code === code);
export const eventById = (id: string, s: IivState = current) => s.events.find((e) => e.id === id);
export const recordByReg = (reg: string, s: IivState = current) => s.records.find((r) => r.reg === normaliseReg(reg));
export const verificationByRef = (ref: string, s: IivState = current) => s.verifications.find((v) => v.ref === ref);
export const eventIncludes = (e: VerificationEvent, code: string) => e.institutions === 'all' || e.institutions.includes(code);

/* ---------------- institutions ---------------- */

export interface InstitutionInput { name: string; code: string; type: InstitutionType; email: string; contactPerson: string }
function checkInstitution(input: InstitutionInput): string | null {
  if (!input.name.trim()) return 'Enter the institution’s name.';
  if (!/^[A-Z0-9]{2,10}$/.test(input.code.trim().toUpperCase())) return 'Use an institution code of 2 to 10 letters or digits.';
  if (current.institutions.some((i) => i.code === input.code.trim().toUpperCase())) return 'An institution with this code already exists.';
  if (!input.contactPerson.trim()) return 'Enter the contact person.';
  if (!EMAIL.test(input.email.trim())) return 'Enter a valid contact email.';
  return null;
}
/** Adds an institution directly (active), or invites it to participate (pending its acceptance). */
export function addInstitution(input: InstitutionInput, mode: 'add' | 'invite'): Result<Institution> {
  const problem = checkInstitution(input);
  if (problem) return { ok: false, error: problem };
  const at = now();
  const i: Institution = {
    code: input.code.trim().toUpperCase(), name: input.name.trim(), type: input.type, email: input.email.trim().toLowerCase(), contactPerson: input.contactPerson.trim(),
    status: mode === 'add' ? 'active' : 'invited', createdAt: at, officers: [],
    ...(mode === 'add' ? { activatedAt: at } : { invitedAt: at, invitationRef: `INV-${new Date().getFullYear()}-${digits(5)}` }),
  };
  save({ ...current, institutions: [...current.institutions, i] });
  return { ok: true, value: i };
}
export function inviteExisting(code: string): Result<Institution> {
  const i = institutionByCode(code);
  if (!i) return { ok: false, error: 'Institution not found.' };
  if (i.status === 'active') return { ok: false, error: 'This institution is already participating.' };
  const next = { ...i, status: 'invited' as const, invitedAt: now(), invitationRef: `INV-${new Date().getFullYear()}-${digits(5)}` };
  save({ ...current, institutions: current.institutions.map((x) => (x.code === code ? next : x)) });
  return { ok: true, value: next };
}
export function setInstitutionStatus(code: string, status: 'active' | 'inactive'): Result<Institution> {
  const i = institutionByCode(code);
  if (!i) return { ok: false, error: 'Institution not found.' };
  const next: Institution = { ...i, status, ...(status === 'active' ? { activatedAt: now() } : {}) };
  save({ ...current, institutions: current.institutions.map((x) => (x.code === code ? next : x)) });
  return { ok: true, value: next };
}

/* ---------------- events ---------------- */

export interface EventInput { name: string; session: Session; institutions: 'all' | string[]; startsAt: string; endsAt: string; description: string }
export function saveEvent(input: EventInput, publish: boolean, id?: string): Result<VerificationEvent> {
  if (!input.name.trim()) return { ok: false, error: 'Enter the event name.' };
  if (!input.startsAt || !input.endsAt) return { ok: false, error: 'Enter the start and end dates.' };
  if (input.endsAt < input.startsAt) return { ok: false, error: 'The end date must be after the start date.' };
  if (input.institutions !== 'all' && input.institutions.length === 0) return { ok: false, error: 'Choose at least one participating institution.' };
  const existing = id ? eventById(id) : undefined;
  if (existing && existing.status !== 'draft') return { ok: false, error: 'Only a draft event can be edited.' };
  const at = now();
  const e: VerificationEvent = {
    id: existing?.id ?? `EVT-${input.session.slice(0, 4)}-${digits(4)}`, name: input.name.trim(), session: input.session, institutions: input.institutions,
    startsAt: new Date(`${input.startsAt.slice(0, 10)}T08:00:00`).toISOString(), endsAt: new Date(`${input.endsAt.slice(0, 10)}T17:00:00`).toISOString(),
    description: input.description.trim(), status: publish ? 'published' : 'draft', createdAt: existing?.createdAt ?? at, createdBy: existing?.createdBy ?? adminName,
    ...(publish ? { publishedAt: at } : {}),
  };
  save({ ...current, events: existing ? current.events.map((x) => (x.id === e.id ? e : x)) : [e, ...current.events] });
  return { ok: true, value: e };
}
export function publishEvent(id: string): Result<VerificationEvent> {
  const e = eventById(id);
  if (!e) return { ok: false, error: 'Event not found.' };
  if (e.status !== 'draft') return { ok: false, error: 'Only a draft event can be published.' };
  const next = { ...e, status: 'published' as const, publishedAt: now() };
  save({ ...current, events: current.events.map((x) => (x.id === id ? next : x)) });
  return { ok: true, value: next };
}
export function closeEvent(id: string): Result<VerificationEvent> {
  const e = eventById(id);
  if (!e) return { ok: false, error: 'Event not found.' };
  if (e.status !== 'published') return { ok: false, error: 'Only a published event can be closed.' };
  const next = { ...e, status: 'closed' as const, closedAt: now() };
  save({ ...current, events: current.events.map((x) => (x.id === id ? next : x)) });
  return { ok: true, value: next };
}
/** Published events open to an active institution. */
export function eventsFor(code: string, s: IivState = current) {
  const inst = institutionByCode(code, s);
  if (!inst || inst.status !== 'active') return [];
  return s.events.filter((e) => e.status === 'published' && eventIncludes(e, code));
}

/* ---------------- identity records ---------------- */

export interface RecordInput {
  reg: string; fullName: string; dateOfBirth?: string; gender?: 'Female' | 'Male'; stateOfOrigin?: string; institution: string; course: string; session: Session;
  jambPhoto?: string; ninPhoto?: string; ninLast4?: string; fingerprint?: IdentityRecord['fingerprint'];
}
export function saveRecord(input: RecordInput, by: string, existingReg?: string): Result<IdentityRecord> {
  const reg = normaliseReg(input.reg);
  if (!REG_PATTERN.test(reg)) return { ok: false, error: 'Enter a valid JAMB registration number (11 digits and 2 letters).' };
  if (!input.fullName.trim()) return { ok: false, error: 'Enter the candidate’s full name.' };
  if (!institutionByCode(input.institution)) return { ok: false, error: 'Choose the institution.' };
  if (!input.course.trim()) return { ok: false, error: 'Enter the course of study.' };
  if (input.ninLast4 && !/^\d{4}$/.test(input.ninLast4)) return { ok: false, error: 'Enter the last four digits of the NIN.' };
  const existing = existingReg ? recordByReg(existingReg) : undefined;
  if (!existing && recordByReg(reg)) return { ok: false, error: 'A record with this registration number is already enrolled.' };
  if (existing && reg !== existing.reg && recordByReg(reg)) return { ok: false, error: 'A record with this registration number is already enrolled.' };
  const at = now();
  const r: IdentityRecord = {
    reg, fullName: input.fullName.trim().replace(/\s+/g, ' '), dateOfBirth: input.dateOfBirth || undefined, gender: input.gender, stateOfOrigin: input.stateOfOrigin?.trim() || undefined,
    institution: input.institution, course: input.course.trim(), session: input.session, jambPhoto: input.jambPhoto, ninPhoto: input.ninPhoto, ninLast4: input.ninLast4 || undefined,
    fingerprint: input.fingerprint, enrolledAt: existing?.enrolledAt ?? at, enrolledBy: existing?.enrolledBy ?? by, updatedAt: at, updatedBy: by,
  };
  save({ ...current, records: existing ? current.records.map((x) => (x.reg === existing.reg ? r : x)) : [r, ...current.records] });
  return { ok: true, value: r };
}

/** The columns of a batch import file (photographs are attached to each record afterwards). */
export const IMPORT_COLUMNS = ['registration_number', 'full_name', 'date_of_birth', 'gender', 'state_of_origin', 'institution_code', 'course_of_study', 'admission_session', 'nin_last4'] as const;
export function importRecords(csv: string, by: string): { added: number; updated: number; errors: string[] } {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  if (!lines.length) return { added: 0, updated: 0, errors: ['The file is empty.'] };
  const split = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()).slice(0, -1);
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const missing = IMPORT_COLUMNS.filter((c) => !['date_of_birth', 'gender', 'state_of_origin', 'nin_last4'].includes(c) && !head.includes(c));
  if (missing.length) return { added: 0, updated: 0, errors: [`Missing columns: ${missing.join(', ')}.`] };
  let added = 0, updated = 0;
  lines.slice(1).forEach((line, n) => {
    const cells = split(line);
    const v = (c: string) => cells[head.indexOf(c)] ?? '';
    const session = v('admission_session') as Session;
    if (!SESSIONS.includes(session)) { errors.push(`Row ${n + 2}: unknown admission session “${v('admission_session')}”.`); return; }
    const gender = /^f/i.test(v('gender')) ? 'Female' : /^m/i.test(v('gender')) ? 'Male' : undefined;
    const existing = recordByReg(v('registration_number'));
    const r = saveRecord({
      reg: v('registration_number'), fullName: v('full_name'), dateOfBirth: v('date_of_birth') || undefined, gender, stateOfOrigin: v('state_of_origin'),
      institution: v('institution_code').toUpperCase(), course: v('course_of_study'), session, ninLast4: v('nin_last4'),
      jambPhoto: existing?.jambPhoto, ninPhoto: existing?.ninPhoto, fingerprint: existing?.fingerprint,
    }, by, existing?.reg);
    if (!r.ok) errors.push(`Row ${n + 2}: ${r.error}`);
    else if (existing) updated++; else added++;
  });
  return { added, updated, errors };
}
/** Whether a record holds what verification needs. */
export const recordComplete = (r: IdentityRecord) => !!(r.jambPhoto && r.ninPhoto);

/* ---------------- verification ---------------- */

export interface OfficerRef { name: string; email: string; institution: string }
export type LookupResult = { ok: true; record: IdentityRecord } | { ok: false; reason: 'invalid' | 'not-found' | 'other-institution' | 'other-session' | 'incomplete'; record?: IdentityRecord };
export function lookupCandidate(input: string, officer: OfficerRef, event: VerificationEvent): LookupResult {
  const reg = normaliseReg(input);
  if (!REG_PATTERN.test(reg)) return { ok: false, reason: 'invalid' };
  const r = recordByReg(reg);
  if (!r) return { ok: false, reason: 'not-found' };
  if (r.institution !== officer.institution) return { ok: false, reason: 'other-institution', record: r };
  if (r.session !== event.session) return { ok: false, reason: 'other-session', record: r };
  if (!recordComplete(r)) return { ok: false, reason: 'incomplete', record: r };
  return { ok: true, record: r };
}

/** The face presented at capture for a candidate (the NIN record's holder). */
export const captureImageFor = (r: IdentityRecord) => presentingFace(r.ninPhoto, r.jambPhoto);
export const fingerprintFor = (r: IdentityRecord) => fingerprintImage(personOf(captureImageFor(r), r.reg) ?? r.reg);

/** The two identity checks: the capture against the National Identity record, then against the JAMB record. */
export function compareIdentity(r: IdentityRecord, method: Method) {
  const presenter = personOf(captureImageFor(r), r.reg);
  const ninResult: MatchResult = presenter && presenter === personOf(r.ninPhoto, r.reg) ? 'match' : 'mismatch';
  const jambResult: MatchResult = presenter && presenter === personOf(r.jambPhoto, r.reg) ? 'match' : 'mismatch';
  const outcome: Outcome = ninResult === 'match' && jambResult === 'match' ? 'verified' : 'discrepancy';
  const evidence = method === 'face'
    ? { capture: captureImageFor(r)!, ninImage: r.ninPhoto!, jambImage: r.jambPhoto! }
    : { capture: fingerprintFor(r), ninImage: fingerprintImage(personOf(r.ninPhoto, r.reg) ?? r.reg), jambImage: r.fingerprint?.image ?? fingerprintImage(personOf(r.jambPhoto, r.reg) ?? r.reg) };
  return { ninResult, jambResult, outcome, ...evidence };
}

function buildResult(s: IivState, r: IdentityRecord, e: VerificationEvent, officer: OfficerRef, method: Method, at: string, ref: string, capturedAt = at, remarks?: string): VerificationResult {
  const c = compareIdentity(r, method);
  return {
    ref, at, eventId: e.id, eventName: e.name, session: e.session, institution: officer.institution, institutionName: institutionByCode(officer.institution, s)?.name ?? officer.institution,
    officer: officer.name, officerEmail: officer.email, reg: r.reg, candidate: { fullName: r.fullName, dateOfBirth: r.dateOfBirth, course: r.course, institution: r.institution, session: r.session },
    method, capturedAt, capture: c.capture, ninImage: c.ninImage, jambImage: c.jambImage, ninResult: c.ninResult, jambResult: c.jambResult, outcome: c.outcome, ...(remarks?.trim() ? { remarks: remarks.trim() } : {}),
  };
}
/** Saves the institution's verification with its evidence; JAMB sees it immediately. */
export function submitVerification(input: { reg: string; eventId: string; method: Method; officer: OfficerRef; capturedAt: string; remarks?: string }): Result<VerificationResult> {
  const e = eventById(input.eventId);
  if (!e || e.status !== 'published' || !eventIncludes(e, input.officer.institution)) return { ok: false, error: 'This verification event isn’t open to your institution.' };
  const found = lookupCandidate(input.reg, input.officer, e);
  if (!found.ok) return { ok: false, error: 'The candidate’s record can’t be verified for this event.' };
  if (input.method === 'fingerprint' && !found.record.fingerprint) return { ok: false, error: 'No fingerprint reference is on record for this candidate.' };
  const v = buildResult(current, found.record, e, input.officer, input.method, now(), `IVR-${new Date().getFullYear()}-${digits(6)}`, input.capturedAt, input.remarks);
  save({ ...current, verifications: [v, ...current.verifications] });
  return { ok: true, value: v };
}

current = load();
