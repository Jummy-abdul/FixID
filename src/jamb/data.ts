/**
 * JAMB identity assurance demonstration (proposed use case). Every figure is illustrative demo data.
 *
 * The hierarchy is JAMB → institution → admission session → student record. Student records aren't stored:
 * each one is generated from a fixed seed (the same on every load), and the counts below are exactly the
 * counts of those generated records, so every total reconciles. Only what officers do in the prototype
 * (verifications, clearances, matriculation confirmations) is saved, as overrides (see store.ts).
 */

export const SESSIONS = ['2024/2025', '2025/2026', '2026/2027'] as const;
export type Session = (typeof SESSIONS)[number];
/** URL-safe form of a session, e.g. 2025-2026. */
export const sessionSlug = (s: Session) => s.replace('/', '-');
export const sessionFromSlug = (slug: string): Session | undefined => SESSIONS.find((s) => sessionSlug(s) === slug);
const sessionYear = (s: Session) => Number(s.slice(0, 4));

export type InstitutionType = 'Federal University' | 'State University' | 'Private University' | 'Federal Polytechnic' | 'College of Education';

export interface Institution {
  /** Position in the list (1–25): part of each JAMB registration number in this demo. */
  n: number;
  code: string;
  name: string;
  shortName: string;
  type: InstitutionType;
  state: string;
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
  ['UNILAG', 'University of Lagos', 'Federal University', 'Lagos'],
  ['UI', 'University of Ibadan', 'Federal University', 'Oyo'],
  ['UNN', 'University of Nigeria, Nsukka', 'Federal University', 'Enugu'],
  ['ABU', 'Ahmadu Bello University, Zaria', 'Federal University', 'Kaduna'],
  ['FUTMINNA', 'Federal University of Technology, Minna', 'Federal University', 'Niger'],
  ['OAU', 'Obafemi Awolowo University, Ile-Ife', 'Federal University', 'Osun'],
  ['UNIBEN', 'University of Benin', 'Federal University', 'Edo'],
  ['UNILORIN', 'University of Ilorin', 'Federal University', 'Kwara'],
  ['BUK', 'Bayero University, Kano', 'Federal University', 'Kano'],
  ['UNIPORT', 'University of Port Harcourt', 'Federal University', 'Rivers'],
  ['FUTA', 'Federal University of Technology, Akure', 'Federal University', 'Ondo'],
  ['UNIJOS', 'University of Jos', 'Federal University', 'Plateau'],
  ['UNICAL', 'University of Calabar', 'Federal University', 'Cross River'],
  ['UNIMAID', 'University of Maiduguri', 'Federal University', 'Borno'],
  ['UNIZIK', 'Nnamdi Azikiwe University, Awka', 'Federal University', 'Anambra'],
  ['LASU', 'Lagos State University', 'State University', 'Lagos'],
  ['RSU', 'Rivers State University', 'State University', 'Rivers'],
  ['KASU', 'Kaduna State University', 'State University', 'Kaduna'],
  ['EKSU', 'Ekiti State University', 'State University', 'Ekiti'],
  ['CU', 'Covenant University', 'Private University', 'Ogun'],
  ['BU', 'Babcock University', 'Private University', 'Ogun'],
  ['ABUAD', 'Afe Babalola University, Ado-Ekiti', 'Private University', 'Ekiti'],
  ['YABATECH', 'Yaba College of Technology', 'Federal Polytechnic', 'Lagos'],
  ['KADPOLY', 'Kaduna Polytechnic', 'Federal Polytechnic', 'Kaduna'],
  ['FCETAKOKA', 'Federal College of Education (Technical), Akoka', 'College of Education', 'Lagos'],
] as const).map(([code, name, type, state], i) => ({
  n: i + 1, code, name, shortName: code, type, state,
  faculties: type === 'Federal Polytechnic' ? [TECH, ENGINEERING, MANAGEMENT] : type === 'College of Education' ? [EDUCATION, SCIENCE, ARTS] : code === 'FUTMINNA' || code === 'FUTA' ? [ENGINEERING, SCIENCE, TECH, MANAGEMENT] : UNI,
}));

export const institutionByCode = (code: string) => INSTITUTIONS.find((i) => i.code.toLowerCase() === code.toLowerCase());
/** The institution of the University Clearance Officer demo account. */
export const UNILAG = INSTITUTIONS[0];

/** What each admission session's records contain. */
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
    // Hand out what's left one by one, largest remainder first, within the caps.
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

/** Totals across all 25 institutions (illustrative). */
export const NATIONAL_TOTALS = { admitted: 50_000, cleared: 35_000, matriculated: 30_000, failed: 200, exceptions: 150 } as const;

/** University of Lagos: 1,000 admitted, 700 cleared, 650 matriculated (the worked example). */
const UNILAG_SESSIONS: SessionCounts[] = [
  { admitted: 250, cleared: 245, matriculated: 243, failed: 3, exceptions: 2, verifiedAwaiting: 0 },
  { admitted: 450, cleared: 380, matriculated: 352, failed: 6, exceptions: 4, verifiedAwaiting: 6 },
  { admitted: 300, cleared: 75, matriculated: 55, failed: 3, exceptions: 2, verifiedAwaiting: 9 },
];

function buildCounts(): Record<string, SessionCounts[]> {
  const others = INSTITUTIONS.slice(1);
  const sum = (k: keyof SessionCounts) => UNILAG_SESSIONS.reduce((s, x) => s + x[k], 0);
  // Relative size and progress of the other 24 institutions (fixed, illustrative).
  const size = [2.6, 2.4, 2.5, 1.2, 2.3, 2.2, 1.9, 1.8, 2.0, 1.1, 1.5, 1.4, 1.2, 1.7, 2.1, 1.0, 0.9, 1.1, 0.6, 0.7, 0.5, 1.3, 1.0, 0.8];
  const pace = [0.74, 0.69, 0.72, 0.78, 0.71, 0.66, 0.73, 0.62, 0.68, 0.8, 0.7, 0.64, 0.58, 0.69, 0.71, 0.63, 0.67, 0.76, 0.82, 0.79, 0.84, 0.66, 0.6, 0.65];
  const matPace = [0.86, 0.84, 0.87, 0.9, 0.83, 0.85, 0.82, 0.8, 0.86, 0.9, 0.85, 0.83, 0.81, 0.86, 0.87, 0.82, 0.84, 0.88, 0.9, 0.89, 0.91, 0.83, 0.8, 0.85];
  const A = allocate(NATIONAL_TOTALS.admitted - sum('admitted'), size);
  const C = allocate(NATIONAL_TOTALS.cleared - sum('cleared'), A.map((a, i) => a * pace[i]), A.map((a) => Math.floor(a * 0.95)));
  const M = allocate(NATIONAL_TOTALS.matriculated - sum('matriculated'), C.map((c, i) => c * matPace[i]), C);
  const pending = A.map((a, i) => a - C[i]);
  const F = allocate(NATIONAL_TOTALS.failed - sum('failed'), pending, pending);
  const E = allocate(NATIONAL_TOTALS.exceptions - sum('exceptions'), pending.map((p, i) => p - F[i]), pending.map((p, i) => p - F[i]));
  const out: Record<string, SessionCounts[]> = { [UNILAG.code]: UNILAG_SESSIONS };
  others.forEach((inst, k) => {
    const a = allocate(A[k], [32, 36, 32]);
    const c = allocate(C[k], [a[0] * 1, a[1] * 0.85, a[2] * 0.25], a);
    const m = allocate(M[k], [c[0] * 0.99, c[1] * 0.9, c[2] * 0.6], c);
    const p = a.map((x, s) => x - c[s]);
    const f = allocate(F[k], p, p);
    const e = allocate(E[k], p.map((x, s) => x - f[s]), p.map((x, s) => x - f[s]));
    out[inst.code] = a.map((admitted, s) => {
      const left = p[s] - f[s] - e[s];
      return { admitted, cleared: c[s], matriculated: m[s], failed: f[s], exceptions: e[s], verifiedAwaiting: Math.min(left, Math.round(left * 0.03)) };
    });
  });
  return out;
}

/** Records per institution and session, in the order of SESSIONS. */
export const BASE_COUNTS = buildCounts();
export const baseCounts = (code: string, s: Session): SessionCounts => BASE_COUNTS[code][SESSIONS.indexOf(s)];

/* ---------------- generated student records ---------------- */

export type VerificationStatus = 'not-started' | 'verified' | 'failed' | 'exception';
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
  stateOfOrigin: string;
  faculty: string;
  department: string;
  utmeScore: number;
  registeredAt: string;
  /** Examination-day verification evidence, when the demo record has it. */
  exam?: { at: string; centre: string; outcome: 'verified'; reference: string };
  verification: VerificationStatus;
  verifiedAt?: string;
  verificationRef?: string;
  clearance: ClearanceStatus;
  clearedAt?: string;
  clearedBy?: string;
  matriculation: MatriculationStatus;
  matricNo?: string;
  matriculatedAt?: string;
}

function rng(seed: string) {
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
const OFFICERS = ['Tolulope Adebayo', 'Ifeanyi Okeke', 'Halima Sani', 'Bisi Oladipo'];
const CENTRES = ['CBT Centre 014', 'CBT Centre 027', 'CBT Centre 103', 'CBT Centre 211', 'CBT Centre 305'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const iso = (y: number, m: number, d: number, h = 10, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min)).toISOString();

/** Demo JAMB registration number: UTME year, institution number, record number and two check letters. */
export function registrationNumber(inst: Institution, s: Session, index: number) {
  const r = rng(`${inst.code}|${s}|${index}|reg`);
  return `${sessionYear(s)}${pad(inst.n, 2)}${pad(index, 5)}${LETTERS[Math.floor(r() * LETTERS.length)]}${LETTERS[Math.floor(r() * LETTERS.length)]}`;
}

export type ParsedRegistration = { ok: true; institution: Institution; session: Session; index: number } | { ok: false; reason: 'format' | 'not-found' };

/** Reads a registration number. "format" means it isn't a JAMB registration number; "not-found" means no such record. */
export function parseRegistration(input: string): ParsedRegistration {
  const reg = input.trim().toUpperCase().replace(/\s+/g, '');
  const m = /^(\d{4})(\d{2})(\d{5})([A-Z]{2})$/.exec(reg);
  if (!m) return { ok: false, reason: 'format' };
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
const permCache = new Map<string, number[]>();
function ranks(code: string, s: Session): number[] {
  const key = `${code}|${s}`;
  const hit = permCache.get(key);
  if (hit) return hit;
  const n = baseCounts(code, s).admitted;
  const order = Array.from({ length: n }, (_, i) => i);
  const r = rng(`${key}|perm`);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rank = new Array<number>(n);
  order.forEach((idx, pos) => { rank[idx] = pos; });
  permCache.set(key, rank);
  return rank;
}

/** A record as JAMB assigned it (before anything done in this prototype). */
export function baseRecord(inst: Institution, s: Session, index: number): StudentRecord {
  const r = rng(`${inst.code}|${s}|${index}`);
  const c = baseCounts(inst.code, s);
  const rank = ranks(inst.code, s)[index];
  const year = sessionYear(s);
  const gender = r() < 0.5 ? 'Female' : 'Male';
  const faculty = pick(r, inst.faculties);
  const department = pick(r, faculty.departments);
  const firstName = pick(r, gender === 'Female' ? FEMALE : MALE);
  const middleName = pick(r, gender === 'Female' ? FEMALE : MALE);
  const lastName = pick(r, SURNAMES);
  const registeredAt = iso(year, 1 + Math.floor(r() * 2), 10 + Math.floor(r() * 18), 9 + Math.floor(r() * 7), Math.floor(r() * 60));
  const hasExam = r() > 0.08;
  const examAt = iso(year, 4 + Math.floor(r() * 2), 3 + Math.floor(r() * 24), 8 + Math.floor(r() * 8));
  const reg = registrationNumber(inst, s, index);
  const rec: StudentRecord = {
    reg, index, institution: inst.code, session: s, firstName, middleName, lastName, gender, stateOfOrigin: pick(r, STATES), faculty: faculty.name, department,
    utmeScore: 180 + Math.floor(r() * 150), registeredAt,
    exam: hasExam ? { at: examAt, centre: pick(r, CENTRES), outcome: 'verified', reference: `JEX-${year}-${pad(Math.floor(r() * 1e6), 6)}` } : undefined,
    verification: 'not-started', clearance: 'pending', matriculation: 'not-matriculated',
  };
  const clearedAt = iso(year, 10 + Math.floor(r() * 2), 1 + Math.floor(r() * 27), 9 + Math.floor(r() * 7), Math.floor(r() * 60));
  const officer = pick(r, OFFICERS);
  const vref = `FXV-${inst.code}-${year}-${pad(Math.floor(r() * 1e6), 6)}`;
  if (rank < c.cleared) {
    Object.assign(rec, { verification: 'verified', verifiedAt: clearedAt, verificationRef: vref, clearance: 'cleared', clearedAt, clearedBy: officer });
    if (rank < c.matriculated) {
      Object.assign(rec, { matriculation: 'matriculated', matricNo: `${inst.code}/${String(year).slice(2)}/${pad(index + 1, 4)}`, matriculatedAt: iso(year, 12, 1 + Math.floor(r() * 14), 11) });
    }
  } else if (rank < c.cleared + c.failed) Object.assign(rec, { verification: 'failed', verifiedAt: clearedAt, verificationRef: vref });
  else if (rank < c.cleared + c.failed + c.exceptions) Object.assign(rec, { verification: 'exception', verifiedAt: clearedAt, verificationRef: vref });
  else if (rank < c.cleared + c.failed + c.exceptions + c.verifiedAwaiting) Object.assign(rec, { verification: 'verified', verifiedAt: clearedAt, verificationRef: vref });
  return rec;
}

const listCache = new Map<string, StudentRecord[]>();
/** Every record of an institution's admission session, as JAMB assigned them. */
export function baseRecords(inst: Institution, s: Session): StudentRecord[] {
  const key = `${inst.code}|${s}`;
  const hit = listCache.get(key);
  if (hit) return hit;
  const list = Array.from({ length: baseCounts(inst.code, s).admitted }, (_, i) => baseRecord(inst, s, i));
  listCache.set(key, list);
  return list;
}

export const fullName = (r: Pick<StudentRecord, 'firstName' | 'middleName' | 'lastName'>) => `${r.lastName.toUpperCase()}, ${r.firstName} ${r.middleName}`;
export const displayName = (r: Pick<StudentRecord, 'firstName' | 'lastName'>) => `${r.firstName} ${r.lastName}`;
