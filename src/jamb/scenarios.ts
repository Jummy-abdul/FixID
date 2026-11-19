import type { Session, StudentRecord } from './data';

/**
 * The dedicated test candidates. Each has a fixed JAMB registration number, a predefined verification
 * scenario and a predefined demo face, so "Capture Face" always produces the documented outcome.
 *
 * University candidates are admitted to the University of Lagos for the 2025/2026 session (the active
 * admission clearance event). NYSC candidates were admitted in 2022/2023 and are now presenting for NYSC.
 */
export type ScenarioId = 'U-A' | 'U-B' | 'U-C' | 'N-A' | 'N-B' | 'N-C';

/** What the identity services answer for the candidate at university clearance. */
export type UniversityScenario = 'identity-confirmed' | 'nin-mismatch' | 'exam-mismatch' | 'duplicate-clearance';
/** What NYSC verification establishes for the candidate. */
export type NyscScenario = 'confirmed' | 'face-mismatch' | 'clearance-not-confirmed';

export interface PriorClearance {
  institution: string;
  department: string;
  course: string;
  session: Session;
  clearedAt: string;
  clearedBy: string;
  reference: string;
}

type BaseFields = Omit<StudentRecord, 'reg' | 'index' | 'institution' | 'session' | 'faculty' | 'department' | 'course' | 'scenario'>;

export interface ScenarioCandidate {
  id: ScenarioId;
  /** Row in the test data sheet. */
  label: 'Candidate A' | 'Candidate B' | 'Candidate C';
  workspace: 'university' | 'nysc';
  reg: string;
  institution: string;
  session: Session;
  department: string;
  record: BaseFields;
  university?: UniversityScenario;
  nysc?: NyscScenario;
  /** The demo face shows the same person as the registration portrait, or someone else. */
  demoFace: 'same-person' | 'different-person';
  priorClearance?: PriorClearance;
  expected: string;
}

const uni = (first: string, middle: string, last: string, gender: 'Female' | 'Male', dob: string, state: string, score: number, centre: string): BaseFields => ({
  firstName: first, middleName: middle, lastName: last, gender, dateOfBirth: dob, stateOfOrigin: state, utmeScore: score,
  registeredAt: '2025-01-21T10:14:00.000Z', registrationCentre: centre,
  exam: { at: '2025-04-29T09:00:00.000Z', centre, reference: `UTME-2025-${String(score * 1931).padStart(6, '0').slice(-6)}` },
  verification: 'not-started', clearance: 'pending',
});

export const SCENARIO_CANDIDATES: ScenarioCandidate[] = [
  {
    id: 'U-A', label: 'Candidate A', workspace: 'university', reg: '20250190101CN', institution: 'UNILAG', session: '2025/2026', department: 'Computer Science',
    record: uni('Chiamaka', 'Adaeze', 'Nwankwo', 'Female', '2006-03-14T00:00:00.000Z', 'Anambra', 287, 'Yaba CBT Centre, Lagos'),
    university: 'identity-confirmed', demoFace: 'same-person',
    expected: 'Identity Verified: JAMB, NIN and live portraits are the same person. Complete Clearance is available.',
  },
  {
    id: 'U-B', label: 'Candidate B', workspace: 'university', reg: '20250190102IA', institution: 'UNILAG', session: '2025/2026', department: 'Mechanical Engineering',
    record: uni('Ibrahim', 'Musa', 'Abdullahi', 'Male', '2006-08-02T00:00:00.000Z', 'Kano', 264, 'Nassarawa CBT Centre, Kano'),
    // Examination impersonation: another person sat the UTME, so the JAMB examination verification record shows
    // the impersonator; the genuine candidate's live capture matches his NIN record.
    university: 'exam-mismatch', demoFace: 'same-person',
    expected: 'Identity Discrepancy Detected: the live capture matches NIN but not the JAMB examination verification record. Clearance is held; the officer escalates to JAMB.',
  },
  {
    id: 'U-C', label: 'Candidate C', workspace: 'university', reg: '20250190103OA', institution: 'UNILAG', session: '2025/2026', department: 'Economics',
    record: uni('Oluwaseun', 'Ayomide', 'Adeyemi', 'Female', '2005-11-21T00:00:00.000Z', 'Oyo', 271, 'Bodija CBT Centre, Ibadan'),
    university: 'duplicate-clearance', demoFace: 'same-person',
    priorClearance: { institution: 'UNIBEN', department: 'Accounting', course: 'B.Sc. Accounting', session: '2025/2026', clearedAt: '2026-01-14T10:42:00.000Z', clearedBy: 'Osagie Igbinedion', reference: 'JCL-UNIBEN-2025-418306' },
    expected: 'Existing Clearance Record Found (University of Benin, same admission session). Clearance is blocked; the officer escalates to JAMB.',
  },
  {
    id: 'N-A', label: 'Candidate A', workspace: 'nysc', reg: '20220290101EO', institution: 'UI', session: '2022/2023', department: 'Economics',
    record: {
      firstName: 'Emeka', middleName: 'Chukwudi', lastName: 'Obi', gender: 'Male', dateOfBirth: '2004-05-09T00:00:00.000Z', stateOfOrigin: 'Enugu', utmeScore: 279,
      registeredAt: '2022-02-08T11:20:00.000Z', registrationCentre: 'Independence Layout CBT Centre, Enugu',
      exam: { at: '2022-05-17T09:00:00.000Z', centre: 'Independence Layout CBT Centre, Enugu', reference: 'UTME-2022-538914' },
      verification: 'verified', verifiedAt: '2022-11-09T10:31:00.000Z', verifiedBy: 'Kehinde Adeleke', verificationRef: 'JIV-UI-2022-771205', nin: 'match',
      clearance: 'cleared', clearedAt: '2022-11-09T10:36:00.000Z', clearedBy: 'Kehinde Adeleke', clearanceRef: 'JCL-UI-2022-771205',
    },
    nysc: 'confirmed', demoFace: 'same-person',
    expected: 'Candidate Identity Confirmed: registration valid, face match, examination recorded, admission clearance completed.',
  },
  {
    id: 'N-B', label: 'Candidate B', workspace: 'nysc', reg: '20220490102FB', institution: 'ABU', session: '2022/2023', department: 'Biochemistry',
    record: {
      firstName: 'Fatima', middleName: 'Zainab', lastName: 'Bello', gender: 'Female', dateOfBirth: '2004-01-17T00:00:00.000Z', stateOfOrigin: 'Kaduna', utmeScore: 268,
      registeredAt: '2022-01-27T09:45:00.000Z', registrationCentre: 'Samaru CBT Centre, Zaria',
      exam: { at: '2022-05-12T13:00:00.000Z', centre: 'Samaru CBT Centre, Zaria', reference: 'UTME-2022-402277' },
      verification: 'verified', verifiedAt: '2022-11-22T09:12:00.000Z', verifiedBy: 'Abubakar Shehu', verificationRef: 'JIV-ABU-2022-305118', nin: 'match',
      clearance: 'cleared', clearedAt: '2022-11-22T09:18:00.000Z', clearedBy: 'Abubakar Shehu', clearanceRef: 'JCL-ABU-2022-305118',
    },
    nysc: 'face-mismatch', demoFace: 'different-person',
    expected: 'Candidate Identity Could Not Be Confirmed: JAMB record found, face verification failed. No verification report is issued.',
  },
  {
    id: 'N-C', label: 'Candidate C', workspace: 'nysc', reg: '20220690103TO', institution: 'OAU', session: '2022/2023', department: 'Law',
    record: {
      firstName: 'Babatunde', middleName: 'Olumide', lastName: 'Ogunleye', gender: 'Male', dateOfBirth: '2003-09-30T00:00:00.000Z', stateOfOrigin: 'Ogun', utmeScore: 252,
      registeredAt: '2022-02-15T14:05:00.000Z', registrationCentre: 'Ikeja CBT Centre, Lagos',
      exam: { at: '2022-05-20T09:00:00.000Z', centre: 'Ikeja CBT Centre, Lagos', reference: 'UTME-2022-619340' },
      verification: 'not-started', clearance: 'pending',
    },
    nysc: 'clearance-not-confirmed', demoFace: 'same-person',
    expected: 'Admission Clearance Not Confirmed: face match, but no completed university clearance is on record.',
  },
];

export const scenarioById = (id: string) => SCENARIO_CANDIDATES.find((c) => c.id === id);
export const scenarioByReg = (reg: string) => SCENARIO_CANDIDATES.find((c) => c.reg === reg.trim().toUpperCase());
