import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, MessageSquare, Send, ShieldAlert, XCircle } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, DataTable, DescriptionList, Drawer, EmptyState, Field, FilterSelect, Modal, PageHeader, Pagination, SearchInput, Select, StatCard, Textarea, usePageSlice, useToast,
} from '@/components/ui';
import { EXCEPTION_ACTION_LABEL } from '@/domain/exceptions';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { INSTITUTIONS, eventById, institutionByCode, type StudentRecord } from './data';
import { dateTime } from './format';
import { jambPortraitLabel, ninPortrait, registrationPortrait } from './portraits';
import {
  CATEGORY_LABEL, ESCALATION_STATUS_LABEL, RESOLUTION_LABEL, addExceptionNote, escalateToJamb, escalationStatus, escalationsOf, exceptionById, jambResponse, priorClearanceOf,
  recordOf, rejectEscalation, requestInformation, resolveException, respondToEscalation, startReview, useJambState,
  type Comparison, type EscalationStatus, type ExceptionCategory, type ExceptionResolution, type JambException,
} from './store';
import { NotFound, Section } from './shared';
import { FaceImage, Portrait, useOfficer } from './ui';

/* ---------------- shared pieces ---------------- */

const STATUS_TONE: Record<EscalationStatus, 'warning' | 'violet' | 'info' | 'success' | 'neutral'> = { open: 'warning', 'in-review': 'violet', 'awaiting-information': 'info', resolved: 'success', rejected: 'neutral' };
export const EscalationStatusBadge = ({ e }: { e: JambException }) => <Badge tone={STATUS_TONE[escalationStatus(e)]} dot>{ESCALATION_STATUS_LABEL[escalationStatus(e)]}</Badge>;

const RESULT = {
  match: { label: 'Match', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> },
  mismatch: { label: 'Mismatch', cls: 'bg-red-50 text-red-800 ring-red-200', icon: <XCircle className="h-4 w-4" aria-hidden="true" /> },
  pending: { label: 'Inconclusive', cls: 'bg-amber-50 text-amber-900 ring-amber-200', icon: <CircleDashed className="h-4 w-4" aria-hidden="true" /> },
};

/** The identity evidence (three compact portraits) and the verification results (one row per comparison). */
export function IdentityComparison({ record, capture, comparisons, captureNote }: { record: StudentRecord; capture?: string; comparisons: Comparison[]; captureNote?: string }) {
  const exam = jambPortraitLabel(record) === 'JAMB examination verification record';
  const img = 'aspect-[4/5] h-auto w-full';
  const panels: [string, ReactNode][] = [
    [exam ? 'JAMB Examination Verification Record' : 'JAMB Registration Record', <FaceImage src={registrationPortrait(record)} label={`${jambPortraitLabel(record)}: ${record.firstName} ${record.lastName}`} className={img} />],
    ['NIN Identity Record', <FaceImage src={ninPortrait(record)} label="NIN identity record portrait" className={img} />],
    ['Live Clearance Capture', capture ? <img src={capture} alt="Live clearance capture" className="aspect-[4/5] w-full rounded-lg object-cover ring-1 ring-slate-200" /> : <FaceImage label={captureNote ?? 'Capture not retained'} className={img} />],
  ];
  const heading = 'mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500';
  return (
    <section aria-label="Identity Verification Analysis" className="grid items-start gap-5 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div aria-label="Student identity evidence">
        <h3 className={heading}>Identity evidence</h3>
        <div className="grid max-w-[22rem] grid-cols-3 gap-3">
          {panels.map(([label, el]) => (
            <figure key={label} className="min-w-0">
              {el}
              <figcaption className="mt-1.5 text-center text-[11px] font-semibold leading-tight text-slate-700">{label}</figcaption>
            </figure>
          ))}
        </div>
      </div>
      <div>
        <h3 className={heading}>Verification results</h3>
        <ul aria-label="Comparison outcomes" className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {comparisons.map((c) => (
            <li key={c.label} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <span className="font-medium text-slate-800">{c.label}</span>
              <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', RESULT[c.result].cls)}>{RESULT[c.result].icon}{RESULT[c.result].label}</span>
            </li>
          ))}
        </ul>
      </div>
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
export function EscalationStatusPanel({ e }: { e: JambException }) {
  const officer = useOfficer();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const response = jambResponse(e);
  const status = escalationStatus(e);
  const send = () => { const r = respondToEscalation(e.id, officer, reply); if (!r.ok) toast({ tone: 'error', title: 'Not sent', description: r.error }); else { setReply(''); toast({ tone: 'success', title: 'Response sent to JAMB' }); } };
  return (
    <Card className="px-5 py-4" aria-label="Escalation to JAMB">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><ShieldAlert className="h-5 w-5 text-violet-600" aria-hidden="true" />Escalated to JAMB</h2>
        <EscalationStatusBadge e={e} />
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {([['Escalation reference', <span className="font-mono">{e.id}</span>], ['Reason', e.escalation!.reason ?? CATEGORY_LABEL[e.category]], ['Submitted', dateTime(e.escalation!.submittedAt)], ['Submitted by', e.escalation!.submittedBy]] as [string, ReactNode][]).map(([k, v]) => (
          <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
        ))}
      </dl>
      {(e.resolution || response) && (
        <div className={cn('mt-3 rounded-lg px-4 py-3 text-sm ring-1 ring-inset', status === 'resolved' ? 'bg-emerald-50 ring-emerald-200' : status === 'rejected' ? 'bg-slate-50 ring-slate-200' : 'bg-violet-50 ring-violet-200')}>
          <p className="font-semibold text-slate-900">JAMB response{e.resolution ? `: ${RESOLUTION_LABEL[e.resolution.outcome]}` : ''}</p>
          <p className="mt-1 text-slate-700">{e.resolution?.note ?? response?.comment ?? 'JAMB is reviewing the case.'}</p>
          <p className="mt-1 text-xs text-slate-500">{e.resolution ? `${e.resolution.by} · ${dateTime(e.resolution.at)}` : response ? `${response.actorName} · ${dateTime(response.at)}` : ''}</p>
        </div>
      )}
      {status === 'awaiting-information' && (
        <div className="mt-3 space-y-2">
          <Field label="Your response to JAMB">{(p) => <Textarea {...p} rows={3} value={reply} onChange={(x) => setReply(x.target.value)} />}</Field>
          <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={send}>Send response</Button>
        </div>
      )}
    </Card>
  );
}

/* ---------------- JAMB: Identity Exceptions & Escalations ---------------- */

/** Switches between escalations and the full exceptions register (one section). */
export function ExceptionSectionTabs({ current }: { current: 'escalations' | 'exceptions' }) {
  const tab = (to: string, label: string, active: boolean) => (
    <Link to={to} aria-current={active ? 'page' : undefined} className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900')}>{label}</Link>
  );
  return <nav aria-label="Exceptions section" className="inline-flex gap-1 rounded-xl bg-slate-100 p-1">{tab('/jamb/escalations', 'Escalations', current === 'escalations')}{tab('/jamb/exceptions', 'All exceptions', current === 'exceptions')}</nav>;
}

export function EscalationsPage() {
  const state = useJambState();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [inst, setInst] = useQueryState('institution', 'all');
  const [page, setPage] = usePageParam();
  const all = useMemo(() => escalationsOf(state).sort((a, b) => b.escalation!.submittedAt.localeCompare(a.escalation!.submittedAt)), [state]);
  const count = (s: EscalationStatus) => all.filter((e) => escalationStatus(e) === s).length;
  const query = q.trim().toLowerCase();
  const rows = all.filter((e) => {
    const r = recordOf(e.reg, state);
    return (status === 'all' || escalationStatus(e) === status) && (inst === 'all' || e.institution === inst)
      && (!query || [e.id, e.reg, r?.firstName, r?.lastName].join(' ').toLowerCase().includes(query));
  });
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 20);
  return (
    <>
      <PageHeader title="Identity Exceptions & Escalations" description="Identity issues reported by participating institutions for JAMB review." />
      <ExceptionSectionTabs current="escalations" />
      <section aria-label="Escalation summary" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total escalations" value={all.length} />
        <StatCard label="Open cases" value={count('open')} tone="amber" />
        <StatCard label="Under review" value={count('in-review')} tone="violet" />
        <StatCard label="Awaiting information" value={count('awaiting-information')} />
        <StatCard label="Resolved" value={count('resolved') + count('rejected')} tone="emerald" hint={count('rejected') ? `incl. ${count('rejected')} rejected` : undefined} />
      </section>
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Reference, student or registration number" className="sm:w-80" label="Search escalations" />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Any status' }, ...(Object.keys(ESCALATION_STATUS_LABEL) as EscalationStatus[]).map((s) => ({ value: s, label: ESCALATION_STATUS_LABEL[s] }))]} />
          <div className="min-w-0 max-w-full [&_select]:w-full [&_select]:max-w-full"><FilterSelect label="Institution" value={inst} onChange={setInst} options={[{ value: 'all', label: 'All institutions' }, ...INSTITUTIONS.map((i) => ({ value: i.code, label: i.name }))]} /></div>
        </div>
        <DataTable rows={pageRows} rowKey={(e) => e.id} rowHref={(e) => `/jamb/escalations/${e.id}`} empty={<EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="No escalations match" />}
          columns={[
            { key: 'id', header: 'Escalation reference', cell: (e) => <Link to={`/jamb/escalations/${e.id}`} className="font-mono text-xs font-medium text-slate-900 hover:text-brand-700">{e.id}</Link> },
            { key: 'n', header: 'Student', className: '!whitespace-normal min-w-[9rem]', cell: (e) => { const r = recordOf(e.reg, state); return <span className="font-medium text-slate-900">{r?.firstName} {r?.lastName}</span>; } },
            { key: 'r', header: 'JAMB registration number', cell: (e) => <span className="font-mono text-xs">{e.reg}</span> },
            { key: 'i', header: 'Institution', className: '!whitespace-normal', cell: (e) => <span className="text-slate-600">{institutionByCode(e.institution)?.name}</span> },
            { key: 's', header: 'Admission session', cell: (e) => e.session },
            { key: 'c', header: 'Category', className: '!whitespace-normal min-w-[10rem]', cell: (e) => <span>{CATEGORY_LABEL[e.category]}{e.escalation?.reason && <span className="block text-xs text-slate-500">{e.escalation.reason}</span>}</span> },
            { key: 'd', header: 'Date submitted', cell: (e) => <span className="tabular-nums text-slate-600">{formatDate(e.escalation!.submittedAt)}</span> },
            { key: 'st', header: 'Status', cell: (e) => <EscalationStatusBadge e={e} /> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={20} onPage={setPage} />
      </Card>
    </>
  );
}

type Dialog = null | 'comment' | 'info' | 'resolve' | 'reject';
const RESOLUTIONS: Partial<Record<ExceptionCategory, ExceptionResolution[]>> = {
  'jamb-nin-discrepancy': ['identity-confirmed', 'identity-not-confirmed', 'record-corrected'],
  'exam-impersonation': ['identity-confirmed', 'identity-not-confirmed', 'record-corrected'],
  'duplicate-clearance': ['existing-record-confirmed', 'release-authorised', 'previous-clearance-revoked', 'no-further-action'],
};

export function EscalationDetailPage() {
  const { id = '' } = useParams();
  const state = useJambState();
  const officer = useOfficer();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<ExceptionResolution>('identity-confirmed');
  const [error, setError] = useState('');
  const e = exceptionById(id, state);
  if (!e) return <NotFound what="Escalation" back="/jamb/escalations" />;
  if (!e.escalation) return <Navigate to={`/jamb/exceptions/${id}`} replace />;
  const r = recordOf(e.reg, state)!;
  const inst = institutionByCode(e.institution)!;
  const prior = priorClearanceOf(e.reg);
  const status = escalationStatus(e);
  const live = status === 'open' || status === 'in-review' || status === 'awaiting-information';
  const outcomes = RESOLUTIONS[e.category] ?? ['identity-confirmed', 'identity-not-confirmed', 'no-further-action'];
  const open = (d: Dialog) => { setError(''); setText(d === 'info' ? 'Please provide the student’s NIN slip and a copy of the admission letter.' : ''); if (d === 'resolve') setOutcome(outcomes[0]); setDialog(d); };
  const run = (fn: () => { ok: boolean; error?: string }, title: string) => {
    const x = fn();
    if (!x.ok) { setError((x as { error: string }).error); return; }
    setDialog(null); setText('');
    toast({ tone: 'success', title });
  };
  return (
    <>
      <PageHeader title={CATEGORY_LABEL[e.category]} breadcrumbs={[{ label: 'Identity Exceptions & Escalations', to: '/jamb/escalations' }, { label: e.id }]}
        meta={<><EscalationStatusBadge e={e} /><span className="font-mono text-xs text-slate-500">{e.id}</span></>}
        actions={live ? (
          <>
            {status !== 'in-review' && <Button variant="secondary" onClick={() => run(() => startReview(e.id, officer), 'Marked as under review')}>Mark under review</Button>}
            <Button variant="secondary" icon={<MessageSquare className="h-4 w-4" />} onClick={() => open('comment')}>Add comment</Button>
            <Button variant="secondary" onClick={() => open('info')}>Request information</Button>
            <Button variant="secondary" onClick={() => open('reject')}>Reject</Button>
            <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => open('resolve')}>Resolve</Button>
          </>
        ) : undefined} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-6">
          {e.category === 'duplicate-clearance' && prior ? (
            <Card className="px-5 py-5" aria-label="Existing clearance record">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />Existing clearance record</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                {([['Previous institution', institutionByCode(prior.institution)?.name], ['Previous admission session', prior.session], ['Department', prior.department], ['Previous clearance date', dateTime(prior.clearedAt)], ['Clearance officer', prior.clearedBy], ['Previous clearance reference', <span className="font-mono">{prior.reference}</span>],
                  ['Existing clearance status', 'Cleared'], ['Presenting institution', inst.name], ['Current admission session', r.session]] as [string, ReactNode][]).map(([k, v]) => (
                  <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>
                ))}
              </dl>
            </Card>
          ) : (
            <Card className="px-5 py-5">
              <h2 className="mb-4 text-base font-semibold text-slate-900">Identity Verification Analysis</h2>
              <IdentityComparison record={r} capture={e.escalation.capture} comparisons={e.escalation.comparisons ?? []} captureNote="Live capture not attached" />
            </Card>
          )}
          <Card className="px-5 py-5" aria-label="Clearance officer’s comment">
            <h2 className="text-base font-semibold text-slate-900">Clearance officer’s comment</h2>
            <blockquote className="mt-2 border-l-4 border-slate-200 pl-4 text-sm text-slate-800">{e.escalation.comment}</blockquote>
            <p className="mt-2 text-xs text-slate-500">{e.escalation.submittedBy}, {e.escalation.submittedByTitle} · {inst.name} · {dateTime(e.escalation.submittedAt)}</p>
          </Card>
          <Card className="px-5 py-5">
            <DescriptionList items={[
              { label: 'Escalation reference', value: <span className="font-mono">{e.id}</span> },
              { label: 'Submitted', value: `${dateTime(e.escalation.submittedAt)} by ${e.escalation.submittedBy}` },
              { label: 'Institution', value: `${inst.name} (${inst.code})` },
              { label: 'Event', value: eventById(e.eventId)?.name ?? '—' },
              { label: 'Category', value: CATEGORY_LABEL[e.category] },
              ...(e.escalation.reason ? [{ label: 'Escalation reason', value: e.escalation.reason }] : []),
              { label: 'Supporting evidence', value: e.escalation.evidence.join(', ') || '—' },
              ...(e.activityRef ? [{ label: 'Verification reference', value: <span className="font-mono">{e.activityRef}</span> }] : []),
            ]} />
          </Card>
          {e.resolution && (
            <Card className="px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Decision</h2>
              <p className="mt-1 text-sm font-medium text-slate-900">{RESOLUTION_LABEL[e.resolution.outcome]}</p>
              <p className="mt-1 text-sm text-slate-700">{e.resolution.note}</p>
              <p className="mt-1 text-xs text-slate-500">{e.resolution.by} · {dateTime(e.resolution.at)}</p>
            </Card>
          )}
          <Section title="Case history">
            <ol className="divide-y divide-slate-100" aria-label="Case history">
              {[...e.history].reverse().map((h) => (
                <li key={h.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-slate-900">{h.action === 'created' ? 'Escalation submitted' : h.action === 'note-added' ? 'Comment added' : EXCEPTION_ACTION_LABEL[h.action]}</span><span className="text-xs text-slate-500">{dateTime(h.at)}</span></div>
                  <p className="text-xs text-slate-500">{h.actorName} · {h.actorOrganizationId}</p>
                  {h.comment && <p className="mt-1 text-slate-700">{h.comment}</p>}
                </li>
              ))}
            </ol>
          </Section>
        </div>
        <aside className="space-y-4">
          <Card className="px-4 py-4" aria-label="Student information">
            <Portrait record={r} className="h-56 w-full" />
            <p className="mt-3 font-semibold text-slate-900">{r.firstName} {r.middleName} {r.lastName}</p>
            <dl className="mt-2 space-y-1.5 text-sm">
              {([['JAMB Registration Number', <span className="font-mono">{r.reg}</span>], ['Institution', inst.name], ['Department', r.department], ['Admission session', r.session], ['Date of birth', formatDate(r.dateOfBirth)]] as [string, ReactNode][]).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="text-slate-900">{v}</dd></div>
              ))}
            </dl>
            <ButtonLink to={`/jamb/students/${r.reg}`} className="mt-3 w-full justify-center">Open identity record</ButtonLink>
          </Card>
        </aside>
      </div>

      {dialog && dialog !== 'resolve' && (
        <Modal open onClose={() => setDialog(null)} title={dialog === 'comment' ? 'Add investigation comment' : dialog === 'info' ? 'Request additional information' : 'Reject escalation'}
          footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => run(() => (dialog === 'comment' ? addExceptionNote(e.id, officer, text) : dialog === 'info' ? requestInformation(e.id, officer, text) : rejectEscalation(e.id, officer, text)), dialog === 'comment' ? 'Comment added' : dialog === 'info' ? 'Information requested' : 'Escalation rejected')}>{dialog === 'comment' ? 'Add comment' : dialog === 'info' ? 'Send request' : 'Reject escalation'}</Button></>}>
          {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
          <Field label={dialog === 'reject' ? 'Reason' : dialog === 'info' ? 'What’s needed' : 'Comment'} required>{(p) => <Textarea {...p} rows={4} value={text} onChange={(x) => setText(x.target.value)} />}</Field>
        </Modal>
      )}
      {dialog === 'resolve' && (
        <Modal open onClose={() => setDialog(null)} title="Resolve escalation" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => run(() => resolveException(e.id, officer, outcome, text), 'Escalation resolved')}>Record decision</Button></>}>
          <div className="space-y-3">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <Field label="Decision">{(p) => <Select {...p} value={outcome} onChange={(x) => setOutcome(x.target.value as ExceptionResolution)}>{outcomes.map((o) => <option key={o} value={o}>{RESOLUTION_LABEL[o]}</option>)}</Select>}</Field>
            <Field label="Resolution notes" required>{(p) => <Textarea {...p} rows={4} value={text} onChange={(x) => setText(x.target.value)} />}</Field>
          </div>
        </Modal>
      )}
    </>
  );
}
