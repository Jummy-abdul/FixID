import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CheckCircle2, CircleDashed, MessageSquare, Send, ShieldAlert, XCircle } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, DataTable, Drawer, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Select, StatCard, Textarea, usePageSlice, useToast,
} from '@/components/ui';
import { EXCEPTION_ACTION_LABEL } from '@/domain/exceptions';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { INSTITUTIONS, SESSIONS, institutionByCode, type Session, type StudentRecord } from './data';
import { dateTime } from './format';
import { clearanceReferenceImage, jambPortraitLabel, ninPortrait, registrationPortrait } from './portraits';
import {
  CASE_DECISIONS, CASE_TYPE_LABEL, CATEGORY_LABEL, DECISION_ACTION, DECISION_NEEDS_PLACEMENT, ESCALATION_STATUS_LABEL, INVESTIGATION_TEAMS, JAMB_REVIEWERS, RESOLUTION_LABEL,
  addExceptionNote, assignCase, caseSubject, caseTypeOf, closeCase, escalateToJamb, escalationStatus, escalationsOf, exceptionById, jambResponse, priorClearanceOf,
  referForInvestigation, requestInformation, resolveException, respondToEscalation, useJambState,
  type CaseSubject, type CaseType, type Comparison, type EscalationStatus, type ExceptionCategory, type ExceptionResolution, type JambException,
} from './store';
import { NotFound } from './shared';
import { FaceImage, useOfficer } from './ui';

/* ---------------- shared pieces ---------------- */

const STATUS_TONE: Record<EscalationStatus, 'warning' | 'violet' | 'info' | 'success' | 'neutral'> = { open: 'warning', 'in-review': 'violet', 'awaiting-information': 'info', resolved: 'success', closed: 'neutral' };
export const EscalationStatusBadge = ({ e }: { e: JambException }) => <Badge tone={STATUS_TONE[escalationStatus(e)]} dot>{ESCALATION_STATUS_LABEL[escalationStatus(e)]}</Badge>;

const RESULT = {
  match: { label: 'Match', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> },
  mismatch: { label: 'Mismatch', cls: 'bg-red-50 text-red-800 ring-red-200', icon: <XCircle className="h-4 w-4" aria-hidden="true" /> },
  pending: { label: 'Inconclusive', cls: 'bg-amber-50 text-amber-900 ring-amber-200', icon: <CircleDashed className="h-4 w-4" aria-hidden="true" /> },
};

/**
 * The identity evidence, one row per comparison: the reference record and the live capture side by side, with the
 * result right beside the pair. The live capture is compared independently against each record (never JAMB vs NIN).
 */
export function IdentityComparison({ record, capture, comparisons, captureNote }: { record: StudentRecord; capture?: string; comparisons: Comparison[]; captureNote?: string }) {
  const exam = jambPortraitLabel(record) === 'JAMB examination verification record';
  const nysc = jambPortraitLabel(record) === 'JAMB profile photograph';
  const img = 'aspect-[4/5] h-auto w-full';
  const faces = {
    jamb: { label: exam ? 'JAMB Examination Verification Record' : nysc ? 'JAMB Profile Photograph' : 'JAMB Registration Record', el: <FaceImage src={registrationPortrait(record)} label={`${jambPortraitLabel(record)}: ${record.firstName} ${record.lastName}`} className={img} /> },
    nin: { label: nysc ? 'NIN Identity Photograph' : 'NIN Identity Record', el: <FaceImage src={ninPortrait(record)} label="NIN identity record portrait" className={img} /> },
    reference: { label: 'FixID Clearance Reference', el: <FaceImage src={clearanceReferenceImage(record)} label={`FixID clearance reference image: ${record.firstName} ${record.lastName}`} className={img} /> },
    live: { label: nysc ? 'NYSC Live Capture' : 'Live Clearance Capture', el: capture ? <img src={capture} alt="Live clearance capture" className="aspect-[4/5] w-full rounded-lg object-cover ring-1 ring-slate-200" /> : <FaceImage label={captureNote ?? 'Capture not retained'} className={img} /> },
  };
  const source = (part: string) => (/live/i.test(part) ? faces.live : /reference/i.test(part) ? faces.reference : /nin/i.test(part) ? faces.nin : faces.jamb);
  const shown = comparisons.filter((c) => !/^JAMB vs NIN$/i.test(c.label));
  const ROW = { match: 'ring-emerald-200 bg-emerald-50/40', mismatch: 'ring-red-200 bg-red-50/40', pending: 'ring-amber-200 bg-amber-50/40' };
  const VERDICT = {
    match: { cls: 'bg-emerald-600 text-white', icon: <CheckCircle2 className="h-6 w-6" aria-hidden="true" />, word: 'Match' },
    mismatch: { cls: 'bg-red-600 text-white', icon: <XCircle className="h-6 w-6" aria-hidden="true" />, word: 'Mismatch' },
    pending: { cls: 'bg-amber-500 text-white', icon: <CircleDashed className="h-6 w-6" aria-hidden="true" />, word: 'Inconclusive' },
  };
  return (
    <section aria-label="Identity Verification Analysis">
      <ul aria-label="Comparison outcomes" className="grid gap-3 xl:grid-cols-2">
        {shown.map((c, i) => {
          const [l, r] = c.label.split(/\s+vs\s+/i);
          const left = source(l), right = source(r ?? 'live');
          const v = VERDICT[c.result];
          return (
            <li key={c.label} aria-label={`${c.label}: ${RESULT[c.result].label}`} className={cn('rounded-xl p-3 ring-1', ROW[c.result])}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Comparison {i + 1}: <span className="text-slate-800">{c.label}</span></p>
              <div className="mt-2 grid grid-cols-2 items-start gap-3 sm:grid-cols-[6.5rem_6.5rem_minmax(0,1fr)]">
                <figure className="min-w-0">{left.el}<figcaption className="mt-1 text-center text-[11px] font-semibold leading-tight text-slate-700">{left.label}</figcaption></figure>
                <figure className="min-w-0">{right.el}<figcaption className="mt-1 text-center text-[11px] font-semibold leading-tight text-slate-700">{right.label}</figcaption></figure>
                <div className={cn('col-span-2 flex items-center justify-center gap-2 rounded-lg px-3 py-3 sm:col-span-1 sm:flex-col sm:self-stretch sm:py-4', v.cls)}>
                  {v.icon}
                  <span className="text-sm font-bold uppercase tracking-wide">{v.word}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const DEFAULT_COMMENT: Partial<Record<ExceptionCategory, string>> = {
  'exam-impersonation': 'The student’s live captured portrait matches the NIN identity record but differs from the face associated with the JAMB examination verification record. This raises a possible examination identity impersonation concern. Kindly investigate and advise on the appropriate next steps.',
  'jamb-nin-discrepancy': 'The live portrait matches the original JAMB registration portrait. However, the NIN portrait returned during verification does not match the captured face. Kindly investigate and confirm the student’s identity.',
  'duplicate-clearance': 'This student has presented for clearance at University of Lagos, but an existing clearance record associated with another institution has been identified. Kindly investigate and advise on the appropriate next steps.',
};
/** Reasons the officer can give, per kind of case. */
const REASONS: Partial<Record<ExceptionCategory, string[]>> = {
  'duplicate-clearance': ['Student wishes to decline or withdraw the existing admission', 'Student wishes to proceed with another institution', 'Existing clearance requires review', 'Other'],
  'jamb-nin-discrepancy': ['Captured face does not match the NIN record', 'Student disputes the NIN record', 'Other'],
  'exam-impersonation': ['Possible examination impersonation', 'Live capture does not match the JAMB examination record', 'Other'],
};

/** The university's escalation form: the student's details are prefilled; the officer adds the category, comment and evidence. */
export function EscalationDrawer({ record, category: initial, capture, onClose, onDone }: { record: StudentRecord; category: ExceptionCategory; capture?: string; onClose: () => void; onDone?: (e: JambException) => void }) {
  const officer = useOfficer();
  const toast = useToast();
  const category = initial;
  const reasons = REASONS[category] ?? ['Other'];
  const [reason, setReason] = useState(reasons[0]);
  const [comment, setComment] = useState(DEFAULT_COMMENT[initial] ?? '');
  const prior = priorClearanceOf(record.reg);
  const options = [
    ...(category === 'duplicate-clearance' ? [] : ['Identity comparison results']),
    ...(capture ? ['Live clearance capture'] : []),
    ...(prior ? ['Previous clearance record'] : []),
    'Verification reference',
  ];
  const [evidence, setEvidence] = useState<string[]>(options);
  const [error, setError] = useState('');
  const inst = institutionByCode(record.institution)!;
  const submit = () => {
    const r = escalateToJamb({ reg: record.reg, officer, category, reason, comment, evidence, capture: capture && evidence.includes('Live clearance capture') ? capture : undefined });
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: 'success', title: 'Escalated to JAMB', description: r.value.id });
    onDone?.(r.value);
    onClose();
  };
  return (
    <Drawer open onClose={onClose} title="Escalate to JAMB" description="JAMB reviews the case and responds here."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={<Send className="h-4 w-4" />} onClick={submit}>Submit escalation</Button></div>}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200" aria-label="Student">
          {([['Student name', `${record.firstName} ${record.middleName} ${record.lastName}`], ['JAMB Registration Number', <span className="font-mono">{record.reg}</span>], ['Institution', inst.name], ['Admission session', record.session]] as [string, ReactNode][]).map(([k, v]) => (
            <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v}</dd></div>
          ))}
        </dl>
        <p className="text-sm"><span className="text-slate-500">Case: </span><span className="font-medium text-slate-900">{CATEGORY_LABEL[category]}</span></p>
        <Field label="Escalation reason" required>{(p) => <Select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>{reasons.map((x) => <option key={x} value={x}>{x}</option>)}</Select>}</Field>
        <Field label="Description" required>{(p) => <Textarea {...p} rows={5} value={comment} onChange={(e) => setComment(e.target.value)} />}</Field>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Supporting evidence</legend>
          <div className="mt-2 space-y-2">
            {options.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="rounded border-slate-300" checked={evidence.includes(o)} onChange={(e) => setEvidence((v) => (e.target.checked ? [...v, o] : v.filter((x) => x !== o)))} />{o}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Drawer>
  );
}

/** What the university sees once a case is with JAMB: the reference, status and JAMB's response. */
/** When the case last changed. */
export const lastUpdated = (e: JambException) => e.history[e.history.length - 1]?.at ?? e.raisedAt;
const isLive = (e: JambException) => ['open', 'in-review', 'awaiting-information'].includes(escalationStatus(e));
const fullName = (c?: Pick<CaseSubject, 'firstName' | 'middleName' | 'lastName'>) => (c ? `${c.firstName} ${c.middleName} ${c.lastName}` : '—');
const Rows = ({ rows, label, cols = 'sm:grid-cols-2 lg:grid-cols-3' }: { rows: [string, ReactNode][]; label?: string; cols?: string }) => (
  <dl aria-label={label} className={cn('grid gap-x-6 gap-y-3 text-sm', cols)}>
    {rows.map(([k, v]) => <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>)}
  </dl>
);

/** What happened on the case, oldest first: every submission, comment, request, response, assignment and decision. */
const EVENT_LABEL = (h: JambException['history'][number], jamb: boolean): string => {
  switch (h.action) {
    case 'created': return 'Case submitted';
    case 'assigned': return 'Case assigned';
    case 'review-started': return 'Investigation started';
    case 'note-added': return jamb ? 'Investigation comment' : 'Institution response';
    case 'information-requested': return 'More information requested';
    case 'escalated': return 'Referred for further investigation';
    case 'resolution-recorded': return 'Decision recorded';
    case 'closed': return 'Case closed';
    default: return EXCEPTION_ACTION_LABEL[h.action];
  }
};
export function CaseHistory({ e }: { e: JambException }) {
  return (
    <ol aria-label="Case activity history" className="space-y-3">
      {e.history.map((h) => {
        const jamb = h.actorOrganizationId === 'JAMB';
        return (
          <li key={h.id} className="relative border-l-2 pl-3 text-sm" style={{ borderColor: jamb ? '#7c3aed' : '#0ea5e9' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-900">{EVENT_LABEL(h, jamb)}</span>
              <span className="text-xs tabular-nums text-slate-500">{dateTime(h.at)}</span>
            </div>
            <p className="text-xs text-slate-500">{h.actorName} · {jamb ? 'JAMB' : h.actorOrganizationId}{h.fromStatus && h.toStatus && h.fromStatus !== h.toStatus ? ` · ${statusWord(h.fromStatus)} → ${statusWord(h.toStatus)}` : ''}</p>
            {h.comment && <p className="mt-1 whitespace-pre-line text-slate-700">{h.comment}</p>}
          </li>
        );
      })}
    </ol>
  );
}
const statusWord = (s: string) => ({ open: 'New', assigned: 'Under review', 'in-review': 'Under review', 'awaiting-information': 'Awaiting information', resolved: 'Resolved', closed: 'Closed', reopened: 'New' } as Record<string, string>)[s] ?? s;

/** The decision JAMB recorded, with its explanation, details and any instructions for the institution. */
export function DecisionCard({ e }: { e: JambException }) {
  if (!e.resolution) return null;
  const d = e.resolution.details;
  return (
    <div aria-label="JAMB decision" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm ring-1 ring-inset ring-emerald-200">
      <p className="font-semibold text-emerald-950">JAMB decision: {RESOLUTION_LABEL[e.resolution.outcome]}</p>
      <p className="mt-1 whitespace-pre-line text-slate-800">{e.resolution.note}</p>
      {d && (d.institution || d.session || d.reference || d.instructions) && (
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {d.institution && <div><dt className="text-slate-500">Institution found</dt><dd className="font-medium text-slate-900">{institutionByCode(d.institution)?.name ?? d.institution}</dd></div>}
          {d.session && <div><dt className="text-slate-500">Admission session</dt><dd className="font-medium text-slate-900">{d.session}</dd></div>}
          {d.reference && <div><dt className="text-slate-500">JAMB correction reference</dt><dd className="font-mono font-medium text-slate-900">{d.reference}</dd></div>}
          {d.instructions && <div className="sm:col-span-2"><dt className="text-slate-500">Instructions to the institution</dt><dd className="font-medium text-slate-900">{d.instructions}</dd></div>}
        </dl>
      )}
      <p className="mt-2 text-xs text-slate-500">{e.resolution.by}, JAMB · {dateTime(e.resolution.at)}</p>
    </div>
  );
}

/** The evidence for the case, by kind: identity comparisons beside their images, or the record checks. */
export function CaseEvidence({ e }: { e: JambException }) {
  const state = useJambState();
  const subject = caseSubject(e.reg, state);
  const type = caseTypeOf(e);
  const inst = institutionByCode(e.institution);
  const prior = priorClearanceOf(e.reg);
  if (type === 'existing-clearance' && prior) {
    return (
      <div aria-label="Existing clearance record">
        <p className="mb-3 text-sm text-slate-600">A record issue, not a biometric result: no face comparison applies. The previous clearance record is unchanged.</p>
        <Rows rows={[['Previous institution', institutionByCode(prior.institution)?.name], ['Previous admission session', prior.session], ['Department', prior.department], ['Previous clearance date', dateTime(prior.clearedAt)], ['Clearance officer', prior.clearedBy], ['Previous clearance reference', <span className="font-mono">{prior.reference}</span>],
          ['Existing clearance status', 'Cleared'], ['Presenting institution', inst?.name], ['Current admission session', e.session]]} />
      </div>
    );
  }
  if (type === 'admission-inquiry') {
    return (
      <div aria-label="Admission record check">
        <p className="mb-3 text-sm text-slate-600">Identity is not in question: no face comparison applies, and no clearance record was created.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg px-4 py-3 ring-1 ring-inset ring-emerald-200 bg-emerald-50/50"><span className="text-sm text-slate-700">JAMB Registration</span><span className="inline-flex items-center gap-1.5 text-sm font-bold uppercase text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Valid</span></div>
          <div className="flex items-center justify-between rounded-lg px-4 py-3 ring-1 ring-inset ring-red-200 bg-red-50/50"><span className="text-sm text-slate-700">Admission Record</span><span className="inline-flex items-center gap-1.5 text-sm font-bold uppercase text-red-700"><XCircle className="h-4 w-4" aria-hidden="true" />Not found</span></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Checked against {inst?.name}, {e.session} admission session. This does not establish that the candidate holds no admission elsewhere.</p>
      </div>
    );
  }
  if (subject?.record && (e.escalation?.comparisons?.length ?? 0) > 0) {
    return <IdentityComparison record={subject.record} capture={e.escalation?.capture} comparisons={e.escalation!.comparisons!} captureNote="Live capture not attached" />;
  }
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {e.evidence.map((x) => <li key={x.label} className="flex justify-between gap-3 py-1.5"><span className="text-slate-600">{x.label}</span><span className={cn('font-medium', x.tone === 'good' ? 'text-emerald-700' : x.tone === 'bad' ? 'text-red-700' : 'text-slate-900')}>{x.value}</span></li>)}
    </ul>
  );
}

/** The candidate a case is about. */
function CandidateInfo({ e }: { e: JambException }) {
  const state = useJambState();
  const s = caseSubject(e.reg, state);
  const inst = institutionByCode(e.institution);
  if (s?.registrant) {
    const g = s.registrant;
    return <Rows label="Candidate information" rows={[['Candidate', fullName(s)], ['JAMB registration number', <span className="font-mono">{g.reg}</span>], ['JAMB registration', 'Valid'], ['Institution checked', inst?.name], ['Admission session checked', e.session], ['Admission record', 'Not found'], ['Date of birth', formatDate(g.dateOfBirth)], ['State of origin', g.stateOfOrigin], ['UTME', `${formatDate(g.exam.at)} · ${g.exam.reference}`]]} />;
  }
  const r = s?.record;
  return <Rows label="Candidate information" rows={[['Candidate', fullName(s)], ['JAMB registration number', <span className="font-mono">{e.reg}</span>], ['Institution', inst?.name], ['Admission session', e.session], ['Department', r?.department ?? '—'], ['Course', r?.course ?? '—'], ['Date of birth', r ? formatDate(r.dateOfBirth) : '—'], ['State of origin', r?.stateOfOrigin ?? '—'], ['Clearance status', r ? (r.clearance === 'cleared' ? 'Cleared' : 'Not cleared') : '—']]} />;
}

/** What the institution (or NYSC) submitted. */
function Submission({ e }: { e: JambException }) {
  const x = e.escalation!;
  const nysc = x.source === 'nysc';
  return (
    <div className="space-y-3">
      <Rows rows={[
        [nysc ? 'Referred by' : 'Originating institution', nysc ? 'National Youth Service Corps' : institutionByCode(x.institution)?.name],
        [nysc ? 'NYSC officer' : 'Clearance officer', `${x.submittedBy}, ${x.submittedByTitle}`], ['Date and time submitted', dateTime(x.submittedAt)],
        ['Case type', CASE_TYPE_LABEL[caseTypeOf(e)]], ['Escalation reason', x.reason ?? CATEGORY_LABEL[e.category]], ['Supporting evidence', x.evidence.join(', ') || '—'],
      ]} />
      <div aria-label={nysc ? 'NYSC officer’s comment' : 'Clearance officer’s comment'}>
        <p className="text-sm text-slate-500">{nysc ? 'NYSC officer’s comment' : 'Clearance officer’s comment'}</p>
        <blockquote className="mt-1 border-l-4 border-slate-200 pl-4 text-sm text-slate-800">{x.comment}</blockquote>
      </div>
    </div>
  );
}

/* ---------------- university: status on the student, and the case page ---------------- */

/** What the university sees on a student once a case is with JAMB: the status, JAMB's response and decision. */
export function EscalationStatusPanel({ e }: { e: JambException }) {
  const status = escalationStatus(e);
  const response = jambResponse(e);
  return (
    <Card className="px-5 py-4" aria-label="Escalation to JAMB">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><ShieldAlert className="h-5 w-5 text-violet-600" aria-hidden="true" />Escalated to JAMB</h2>
        <span className="flex items-center gap-2"><EscalationStatusBadge e={e} /><Link to={`/clearance/escalations/${e.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View case</Link></span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {([['Escalation reference', <span className="font-mono">{e.id}</span>], ['Reason', e.escalation!.reason ?? CATEGORY_LABEL[e.category]], ['Submitted', dateTime(e.escalation!.submittedAt)], ['Last updated', dateTime(lastUpdated(e))]] as [string, ReactNode][]).map(([k, v]) => (
          <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-3">
        {e.resolution ? <DecisionCard e={e} /> : (
          <div className="rounded-lg bg-violet-50 px-4 py-3 text-sm ring-1 ring-inset ring-violet-200">
            <p className="font-semibold text-slate-900">{status === 'awaiting-information' ? 'JAMB has requested more information' : 'JAMB response'}</p>
            <p className="mt-1 text-slate-700">{response?.comment ?? 'JAMB is reviewing the case.'}</p>
            {response && <p className="mt-1 text-xs text-slate-500">{response.actorName} · {dateTime(response.at)}</p>}
          </div>
        )}
      </div>
      {status === 'awaiting-information' && <ResponseForm e={e} />}
    </Card>
  );
}

function ResponseForm({ e }: { e: JambException }) {
  const officer = useOfficer();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const send = () => { const r = respondToEscalation(e.id, officer, reply); if (!r.ok) toast({ tone: 'error', title: 'Not sent', description: r.error }); else { setReply(''); toast({ tone: 'success', title: 'Response sent to JAMB' }); } };
  return (
    <div className="mt-3 space-y-2">
      <Field label="Your response to JAMB">{(p) => <Textarea {...p} rows={3} value={reply} onChange={(x) => setReply(x.target.value)} />}</Field>
      <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={send}>Send response</Button>
    </div>
  );
}

/** The originating institution's view of a case: status, JAMB's decision, the evidence and the full history. */
export function UniversityCasePage({ institution }: { institution: string }) {
  const { id = '' } = useParams();
  const state = useJambState();
  const e = exceptionById(id, state);
  if (!e?.escalation || e.institution !== institution || e.escalation.source === 'nysc') return <NotFound what="Escalation" back="/clearance/escalations" />;
  const s = caseSubject(e.reg, state);
  const status = escalationStatus(e);
  const response = jambResponse(e);
  return (
    <>
      <PageHeader title={`${CASE_TYPE_LABEL[caseTypeOf(e)]}: ${s ? `${s.firstName} ${s.lastName}` : e.reg}`} breadcrumbs={[{ label: 'Escalations', to: '/clearance/escalations' }, { label: e.id }]}
        meta={<><EscalationStatusBadge e={e} /><span className="font-mono text-xs text-slate-500">{e.id}</span></>}
        actions={s?.record ? <ButtonLink to={`/clearance/students/${e.reg}`} variant="secondary">Student record</ButtonLink> : undefined} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-6">
          <Card className="px-5 py-5" aria-label="JAMB response">
            <h2 className="mb-3 text-base font-semibold text-slate-900">JAMB’s response</h2>
            {e.resolution ? <DecisionCard e={e} /> : (
              <div className="rounded-lg bg-violet-50 px-4 py-3 text-sm ring-1 ring-inset ring-violet-200">
                <p className="font-semibold text-slate-900">{status === 'awaiting-information' ? 'JAMB has requested more information' : status === 'open' ? 'Received by JAMB' : 'Under investigation by JAMB'}</p>
                <p className="mt-1 text-slate-700">{response?.comment ?? 'JAMB has not responded yet.'}</p>
                {response && <p className="mt-1 text-xs text-slate-500">{response.actorName} · {dateTime(response.at)}</p>}
              </div>
            )}
            {status === 'awaiting-information' && <ResponseForm e={e} />}
          </Card>
          <Card className="px-5 py-5"><h2 className="mb-3 text-base font-semibold text-slate-900">Candidate</h2><CandidateInfo e={e} /></Card>
          <Card className="px-5 py-5"><h2 className="mb-3 text-base font-semibold text-slate-900">Evidence</h2><CaseEvidence e={e} /></Card>
          <Card className="px-5 py-5"><h2 className="mb-3 text-base font-semibold text-slate-900">Your submission</h2><Submission e={e} /></Card>
        </div>
        <div className="space-y-6">
          <CaseStatusCard e={e} />
          <Card className="px-5 py-5"><h2 className="mb-3 text-base font-semibold text-slate-900">Case activity history</h2><CaseHistory e={e} /></Card>
        </div>
      </div>
    </>
  );
}

function CaseStatusCard({ e, children }: { e: JambException; children?: ReactNode }) {
  return (
    <Card className="px-5 py-5" aria-label="Case status">
      <h2 className="text-base font-semibold text-slate-900">Case status</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {([['Status', <EscalationStatusBadge e={e} />], ['Case type', CASE_TYPE_LABEL[caseTypeOf(e)]], ['Assigned officer', e.assignedTo ?? 'Not yet assigned'], ['Assignment date', e.assignedAt ? dateTime(e.assignedAt) : '—'],
          ...(e.referredTo ? [['Referred to', e.referredTo] as [string, ReactNode]] : []), ['Last updated', dateTime(lastUpdated(e))],
          ['Resolution', e.resolution ? RESOLUTION_LABEL[e.resolution.outcome] : '—'], ['Resolution date', e.resolution ? dateTime(e.resolution.at) : '—'], ...(e.closedAt ? [['Closed', dateTime(e.closedAt)] as [string, ReactNode]] : [])] as [string, ReactNode][]).map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-900">{v}</dd></div>
        ))}
      </dl>
      {children}
    </Card>
  );
}

/* ---------------- JAMB: Escalation Management ---------------- */

/** Switches between escalations and the full exceptions register (one section). */
export function ExceptionSectionTabs({ current }: { current: 'escalations' | 'exceptions' }) {
  const tab = (to: string, label: string, active: boolean) => (
    <Link to={to} aria-current={active ? 'page' : undefined} className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900')}>{label}</Link>
  );
  return <nav aria-label="Exceptions section" className="inline-flex gap-1 rounded-xl bg-slate-100 p-1">{tab('/jamb/escalations', 'Escalations', current === 'escalations')}{tab('/jamb/exceptions', 'All exceptions', current === 'exceptions')}</nav>;
}

const DATE_FILTERS: [string, string, number][] = [['any', 'Any date', 0], ['today', 'Today', 1], ['7d', 'Last 7 days', 7], ['30d', 'Last 30 days', 30], ['90d', 'Last 90 days', 90]];

export function EscalationsPage() {
  const state = useJambState();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [inst, setInst] = useQueryState('institution', 'all');
  const [type, setType] = useQueryState('type', 'all');
  const [sess, setSess] = useQueryState('session', 'all');
  const [when, setWhen] = useQueryState('submitted', 'any');
  const [page, setPage] = usePageParam();
  const all = useMemo(() => escalationsOf(state).sort((a, b) => b.escalation!.submittedAt.localeCompare(a.escalation!.submittedAt)), [state]);
  const query = q.trim().toLowerCase();
  const days = DATE_FILTERS.find(([k]) => k === when)?.[2] ?? 0;
  const since = days ? Date.now() - days * 86400000 : 0;
  const rows = all.filter((e) => {
    const s = caseSubject(e.reg, state);
    return (status === 'all' || escalationStatus(e) === status) && (inst === 'all' || e.institution === inst) && (type === 'all' || caseTypeOf(e) === type)
      && (sess === 'all' || e.session === sess) && (!since || Date.parse(e.escalation!.submittedAt) >= since)
      && (!query || e.id.toLowerCase().includes(query) || e.reg.toLowerCase().includes(query.replace(/\s/g, '')) || `${s?.firstName} ${s?.middleName} ${s?.lastName}`.toLowerCase().includes(query));
  });
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 20);
  const count = (x: EscalationStatus) => all.filter((e) => escalationStatus(e) === x).length;
  return (
    <>
      <PageHeader title="Escalation Management" description="Cases institutions and NYSC referred to JAMB: investigate, decide and return the outcome." actions={<ExceptionSectionTabs current="escalations" />} />
      <section aria-label="Escalation summary" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Open cases" value={count('open')} tone="amber" hint="New, not yet under review" to="/jamb/escalations?status=open" />
        <StatCard label="Under review" value={count('in-review')} tone="violet" to="/jamb/escalations?status=in-review" />
        <StatCard label="Awaiting information" value={count('awaiting-information')} to="/jamb/escalations?status=awaiting-information" />
        <StatCard label="Resolved" value={count('resolved')} tone="emerald" to="/jamb/escalations?status=resolved" />
        <StatCard label="Closed" value={count('closed')} to="/jamb/escalations?status=closed" />
      </section>
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Candidate, registration number or case reference" className="sm:w-80" label="Search cases" />
          <FilterSelect label="Case type" value={type} onChange={setType} options={[{ value: 'all', label: 'All case types' }, ...(['identity-discrepancy', 'existing-clearance', 'admission-inquiry', 'clearance-confirmation'] as CaseType[]).map((t) => ({ value: t, label: CASE_TYPE_LABEL[t] }))]} />
          <div className="min-w-0 max-w-full [&_select]:w-full [&_select]:max-w-full"><FilterSelect label="Institution" value={inst} onChange={setInst} options={[{ value: 'all', label: 'All institutions' }, ...INSTITUTIONS.map((i) => ({ value: i.code, label: i.name }))]} /></div>
          <FilterSelect label="Admission session" value={sess} onChange={setSess} options={[{ value: 'all', label: 'All sessions' }, ...SESSIONS.map((x) => ({ value: x, label: x }))]} />
          <FilterSelect label="Submitted" value={when} onChange={setWhen} options={DATE_FILTERS.map(([value, label]) => ({ value, label }))} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Any status' }, ...(Object.keys(ESCALATION_STATUS_LABEL) as EscalationStatus[]).map((x) => ({ value: x, label: ESCALATION_STATUS_LABEL[x] }))]} />
        </div>
        <DataTable rows={pageRows} rowKey={(e) => e.id} rowHref={(e) => `/jamb/escalations/${e.id}`} empty={<EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="No cases match" />}
          columns={[
            { key: 'id', header: 'Case reference', cell: (e) => <span className="font-mono text-xs font-medium text-slate-900">{e.id}</span> },
            { key: 'n', header: 'Candidate', className: '!whitespace-normal min-w-[9rem]', cell: (e) => { const s = caseSubject(e.reg, state); return <span className="font-medium text-slate-900">{s?.firstName} {s?.lastName}</span>; } },
            { key: 'r', header: 'JAMB registration number', cell: (e) => <span className="font-mono text-xs">{e.reg}</span> },
            { key: 'i', header: 'Institution', className: '!whitespace-normal', cell: (e) => <span className="text-slate-600">{institutionByCode(e.institution)?.name}{e.escalation?.source === 'nysc' && <span className="block text-xs font-medium text-blue-700">Referred by NYSC</span>}</span> },
            { key: 's', header: 'Admission session', cell: (e) => e.session },
            { key: 't', header: 'Case type', className: '!whitespace-normal min-w-[9rem]', cell: (e) => <span>{CASE_TYPE_LABEL[caseTypeOf(e)]}<span className="block text-xs text-slate-500">{CATEGORY_LABEL[e.category]}</span></span> },
            { key: 'd', header: 'Date submitted', cell: (e) => <span className="tabular-nums text-slate-600">{formatDate(e.escalation!.submittedAt)}</span> },
            { key: 'a', header: 'Assigned officer', cell: (e) => <span className={e.assignedTo ? 'text-slate-700' : 'text-slate-400'}>{e.assignedTo ?? 'Unassigned'}</span> },
            { key: 'st', header: 'Status', cell: (e) => <EscalationStatusBadge e={e} /> },
            { key: 'v', header: 'Action', cell: (e) => <Link to={`/jamb/escalations/${e.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View case</Link> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={20} onPage={setPage} />
      </Card>
    </>
  );
}

type Dialog = null | { kind: 'decision'; outcome: ExceptionResolution } | { kind: 'info' } | { kind: 'refer' } | { kind: 'assign' } | { kind: 'close' };

/** JAMB's case investigation workspace: candidate, evidence, the institution's submission, and investigation and resolution. */
export function EscalationDetailPage() {
  const { id = '' } = useParams();
  const state = useJambState();
  const officer = useOfficer();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [findings, setFindings] = useState('');
  const [team, setTeam] = useState(INVESTIGATION_TEAMS[0]);
  const [assignee, setAssignee] = useState(officer.name);
  const [place, setPlace] = useState<{ institution: string; session: Session }>({ institution: '', session: '2025/2026' });
  const [reference, setReference] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const e = exceptionById(id, state);
  if (!e) return <NotFound what="Case" back="/jamb/escalations" />;
  if (!e.escalation) return <Navigate to={`/jamb/exceptions/${id}`} replace />;
  const s = caseSubject(e.reg, state);
  const type = caseTypeOf(e);
  const live = isLive(e);
  const decisions = CASE_DECISIONS[type];
  const open = (d: Exclude<Dialog, null>) => {
    setError(''); setReference(''); setInstructions('');
    setText(d.kind === 'info' ? 'Please provide the student’s admission letter and any supporting documents.' : '');
    if (d.kind === 'decision' && DECISION_NEEDS_PLACEMENT.includes(d.outcome)) setPlace({ institution: e.institution, session: e.session });
    setDialog(d);
  };
  const run = (fn: () => { ok: boolean; error?: string }, title: string) => {
    const x = fn();
    if (!x.ok) { setError((x as { error: string }).error); return; }
    setDialog(null); setText('');
    toast({ tone: 'success', title });
  };
  const addFindings = () => { const x = addExceptionNote(e.id, officer, findings); if (!x.ok) toast({ tone: 'error', title: 'Not recorded', description: x.error }); else { setFindings(''); toast({ tone: 'success', title: 'Investigation comment recorded' }); } };
  const mine = e.assignedTo === officer.name;
  return (
    <>
      <PageHeader title={`${CASE_TYPE_LABEL[type]}: ${s ? `${s.firstName} ${s.lastName}` : e.reg}`} breadcrumbs={[{ label: 'Escalation Management', to: '/jamb/escalations' }, { label: e.id }]}
        meta={<><EscalationStatusBadge e={e} /><span className="font-mono text-xs text-slate-500">{e.id}</span><span className="text-xs text-slate-500">{CATEGORY_LABEL[e.category]}</span></>}
        actions={live && !mine ? <Button onClick={() => run(() => assignCase(e.id, officer), 'You own this case')}>Take ownership</Button> : undefined} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-6">
          <Card className="px-5 py-5"><h2 className="mb-3 text-base font-semibold text-slate-900">A. Candidate information</h2><CandidateInfo e={e} /></Card>
          <Card className="px-5 py-5">
            <h2 className="mb-3 text-base font-semibold text-slate-900">B. {type === 'identity-discrepancy' || type === 'clearance-confirmation' ? 'Identity evidence and comparison' : type === 'existing-clearance' ? 'Existing clearance evidence' : 'Registration and admission check'}</h2>
            <CaseEvidence e={e} />
          </Card>
          <Card className="px-5 py-5"><h2 className="mb-3 text-base font-semibold text-slate-900">C. {e.escalation.source === 'nysc' ? 'NYSC referral' : 'Institution’s escalation submission'}</h2><Submission e={e} /></Card>
          <Card className="px-5 py-5" aria-label="Investigation and resolution">
            <h2 className="text-base font-semibold text-slate-900">D. Investigation and resolution</h2>
            <p className="mt-1 text-xs text-slate-500">JAMB is the authority over its admission and identity records. FixID records the investigation, the decision and its communication; it does not change JAMB’s own records. Record the reference of any authoritative correction completed in JAMB’s systems with the decision.</p>
            {e.resolution ? (
              <div className="mt-4 space-y-3">
                <DecisionCard e={e} />
                {escalationStatus(e) === 'resolved' && <Button variant="secondary" onClick={() => open({ kind: 'close' })}>Close case</Button>}
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <Field label="Investigation findings or comment">{(p) => <Textarea {...p} rows={3} value={findings} onChange={(x) => setFindings(x.target.value)} placeholder="What you checked and found" />}</Field>
                  <Button className="mt-2" size="sm" variant="secondary" icon={<MessageSquare className="h-4 w-4" />} onClick={addFindings}>Add investigation comment</Button>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Decision</p>
                  <div className="mt-2 flex flex-wrap gap-2" aria-label="Decisions">
                    {decisions.map((d) => <Button key={d} onClick={() => open({ kind: 'decision', outcome: d })}>{DECISION_ACTION[d] ?? RESOLUTION_LABEL[d]}</Button>)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => open({ kind: 'info' })}>Request More Information</Button>
                    <Button variant="secondary" onClick={() => open({ kind: 'refer' })}>Refer for Further Investigation</Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <CaseStatusCard e={e}>
            {live && <Button className="mt-4 w-full" size="sm" variant="secondary" onClick={() => { setAssignee(e.assignedTo ?? officer.name); open({ kind: 'assign' }); }}>{e.assignedTo ? 'Reassign case' : 'Assign case'}</Button>}
          </CaseStatusCard>
          <Card className="px-5 py-5"><h2 className="mb-3 text-base font-semibold text-slate-900">Case activity history</h2><CaseHistory e={e} /></Card>
        </div>
      </div>

      {dialog?.kind === 'decision' && (
        <Modal open onClose={() => setDialog(null)} title={DECISION_ACTION[dialog.outcome] ?? 'Record decision'} description={RESOLUTION_LABEL[dialog.outcome]}
          footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => run(() => resolveException(e.id, officer, dialog.outcome, text, { ...(DECISION_NEEDS_PLACEMENT.includes(dialog.outcome) ? place : {}), reference, instructions }), 'Decision recorded and returned to the institution')}>Record decision</Button></>}>
          {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <div className="space-y-3">
            {DECISION_NEEDS_PLACEMENT.includes(dialog.outcome) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Institution" required>{(p) => <Select {...p} value={place.institution} onChange={(x) => setPlace({ ...place, institution: x.target.value })}>{INSTITUTIONS.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}</Select>}</Field>
                <Field label="Admission session" required>{(p) => <Select {...p} value={place.session} onChange={(x) => setPlace({ ...place, session: x.target.value as Session })}>{SESSIONS.map((x) => <option key={x} value={x}>{x}</option>)}</Select>}</Field>
              </div>
            )}
            <Field label="Explanation" required>{(p) => <Textarea {...p} rows={4} value={text} onChange={(x) => setText(x.target.value)} />}</Field>
            <Field label="Instructions to the institution">{(p) => <Textarea {...p} rows={2} value={instructions} onChange={(x) => setInstructions(x.target.value)} />}</Field>
            <Field label="JAMB correction reference" hint="Only if an authoritative correction was completed in JAMB’s systems.">{(p) => <Input {...p} value={reference} onChange={(x) => setReference(x.target.value)} className="font-mono" />}</Field>
          </div>
        </Modal>
      )}
      {(dialog?.kind === 'info' || dialog?.kind === 'close') && (
        <Modal open onClose={() => setDialog(null)} title={dialog.kind === 'info' ? 'Request more information' : 'Close case'}
          footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => run(() => (dialog.kind === 'info' ? requestInformation(e.id, officer, text) : closeCase(e.id, officer, text)), dialog.kind === 'info' ? 'Information requested from the institution' : 'Case closed')}>{dialog.kind === 'info' ? 'Send request' : 'Close case'}</Button></>}>
          {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <Field label={dialog.kind === 'info' ? 'What’s needed' : 'Closing note'} required={dialog.kind === 'info'}>{(p) => <Textarea {...p} rows={4} value={text} onChange={(x) => setText(x.target.value)} />}</Field>
        </Modal>
      )}
      {dialog?.kind === 'refer' && (
        <Modal open onClose={() => setDialog(null)} title="Refer for further investigation"
          footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => run(() => referForInvestigation(e.id, officer, team, text), `Referred to ${team}`)}>Refer case</Button></>}>
          {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <div className="space-y-3">
            <Field label="JAMB team" required>{(p) => <Select {...p} value={team} onChange={(x) => setTeam(x.target.value)}>{INVESTIGATION_TEAMS.map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
            <Field label="Reason for referral" required>{(p) => <Textarea {...p} rows={4} value={text} onChange={(x) => setText(x.target.value)} />}</Field>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'assign' && (
        <Modal open onClose={() => setDialog(null)} title="Assign case"
          footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => run(() => assignCase(e.id, officer, assignee), `Assigned to ${assignee}`)}>Assign</Button></>}>
          {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <Field label="JAMB officer" required>{(p) => <Select {...p} value={assignee} onChange={(x) => setAssignee(x.target.value)}>{[...new Set([officer.name, ...JAMB_REVIEWERS])].map((n) => <option key={n}>{n}</option>)}</Select>}</Field>
        </Modal>
      )}
    </>
  );
}
