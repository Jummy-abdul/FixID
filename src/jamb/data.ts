/**
 * JAMB Identity Verification Platform: reference data.
 *
 * The hierarchy is JAMB → verification event → institution → admission session → student record. Student
 * records aren't stored: each one is generated from a fixed seed (the same on every load), and the counts
 * below are exactly the counts of those generated records, so every total reconciles. A handful of
 * hand-written test candidates (scenarios.ts) sit alongside them. Only what officers do is saved, as
 * overrides (store.ts).
 */
import { SCENARIO_CANDIDATES, type ScenarioCandidate } from './scenarios';

export const SESSIONS = ['2022/2023', '2023/2024', '2024/2025', '2025/2026'] as const;
export type Session = (typeof SESSIONS)[number];
/** The admission session whose clearance event is open. */
export const ACTIVE_SESSION: Session = '2025/2026';
/** URL-safe form of a session, e.g. 2025-2026. */
export const sessionSlug = (s: Session) => s.replace('/', '-');
export const sessionFromSlug = (slug: string): Session | undefined => SESSIONS.find((s) => sessionSlug(s) === slug);
export const sessionYear = (s: Session) => Number(s.slice(0, 4));

export type InstitutionType = 'Federal University' | 'State University' | 'Private University' | 'Federal Polytechnic' | 'College of Education';

export interface Institution {
  /** Position in the list (1–25): part of each JAMB registration number. */
  n: number;
  code: string;
  name: string;
  shortName: string;
  type: InstitutionType;
  state: string;
  city: string;
  faculties: { name: string; departments: string[] }[];
}

const SCIENCE = { name: 'Science', departments: ['Computer Science', 'Microbiology', 'Mathematics', 'Physics', 'Biochemistry'] };
const ENGINEERING = { name: 'Engineering', departments: ['Civil Engineering', 'Electrical Engineering', 'Mechanical Engineering', 'Chemical Engineering'] };
const SOCIAL = { name: 'Social Sciences', departments: ['Economics', 'Political Science', 'Sociology', 'Psychology'] };
const ARTS = { name: 'Arts', departments: ['English', 'History', 'Linguistics', 'Philosophy'] };
const MANAGEMENT = { name: 'Management Sciences', departments: ['Accounting', 'Business Administration', 'Finance', 'Marketing'] };
const LAW = { name: 'Law', departments: ['Law'] };
const HEALTH = { name: 'Basic Medical Sciences', departments: ['Medicine and Surgery', 'Nursing Science', 'Physiology', 'Pharmacy'] };
const EDUCATION = { name: 'Education', departments: ['Science Education', 'Educational Management', 'Arts Education'] };
const TECH = { name: 'Technology', departments: ['Computer Technology', 'Electrical/Electronic Technology', 'Building Technology', 'Surveying'] };
const UNI = [SCIENCE, ENGINEERING, SOCIAL, ARTS, MANAGEMENT, LAW, HEALTH];

export const INSTITUTIONS: Institution[] = ([
  ['UNILAG', 'University of Lagos', 'Federal University', 'Lagos', 'Akoka, Yaba'],
  ['UI', 'University of Ibadan', 'Federal University', 'Oyo', 'Ibadan'],
  ['UNN', 'University of Nigeria, Nsukka', 'Federal University', 'Enugu', 'Nsukka'],
  ['ABU', 'Ahmadu Bello University', 'Federal University', 'Kaduna', 'Zaria'],
  ['FUTMINNA', 'Federal University of Technology, Minna', 'Federal University', 'Niger', 'Minna'],
  ['OAU', 'Obafemi Awolowo University', 'Federal University', 'Osun', 'Ile-Ife'],
  ['UNIBEN', 'University of Benin', 'Federal University', 'Edo', 'Benin City'],
  ['UNILORIN', 'University of Ilorin', 'Federal University', 'Kwara', 'Ilorin'],
  ['BUK', 'Bayero University, Kano', 'Federal University', 'Kano', 'Kano'],
  ['UNIPORT', 'University of Port Harcourt', 'Federal University', 'Rivers', 'Choba, Port Harcourt'],
  ['FUTA', 'Federal University of Technology, Akure', 'Federal University', 'Ondo', 'Akure'],
  ['UNIJOS', 'University of Jos', 'Federal University', 'Plateau', 'Jos'],
  ['UNICAL', 'University of Calabar', 'Federal University', 'Cross River', 'Calabar'],
  ['UNIMAID', 'University of Maiduguri', 'Federal University', 'Borno', 'Maiduguri'],
  ['UNIZIK', 'Nnamdi Azikiwe University', 'Federal University', 'Anambra', 'Awka'],
  ['LASU', 'Lagos State University', 'State University', 'Lagos', 'Ojo'],
  ['RSU', 'Rivers State University', 'State University', 'Rivers', 'Port Harcourt'],
  ['KASU', 'Kaduna State University', 'State University', 'Kaduna', 'Kaduna'],
  ['EKSU', 'Ekiti State University', 'State University', 'Ekiti', 'Ado-Ekiti'],
  ['CU', 'Covenant University', 'Private University', 'Ogun', 'Ota'],
  ['BU', 'Babcock University', 'Private University', 'Ogun', 'Ilishan-Remo'],
  ['ABUAD', 'Afe Babalola University', 'Private University', 'Ekiti', 'Ado-Ekiti'],
  ['YABATECH', 'Yaba College of Technology', 'Federal Polytechnic', 'Lagos', 'Yaba'],
  ['KADPOLY', 'Kaduna Polytechnic', 'Federal Polytechnic', 'Kaduna', 'Kaduna'],
  ['FCETAKOKA', 'Federal College of Education (Technical), Akoka', 'College of Education', 'Lagos', 'Akoka'],
] as const).map(([code, name, type, state, city], i) => ({
  n: i + 1, code, name, shortName: code, type, state, city,
  faculties: type === 'Federal Polytechnic' ? [TECH, ENGINEERING, MANAGEMENT] : type === 'College of Education' ? [EDUCATION, SCIENCE, ARTS] : code === 'FUTMINNA' || code === 'FUTA' ? [ENGINEERING, SCIENCE, TECH, MANAGEMENT] : UNI,
}));

/** Institutions being onboarded: listed in the directory, not yet taking part in any event. */
export const ONBOARDING_INSTITUTIONS = [
  { code: 'FULOKOJA', name: 'Federal University, Lokoja', type: 'Federal University' as InstitutionType, state: 'Kogi', city: 'Lokoja' },
  { code: 'FUOYE', name: 'Federal University Oye-Ekiti', type: 'Federal University' as InstitutionType, state: 'Ekiti', city: 'Oye-Ekiti' },
  { code: 'AAUA', name: 'Adekunle Ajasin University', type: 'State University' as InstitutionType, state: 'Ondo', city: 'Akungba-Akoko' },
];

export const institutionByCode = (code: string) => INSTITUTIONS.find((i) => i.code.toLowerCase() === code.toLowerCase());
/** The institution of the University Clearance Officer demo account. */
export const UNILAG = INSTITUTIONS[0];

/** The degree a department awards. */
export function courseOf(department: string, faculty: string): string {
  if (faculty === 'Technology') return `National Diploma, ${department}`;
  if (faculty === 'Education') return `B.Ed. ${department}`;
  const special: Record<string, string> = { Law: 'LL.B. Law', 'Medicine and Surgery': 'MBBS Medicine and Surgery', 'Nursing Science': 'B.N.Sc. Nursing Science', Pharmacy: 'B.Pharm. Pharmacy' };
  if (special[department]) return special[department];
  if (faculty === 'Engineering') return `B.Eng. ${department}`;
  if (faculty === 'Arts') return `B.A. ${department}`;
  return `B.Sc. ${department}`;
}

/* ---------------- named officers ---------------- */

const OFFICER_FIRST = ['Chinonso', 'Yewande', 'Ifeanyi', 'Halima', 'Bisi', 'Uchenna', 'Kehinde', 'Zainab', 'Osagie', 'Nneka', 'Abubakar', 'Funke', 'Eniola', 'Musa', 'Ebere', 'Olumide', 'Rukayat', 'Chidinma', 'Sani', 'Temidayo'];
const OFFICER_LAST = ['Eze', 'Bakare', 'Okeke', 'Sani', 'Oladipo', 'Nwosu', 'Adeleke', 'Garba', 'Igbinedion', 'Okafor', 'Shehu', 'Ajayi', 'Ogunbiyi', 'Ibrahim', 'Chukwu', 'Fashola', 'Yusuf', 'Anyanwu', 'Danladi', 'Akande'];

const NAMED_OFFICERS: Record<string, string[]> = {
  UNILAG: ['Tolulope Adebayo', 'Chinonso Eze', 'Yewande Bakare'],
  UI: ['Kehinde Adeleke', 'Folasade Ogundipe', 'Ayodeji Bankole'],
  ABU: ['Abubakar Shehu', 'Hauwa Mustapha', 'Yakubu Danladi'],
  UNIBEN: ['Osagie Igbinedion', 'Efe Omoregie', 'Ngozi Ehigiator'],
  OAU: ['Adewale Fadahunsi', 'Bukola Oyebanji', 'Ibukun Ajayi'],
};
/** The clearance officers of each institution (UNILAG's first is the demo account). */
export function officersOf(code: string): string[] {
  if (NAMED_OFFICERS[code]) return NAMED_OFFICERS[code];
  const inst = institutionByCode(code);
  const n = inst?.n ?? 0;
  return [0, 1, 2].map((k) => `${OFFICER_FIRST[(n * 3 + k * 7) % OFFICER_FIRST.length]} ${OFFICER_LAST[(n * 5 + k * 3) % OFFICER_LAST.length]}`);
}

/* ---------------- verification events ---------------- */

export type EventCategory = 'Admission Clearance' | 'NYSC Identity Verification';
export interface VerificationEventDef {
  id: string;
  name: string;
  category: EventCategory;
  /** Admission clearance events cover one admission session. */
  session?: Session;
  startsAt: string;
  /** None for a continuous event. */
  endsAt?: string;
  status: 'active' | 'expired' | 'draft';
  /** Who the event is published to. */
  audience: 'institutions' | 'nysc';
  publishedAt?: string;
  createdBy: string;
}

export const NYSC_EVENT_ID = 'EVT-NYSC-IDV';
export const EVENTS: VerificationEventDef[] = [
  { id: 'EVT-ADM-2025', name: '2025/2026 Admission Clearance', category: 'Admission Clearance', session: '2025/2026', startsAt: '2025-11-03T08:00:00.000Z', endsAt: '2027-01-29T17:00:00.000Z', status: 'active', audience: 'institutions', publishedAt: '2025-10-20T09:00:00.000Z', createdBy: 'Aisha Danjuma' },
  { id: NYSC_EVENT_ID, name: 'NYSC Identity Verification', category: 'NYSC Identity Verification', startsAt: '2026-03-02T08:00:00.000Z', status: 'active', audience: 'nysc', publishedAt: '2026-02-23T09:00:00.000Z', createdBy: 'Aisha Danjuma' },
  { id: 'EVT-ADM-2024', name: '2024/2025 Admission Clearance', category: 'Admission Clearance', session: '2024/2025', startsAt: '2024-10-01T08:00:00.000Z', endsAt: '2025-08-29T17:00:00.000Z', status: 'expired', audience: 'institutions', publishedAt: '2024-09-16T09:00:00.000Z', createdBy: 'Aisha Danjuma' },
  { id: 'EVT-ADM-2023', name: '2023/2024 Admission Clearance', category: 'Admission Clearance', session: '2023/2024', startsAt: '2023-10-02T08:00:00.000Z', endsAt: '2024-08-30T17:00:00.000Z', status: 'expired', audience: 'institutions', publishedAt: '2023-09-18T09:00:00.000Z', createdBy: 'Emmanuel Okoro' },
  { id: 'EVT-ADM-2022', name: '2022/2023 Admission Clearance', category: 'Admission Clearance', session: '2022/2023', startsAt: '2022-10-03T08:00:00.000Z', endsAt: '2023-08-31T17:00:00.000Z', status: 'expired', audience: 'institutions', publishedAt: '2022-09-19T09:00:00.000Z', createdBy: 'Emmanuel Okoro' },
];
export const eventById = (id: string) => EVENTS.find((e) => e.id === id);
export const eventForSession = (s: Session) => EVENTS.find((e) => e.session === s)!;
export const ACTIVE_ADMISSION_EVENT = eventForSession(ACTIVE_SESSION);

/** What each admission session's generated records contain. */
export interface SessionCounts {
  admitted: number;
  cleared: number;
  matriculated: number;
  failed: number;
  exceptions: number;
  /** Identity verified, institutional clearance not yet confirmed. */
  verifiedAwaiting: number;
}

/* ---------------- deterministic allocation ---------------- */

/** Splits a total into integers proportional to the weights (largest remainder), never above each cap. */
export function allocate(total: number, weights: number[], caps: number[] = weights.map(() => Infinity)): number[] {
  const out = weights.map(() => 0);
  let remaining = total;
  let open = weights.map((w, i) => (w > 0 && caps[i] > 0 ? i : -1)).filter((i) => i >= 0);
  while (remaining > 0 && open.length) {
    const sum = open.reduce((s, i) => s + weights[i], 0);
    const shares = open.map((i) => ({ i, raw: (remaining * weights[i]) / sum }));
    const floors = shares.map((s) => ({ ...s, f: Math.min(Math.floor(s.raw), caps[s.i] - out[s.i]) }));
    let given = floors.reduce((s, x) => s + x.f, 0);
    floors.forEach((x) => { out[x.i] += x.f; });
    const order = [...floors].sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)) || a.i - b.i);
    for (const x of order) {
      if (given >= remaining) break;
      if (out[x.i] < caps[x.i]) { out[x.i] += 1; given += 1; }
    }
    remaining -= given;
    open = open.filter((i) => out[i] < caps[i]);
    if (given === 0) break;
  }
  if (remaining > 0) throw new Error(`Can't allocate ${remaining} within the caps.`);
  return out;
}

/** Generated records across all 25 institutions (the test candidates are added on top). */
export const GENERATED_TOTALS = { admitted: 50_000, cleared: 41_200, matriculated: 38_400, failed: 240, exceptions: 180 } as const;

/** University of Lagos, by session (oldest first). */
const UNILAG_SESSIONS: SessionCounts[] = [
  { admitted: 240, cleared: 236, matriculated: 233, failed: 2, exceptions: 1, verifiedAwaiting: 0 },
  { admitted: 250, cleared: 245, matriculated: 241, failed: 2, exceptions: 2, verifiedAwaiting: 0 },
  { admitted: 250, cleared: 241, matriculated: 230, failed: 3, exceptions: 2, verifiedAwaiting: 1 },
  { admitted: 260, cleared: 128, matriculated: 74, failed: 4, exceptions: 3, verifiedAwaiting: 7 },
];

function buildCounts(): Record<string, SessionCounts[]> {
  const others = INSTITUTIONS.slice(1);
  const sum = (k: keyof SessionCounts) => UNILAG_SESSIONS.reduce((s, x) => s + x[k], 0);
  const size = [2.6, 2.4, 2.5, 1.2, 2.3, 2.2, 1.9, 1.8, 2.0, 1.1, 1.5, 1.4, 1.2, 1.7, 2.1, 1.0, 0.9, 1.1, 0.6, 0.7, 0.5, 1.3, 1.0, 0.8];
  const pace = [0.84, 0.8, 0.82, 0.86, 0.81, 0.79, 0.83, 0.77, 0.8, 0.86, 0.81, 0.78, 0.74, 0.8, 0.82, 0.78, 0.8, 0.85, 0.87, 0.86, 0.88, 0.79, 0.76, 0.79];
  const matPace = [0.94, 0.93, 0.94, 0.95, 0.92, 0.93, 0.92, 0.91, 0.93, 0.95, 0.93, 0.92, 0.91, 0.93, 0.94, 0.92, 0.93, 0.94, 0.95, 0.95, 0.96, 0.92, 0.9, 0.93];
  const A = allocate(GENERATED_TOTALS.admitted - sum('admitted'), size);
  const C = allocate(GENERATED_TOTALS.cleared - sum('cleared'), A.map((a, i) => a * pace[i]), A.map((a) => Math.floor(a * 0.95)));
  const M = allocate(GENERATED_TOTALS.matriculated - sum('matriculated'), C.map((c, i) => c * matPace[i]), C);
  const pending = A.map((a, i) => a - C[i]);
  const F = allocate(GENERATED_TOTALS.failed - sum('failed'), pending, pending);
  const E = allocate(GENERATED_TOTALS.exceptions - sum('exceptions'), pending.map((p, i) => p - F[i]), pending.map((p, i) => p - F[i]));
  const out: Record<string, SessionCounts[]> = { [UNILAG.code]: UNILAG_SESSIONS };
  others.forEach((inst, k) => {
    const a = allocate(A[k], [24, 25, 25, 26]);
    const c = allocate(C[k], [a[0] * 1, a[1] * 0.99, a[2] * 0.95, a[3] * 0.4], [Math.floor(a[0] * 0.985), Math.floor(a[1] * 0.98), Math.floor(a[2] * 0.965), a[3]]);
    const m = allocate(M[k], [c[0], c[1] * 0.99, c[2] * 0.96, c[3] * 0.6], [Math.floor(c[0] * 0.99), Math.floor(c[1] * 0.985), Math.floor(c[2] * 0.97), c[3]]);
    const p = a.map((x, s) => x - c[s]);
    const f = allocate(F[k], p, p);
    const e = allocate(E[k], p.map((x, s) => x - f[s]), p.map((x, s) => x - f[s]));
    out[inst.code] = a.map((admitted, s) => {
      const left = p[s] - f[s] - e[s];
      return { admitted, cleared: c[s], matriculated: m[s], failed: f[s], exceptions: e[s], verifiedAwaiting: Math.min(left, Math.round(left * (s === 3 ? 0.03 : 0))) };
    });
  });
  return out;
}

/** Generated records per institution and session, in the order of SESSIONS. */
export const BASE_COUNTS = buildCounts();
export const baseCounts = (code: string, s: Session): SessionCounts => BASE_COUNTS[code][SESSIONS.indexOf(s)];

/* ---------------- student records ---------------- */

export type VerificationStatus = 'not-started' | 'verified' | 'failed' | 'exception' | 'escalated';
export type ClearanceStatus = 'pending' | 'cleared';
export type MatriculationStatus = 'not-matriculated' | 'matriculated';

export interface StudentRecord {
  reg: string;
  index: number;
  institution: string;
  session: Session;
  firstName: string;
  lastName: string;
  middleName: string;
  gender: 'Female' | 'Male';
  dateOfBirth: string;
  stateOfOrigin: string;
  faculty: string;
  department: string;
  course: string;
  utmeScore: number;
  registeredAt: string;
  /** JAMB registration centre. */
  registrationCentre: string;
  /** The candidate was cleared to sit the UTME (no biometric match is claimed for this stage). */
  exam: { at: string; centre: string; reference: string };
  verification: VerificationStatus;
  verifiedAt?: string;
  verifiedBy?: string;
  verificationRef?: string;
  /** NIN verification response at clearance (match or mismatch only: NIN never returns a portrait). */
  nin?: 'match' | 'mismatch';
  clearance: ClearanceStatus;
  clearedAt?: string;
  clearedBy?: string;
  clearanceRef?: string;
  matriculation: MatriculationStatus;
  matricNo?: string;
  matriculatedAt?: string;
  matriculatedBy?: string;
  /** Clearance can't proceed until JAMB resolves the exception. */
  blocked?: 'nin-mismatch' | 'duplicate-clearance';
  /** A hand-written test candidate. */
  scenario?: ScenarioCandidate['id'];
}

export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

const FEMALE = ['Adaeze', 'Aisha', 'Amina', 'Chiamaka', 'Chioma', 'Damilola', 'Fatima', 'Folake', 'Funmilayo', 'Hauwa', 'Ifeoma', 'Kemi', 'Ngozi', 'Nkechi', 'Oluwaseun', 'Ronke', 'Temitope', 'Titilayo', 'Ujunwa', 'Yetunde', 'Zainab', 'Blessing', 'Esther', 'Grace'];
const MALE = ['Abdullahi', 'Adebayo', 'Ahmed', 'Babatunde', 'Chidi', 'Chinedu', 'Emeka', 'Femi', 'Ibrahim', 'Ikenna', 'Kunle', 'Musa', 'Nnamdi', 'Obinna', 'Olumide', 'Segun', 'Tunde', 'Uche', 'Yusuf', 'Daniel', 'David', 'Samuel', 'Joseph', 'Emmanuel'];
const SURNAMES = ['Abubakar', 'Adeyemi', 'Afolabi', 'Akinola', 'Balogun', 'Bello', 'Danjuma', 'Eze', 'Garba', 'Ibekwe', 'Idowu', 'Lawal', 'Mohammed', 'Nwachukwu', 'Nwosu', 'Obi', 'Ogunleye', 'Okafor', 'Okonkwo', 'Olatunji', 'Onyeka', 'Oyelaran', 'Salami', 'Suleiman', 'Usman', 'Yakubu', 'Adamu', 'Ekwueme', 'Ojo', 'Uzor'];
const STATES = ['Lagos', 'Oyo', 'Ogun', 'Osun', 'Ondo', 'Ekiti', 'Kwara', 'Kogi', 'Enugu', 'Anambra', 'Imo', 'Abia', 'Ebonyi', 'Rivers', 'Delta', 'Edo', 'Kaduna', 'Kano', 'Katsina', 'Niger', 'Plateau', 'Benue', 'Borno', 'Bauchi', 'Cross River', 'Akwa Ibom', 'FCT'];
export const CBT_CENTRES = ['Yaba CBT Centre, Lagos', 'Ikeja CBT Centre, Lagos', 'Bodija CBT Centre, Ibadan', 'Independence Layout CBT Centre, Enugu', 'Samaru CBT Centre, Zaria', 'GRA CBT Centre, Benin City', 'Wuse CBT Centre, Abuja', 'Nassarawa CBT Centre, Kano', 'Rumuokoro CBT Centre, Port Harcourt', 'Tanke CBT Centre, Ilorin'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const pad = (n: number, w: number) => String(n).padStart(w, '0');
export const iso = (y: number, m: number, d: number, h = 10, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min)).toISOString();
const ACTIVE_FROM = Date.UTC(2025, 11, 1, 9);
/** A moment on that day within office hours (08:00–16:59 West Africa Time). */
export function workingHours(ms: number, r: () => number): string {
  const d = new Date(ms);
  d.setUTCHours(7 + Math.floor(r() * 9), Math.floor(r() * 60), 0, 0);
  return d.toISOString();
}
const ACTIVE_TO = Date.UTC(2026, 10, 14, 16);

/** JAMB registration number: UTME year, institution number, record number and two check letters. */
export function registrationNumber(inst: Institution, s: Session, index: number) {
  const r = rng(`${inst.code}|${s}|${index}|reg`);
  return `${sessionYear(s)}${pad(inst.n, 2)}${pad(index, 5)}${LETTERS[Math.floor(r() * LETTERS.length)]}${LETTERS[Math.floor(r() * LETTERS.length)]}`;
}

export type ParsedRegistration = { ok: true; institution: Institution; session: Session; index: number } | { ok: false; reason: 'format' | 'not-found' };
export const normaliseReg = (input: string) => input.trim().toUpperCase().replace(/\s+/g, '');

/** Reads a registration number. "format" means it isn't a JAMB registration number; "not-found" means no such record. */
export function parseRegistration(input: string): ParsedRegistration {
  const reg = normaliseReg(input);
  const m = /^(\d{4})(\d{2})(\d{5})([A-Z]{2})$/.exec(reg);
  if (!m) return { ok: false, reason: 'format' };
  const scenario = SCENARIO_CANDIDATES.find((c) => c.reg === reg);
  if (scenario) return { ok: true, institution: institutionByCode(scenario.institution)!, session: scenario.session, index: Number(m[3]) };
  const session = SESSIONS.find((s) => sessionYear(s) === Number(m[1]));
  const institution = INSTITUTIONS.find((i) => i.n === Number(m[2]));
  const index = Number(m[3]);
  if (!session || !institution || index >= baseCounts(institution.code, session).admitted || registrationNumber(institution, session, index) !== reg) return { ok: false, reason: 'not-found' };
  return { ok: true, institution, session, index };
}

/**
 * The order in which a session's records take each status: a fixed shuffle, so statuses don't follow the
 * record number. Rank r: matriculated, then cleared, failed, exception, verified awaiting clearance, the rest pending.
 */
const permCache = new Map<string, { rank: number[]; order: number[] }>();
function shuffle(code: string, s: Session) {
  const key = `${code}|${s}`;
  const hit = permCache.get(key);
  if (hit) return hit;
  const n = baseCounts(code, s).admitted;
  const order = Array.from({ length: n }, (_, i) => i);
  const r = rng(`${key}|perm`);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rank = new Array<number>(n);
  order.forEach((idx, pos) => { rank[idx] = pos; });
  const v = { rank, order };
  permCache.set(key, v);
  return v;
}
/** Record indexes of a session whose verification failed or raised an exception (for the exceptions register). */
export function issueIndexes(code: string, s: Session): { index: number; kind: 'failed' | 'exception' }[] {
  const c = baseCounts(code, s);
  const { order } = shuffle(code, s);
  return order.slice(c.cleared, c.cleared + c.failed + c.exceptions).map((index, k) => ({ index, kind: k < c.failed ? 'failed' : 'exception' }));
}
/** The most recently verified records of a session (newest first), without generating the whole session. */
export function verifiedIndexes(code: string, s: Session): number[] {
  const c = baseCounts(code, s);
  return shuffle(code, s).order.slice(0, c.cleared + c.failed + c.exceptions + c.verifiedAwaiting);
}

/** A record as JAMB assigned it (before anything done on the platform). */
export function baseRecord(inst: Institution, s: Session, index: number): StudentRecord {
  const r = rng(`${inst.code}|${s}|${index}`);
  const c = baseCounts(inst.code, s);
  const rank = shuffle(inst.code, s).rank[index];
  const year = sessionYear(s);
  const gender = r() < 0.5 ? 'Female' : 'Male';
  const faculty = pick(r, inst.faculties);
  const department = pick(r, faculty.departments);
  const firstName = pick(r, gender === 'Female' ? FEMALE : MALE);
  const middleName = pick(r, gender === 'Female' ? FEMALE : MALE);
  const lastName = pick(r, SURNAMES);
  const registeredAt = iso(year, 1 + Math.floor(r() * 2), 10 + Math.floor(r() * 18), 9 + Math.floor(r() * 7), Math.floor(r() * 60));
  const examAt = iso(year, 4 + Math.floor(r() * 2), 3 + Math.floor(r() * 24), 8 + Math.floor(r() * 8));
  const centre = pick(r, CBT_CENTRES);
  const reg = registrationNumber(inst, s, index);
  const rec: StudentRecord = {
    reg, index, institution: inst.code, session: s, firstName, middleName, lastName, gender,
    dateOfBirth: iso(year - 17 - Math.floor(r() * 3), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 27), 0),
    stateOfOrigin: pick(r, STATES), faculty: faculty.name, department, course: courseOf(department, faculty.name),
    utmeScore: 180 + Math.floor(r() * 150), registeredAt, registrationCentre: centre,
    exam: { at: examAt, centre, reference: `UTME-${year}-${pad(Math.floor(r() * 1e6), 6)}` },
    verification: 'not-started', clearance: 'pending', matriculation: 'not-matriculated',
  };
  const active = s === '2025/2026';
  const clearedAt = active
    ? workingHours(ACTIVE_FROM + Math.pow(r(), 0.55) * (ACTIVE_TO - ACTIVE_FROM), r)
    : iso(year, 10 + Math.floor(r() * 3), 1 + Math.floor(r() * 27), 9 + Math.floor(r() * 7), Math.floor(r() * 60));
  const officer = pick(r, officersOf(inst.code));
  const vref = `JIV-${inst.code}-${year}-${pad(Math.floor(r() * 1e6), 6)}`;
  const verified = { verifiedAt: clearedAt, verifiedBy: officer, verificationRef: vref };
  if (rank < c.cleared) {
    Object.assign(rec, { verification: 'verified', ...verified, nin: 'match', clearance: 'cleared', clearedAt, clearedBy: officer, clearanceRef: vref.replace(/^JIV/, 'JCL') });
    if (rank < c.matriculated) {
      const matAt = active ? new Date(Math.min(ACTIVE_TO, new Date(clearedAt).getTime() + (12 + Math.floor(r() * 30)) * 864e5)).toISOString() : iso(year + 1, 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 27), 11);
      Object.assign(rec, { matriculation: 'matriculated', matricNo: `${inst.code}/${String(year).slice(2)}/${pad(index + 1, 4)}`, matriculatedAt: matAt, matriculatedBy: `${inst.name} Registry` });
    }
  } else if (rank < c.cleared + c.failed) Object.assign(rec, { verification: 'failed', ...verified });
  else if (rank < c.cleared + c.failed + c.exceptions) Object.assign(rec, { verification: 'exception', ...verified, nin: 'mismatch' });
  else if (rank < c.cleared + c.failed + c.exceptions + c.verifiedAwaiting) Object.assign(rec, { verification: 'verified', ...verified, nin: 'match' });
  return rec;
}

/** The test candidates of an institution's session, as records. */
export function scenarioRecords(code: string, s: Session): StudentRecord[] {
  return SCENARIO_CANDIDATES.filter((c) => c.institution === code && c.session === s).map(scenarioRecord);
}
export function scenarioRecord(c: ScenarioCandidate): StudentRecord {
  const inst = institutionByCode(c.institution)!;
  const faculty = inst.faculties.find((f) => f.departments.includes(c.department))?.name ?? 'Science';
  return { ...c.record, reg: c.reg, index: Number(c.reg.slice(6, 11)), institution: c.institution, session: c.session, faculty, department: c.department, course: courseOf(c.department, faculty), scenario: c.id };
}

const listCache = new Map<string, StudentRecord[]>();
/** Every record of an institution's admission session, as JAMB assigned them. */
export function baseRecords(inst: Institution, s: Session): StudentRecord[] {
  const key = `${inst.code}|${s}`;
  const hit = listCache.get(key);
  if (hit) return hit;
  const list = [...scenarioRecords(inst.code, s), ...Array.from({ length: baseCounts(inst.code, s).admitted }, (_, i) => baseRecord(inst, s, i))];
  listCache.set(key, list);
  return list;
}

/** A record by registration number, as JAMB assigned it. */
export function baseRecordOf(reg: string): StudentRecord | undefined {
  const n = normaliseReg(reg);
  const scenario = SCENARIO_CANDIDATES.find((c) => c.reg === n);
  if (scenario) return scenarioRecord(scenario);
  const p = parseRegistration(n);
  return p.ok ? baseRecord(p.institution, p.session, p.index) : undefined;
}

export const fullName = (r: Pick<StudentRecord, 'firstName' | 'middleName' | 'lastName'>) => `${r.firstName} ${r.middleName} ${r.lastName}`;
export const displayName = (r: Pick<StudentRecord, 'firstName' | 'lastName'>) => `${r.firstName} ${r.lastName}`;
