import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ExceptionSectionTabs } from './escalations';
import { Ban, CheckCircle2, Mail, RotateCcw, ScrollText, Search, ShieldAlert, UserCog, UserPlus } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, ConfirmDialog, DataTable, DescriptionList, Drawer, EmptyState, Field, FilterSelect, Input, Modal, OverflowMenu, PageHeader, Pagination,
  SearchInput, Select, StatCard, Tabs, Textarea, usePageSlice, useToast,
} from '@/components/ui';
import { dateTime } from './format';
import { EXCEPTION_ACTION_LABEL, EXCEPTION_STATUS_LABEL, type ExceptionStatus } from '@/domain/exceptions';
import { ExceptionStatusBadge } from '@/pages/exceptions/ExceptionsPage';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { EVENTS, INSTITUTIONS, SESSIONS, eventById, institutionByCode, normaliseReg, sessionSlug } from './data';
import { StudentJourney } from './journey';
import {
  CATEGORY_LABEL, OUTCOME_LABEL, RESOLUTION_LABEL, ROLE_ACCESS, USER_ROLE_LABEL, addExceptionNote, allActivities, assignException, auditLog, closeException,
  exceptionById, exceptionsOf, inviteUser, isOpenException, organisationName, recordOf, reopenException, requestInformation, resetJambDemo, resolveException,
  rolesFor, setUserRole, setUserStatus, startReview, useJambState, usersOf, type ActivityOutcome, type ExceptionCategory, type ExceptionResolution, type PlatformUser, type UserRole,
} from './store';
import { NotFound, OutcomeBadge, Section } from './shared';
import { Portrait, fmt, useOfficer } from './ui';

const PAGE = 20;
const linkCls = 'font-medium text-slate-900 hover:text-brand-700';

/* ---------------- Verification activity ---------------- */

export function ActivityPage() {
  const state = useJambState();
  const [q, setQ] = useQueryState('q');
  const [kind, setKind] = useQueryState('kind', 'all');
  const [inst, setInst] = useQueryState('institution', 'all');
  const [outcome, setOutcome] = useQueryState('outcome', 'all');
  const [event, setEvent] = useQueryState('event', 'all');
  const [page, setPage] = usePageParam();
  const all = useMemo(() => allActivities(state), [state]);
  const query = q.trim().toLowerCase();
  const rows = useMemo(() => all.filter((a) => (kind === 'all' || a.kind === kind) && (inst === 'all' || a.institution === inst) && (outcome === 'all' || a.outcome === outcome) && (event === 'all' || a.eventId === event)
    && (!query || [a.ref, a.reg, a.officer, a.input].join(' ').toLowerCase().includes(query.replace(/\s+/g, '')) || a.officer.toLowerCase().includes(query))), [all, kind, inst, outcome, event, query]);
  const { pageRows, pageCount, current } = usePageSlice(rows, page, PAGE);
  return (
    <>
      <PageHeader title="Verification Activity" description="Every identity verification performed by institutions and NYSC." />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Registration number, officer or reference" className="sm:w-80" label="Search activity" />
          <FilterSelect label="Type" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All activity' }, { value: 'university', label: 'University clearance' }, { value: 'nysc', label: 'NYSC verification' }]} />
          <FilterSelect label="Event" value={event} onChange={setEvent} options={[{ value: 'all', label: 'All events' }, ...EVENTS.map((e) => ({ value: e.id, label: e.name }))]} />
          <div className="min-w-0 max-w-full [&_select]:w-full [&_select]:max-w-full"><FilterSelect label="Institution" value={inst} onChange={setInst} options={[{ value: 'all', label: 'All institutions' }, ...INSTITUTIONS.map((i) => ({ value: i.code, label: i.name }))]} /></div>
          <FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={[{ value: 'all', label: 'All outcomes' }, ...(Object.keys(OUTCOME_LABEL) as ActivityOutcome[]).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))]} />
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500" role="status">{fmt(rows.length)} activities</p>
        <DataTable rows={pageRows} rowKey={(a) => `${a.ref}-${a.outcome}`} rowHref={(a) => (a.reg ? `/jamb/students/${a.reg}` : '')} empty={<EmptyState title="No activity matches" />}
          columns={[
            { key: 't', header: 'Date and time', cell: (a) => <span className="tabular-nums text-slate-600">{dateTime(a.at)}</span> },
            { key: 's', header: 'Student', className: '!whitespace-normal min-w-[10rem]', cell: (a) => { const r = a.reg ? recordOf(a.reg, state) : undefined; return r ? <Link to={`/jamb/students/${r.reg}`} className={linkCls}>{r.firstName} {r.lastName}<span className="block font-mono text-xs font-normal text-slate-500">{r.reg}</span></Link> : <span className="font-mono text-xs">{a.input}</span>; } },
            { key: 'o', header: 'Organisation', className: '!whitespace-normal', cell: (a) => <span className="text-slate-600">{a.organisation}</span> },
            { key: 'f', header: 'Officer', cell: (a) => a.officer },
            { key: 'e', header: 'Event', className: '!whitespace-normal', cell: (a) => <span className="text-slate-600">{eventById(a.eventId)?.name}</span> },
            { key: 'r', header: 'Outcome', cell: (a) => <OutcomeBadge outcome={a.outcome} /> },
            { key: 'ref', header: 'Reference', cell: (a) => <span className="font-mono text-xs text-slate-600">{a.ref}</span> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={PAGE} onPage={setPage} />
      </Card>
    </>
  );
}

/* ---------------- Exceptions (FixID exception lifecycle) ---------------- */

export function ExceptionsPage() {
  const state = useJambState();
  const [view, setView] = useQueryState('view', 'open');
  const [q, setQ] = useQueryState('q');
  const [category, setCategory] = useQueryState('category', 'all');
  const [inst, setInst] = useQueryState('institution', 'all');
  const [event, setEvent] = useQueryState('event', 'all');
  const [status, setStatus] = useQueryState('status', 'all');
  const [page, setPage] = usePageParam();
  const [, setParams] = useSearchParams();
  const all = useMemo(() => exceptionsOf(state), [state]);
  const query = q.trim().toLowerCase().replace(/\s+/g, '');
  const base = view === 'open' ? all.filter(isOpenException) : view === 'resolved' ? all.filter((e) => !isOpenException(e)) : all;
  const rows = base.filter((e) => (category === 'all' || e.category === category) && (inst === 'all' || e.institution === inst) && (event === 'all' || e.eventId === event) && (status === 'all' || e.status === status)
    && (!query || `${e.id}${e.reg}`.toLowerCase().includes(query)));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, PAGE);
  const clear = () => setParams((p) => { const n = new URLSearchParams(p); ['q', 'category', 'institution', 'event', 'status', 'page'].forEach((k) => n.delete(k)); return n; }, { replace: true });
  return (
    <>
      <PageHeader title="Identity Exceptions & Escalations" description="Every identity exception raised by clearance and NYSC verification, including institutions’ escalations." />
      <ExceptionSectionTabs current="exceptions" />
      <div><Tabs value={view as 'open' | 'all' | 'resolved'} onChange={(v) => setView(v)} tabs={[
        { value: 'open', label: 'Open', count: all.filter(isOpenException).length },
        { value: 'resolved', label: 'Resolved or closed', count: all.filter((e) => !isOpenException(e)).length },
        { value: 'all', label: 'All', count: all.length },
      ]} /></div>
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Reference or registration number" className="sm:w-72" label="Search exceptions" />
          <FilterSelect label="Category" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All categories' }, ...(Object.keys(CATEGORY_LABEL) as ExceptionCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]} />
          <div className="min-w-0 max-w-full [&_select]:w-full [&_select]:max-w-full"><FilterSelect label="Institution" value={inst} onChange={setInst} options={[{ value: 'all', label: 'All institutions' }, ...INSTITUTIONS.map((i) => ({ value: i.code, label: i.name }))]} /></div>
          <FilterSelect label="Event" value={event} onChange={setEvent} options={[{ value: 'all', label: 'All events' }, ...EVENTS.map((e) => ({ value: e.id, label: e.name }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Any status' }, ...(['open', 'assigned', 'in-review', 'awaiting-information', 'reopened', 'resolved', 'closed'] as ExceptionStatus[]).map((s) => ({ value: s, label: EXCEPTION_STATUS_LABEL[s] }))]} />
        </div>
        <DataTable rows={pageRows} rowKey={(e) => e.id} rowHref={(e) => (e.escalation ? `/jamb/escalations/${e.id}` : `/jamb/exceptions/${e.id}`)}
          empty={<EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="No exceptions match" action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />}
          columns={[
            { key: 'id', header: 'Reference', cell: (e) => <Link to={e.escalation ? `/jamb/escalations/${e.id}` : `/jamb/exceptions/${e.id}`} className="font-mono text-xs font-medium text-slate-900 hover:text-brand-700">{e.id}</Link> },
            { key: 's', header: 'Student', className: '!whitespace-normal min-w-[10rem]', cell: (e) => { const r = recordOf(e.reg, state); return <span><span className="block font-medium text-slate-900">{r?.firstName} {r?.lastName}</span><span className="font-mono text-xs text-slate-500">{e.reg}</span></span>; } },
            { key: 'i', header: 'Institution', className: '!whitespace-normal', cell: (e) => <span className="text-slate-600">{institutionByCode(e.institution)?.shortName}<span className="block text-xs text-slate-400">{e.session}</span></span> },
            { key: 'c', header: 'Category', className: '!whitespace-normal min-w-[10rem]', cell: (e) => CATEGORY_LABEL[e.category] },
            { key: 'r', header: 'Raised', cell: (e) => <span className="tabular-nums text-slate-600">{formatDate(e.raisedAt)}<span className="block text-xs text-slate-400">{e.raisedBy}</span></span> },
            { key: 'a', header: 'Assigned to', cell: (e) => e.assignedTo ?? <span className="text-slate-400">Unassigned</span> },
            { key: 'st', header: 'Status', cell: (e) => <ExceptionStatusBadge status={e.status} /> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={PAGE} onPage={setPage} />
      </Card>
    </>
  );
}

const REVIEWERS = ['Grace Uwaifo', 'Musa Idris', 'Aisha Danjuma'];
type Dialog = null | 'assign' | 'note' | 'info' | 'resolve' | 'reopen' | 'close';

export function ExceptionDetailPage() {
  const { id = '' } = useParams();
  const state = useJambState();
  const officer = useOfficer();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [reviewer, setReviewer] = useState(REVIEWERS[0]);
  const [resolution, setResolution] = useState<ExceptionResolution>('identity-confirmed');
  const [error, setError] = useState('');
  const e = exceptionById(id, state);
  if (!e) return <NotFound what="Exception" back="/jamb/exceptions" />;
  if (e.escalation) return <Navigate to={`/jamb/escalations/${e.id}`} replace />;
  const r = recordOf(e.reg, state);
  const inst = institutionByCode(e.institution)!;
  const open = isOpenException(e);
  const run = (fn: () => { ok: boolean; error?: string }, success: string) => {
    const x = fn();
    if (!x.ok) { setError((x as { error: string }).error); return; }
    setDialog(null); setText(''); setError('');
    toast({ tone: 'success', title: success });
  };
  const resolutions: ExceptionResolution[] = e.category === 'duplicate-clearance' ? ['clearance-revoked', 'no-further-action'] : e.category === 'record-inconsistency' ? ['record-corrected', 'identity-confirmed', 'identity-not-confirmed'] : ['identity-confirmed', 'identity-not-confirmed', 'no-further-action'];
  return (
    <>
      <PageHeader title={CATEGORY_LABEL[e.category]} breadcrumbs={[{ label: 'Exceptions', to: '/jamb/exceptions' }, { label: e.id }]} meta={<><ExceptionStatusBadge status={e.status} /><span className="font-mono text-xs text-slate-500">{e.id}</span></>}
        actions={open ? (
          <>
            {(e.status === 'open' || e.status === 'reopened') && <Button variant="secondary" onClick={() => { setError(''); setDialog('assign'); }}>Assign</Button>}
            {['open', 'assigned', 'reopened', 'awaiting-information'].includes(e.status) && <Button variant="secondary" onClick={() => run(() => startReview(e.id, officer), 'Review started')}>Start review</Button>}
            {e.status === 'in-review' && <Button variant="secondary" onClick={() => { setError(''); setDialog('info'); }}>Request information</Button>}
            <Button variant="secondary" onClick={() => { setError(''); setDialog('note'); }}>Add note</Button>
            <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => { setError(''); setResolution(resolutions[0]); setDialog('resolve'); }}>Resolve</Button>
          </>
        ) : (
          <>
            {e.status === 'resolved' && <Button variant="secondary" onClick={() => setDialog('close')}>Close</Button>}
            <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { setError(''); setDialog('reopen'); }}>Reopen</Button>
          </>
        )} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card className="px-5 py-5">
            <p className="text-sm text-slate-700">{e.summary}</p>
            <div className="mt-4">
              <DescriptionList items={[
                { label: 'Category', value: CATEGORY_LABEL[e.category] },
                { label: 'Event', value: <Link to={`/jamb/events/${e.eventId}`} className="text-brand-700 hover:underline">{eventById(e.eventId)?.name}</Link> },
                { label: 'Institution', value: inst.name },
                { label: 'Admission session', value: e.session },
                { label: 'Raised', value: `${dateTime(e.raisedAt)} by ${e.raisedBy}, ${e.raisedByOrganisation}` },
                { label: 'Assigned to', value: e.assignedTo ?? 'Unassigned' },
                ...(e.activityRef ? [{ label: 'Verification reference', value: <span className="font-mono">{e.activityRef}</span> }] : []),
              ]} />
            </div>
          </Card>
          <Section title="Supporting verification outcomes">
            <dl className="divide-y divide-slate-100" aria-label="Supporting verification outcomes">
              {e.evidence.map((x) => (
                <div key={x.label} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <dt className="text-slate-600">{x.label}</dt>
                  <dd className={cn('font-medium', x.tone === 'bad' ? 'text-red-700' : x.tone === 'good' ? 'text-emerald-700' : 'text-slate-900')}>{x.value}</dd>
                </div>
              ))}
            </dl>
          </Section>
          {e.resolution && (
            <Card className="px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Resolution</h2>
              <p className="mt-1 text-sm font-medium text-slate-900">{RESOLUTION_LABEL[e.resolution.outcome]}</p>
              <p className="mt-1 text-sm text-slate-700">{e.resolution.note}</p>
              <p className="mt-1 text-xs text-slate-500">{e.resolution.by} · {dateTime(e.resolution.at)}</p>
            </Card>
          )}
          <Section title="History and notes">
            <ol className="divide-y divide-slate-100" aria-label="Exception history">
              {[...e.history].reverse().map((h) => (
                <li key={h.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-slate-900">{EXCEPTION_ACTION_LABEL[h.action]}</span><span className="text-xs text-slate-500">{dateTime(h.at)}</span></div>
                  <p className="text-xs text-slate-500">{h.actorName} · {h.actorOrganizationId}{h.toStatus && h.fromStatus !== h.toStatus ? ` · ${EXCEPTION_STATUS_LABEL[h.toStatus]}` : ''}</p>
                  {h.comment && <p className="mt-1 text-slate-700">{h.comment}</p>}
                </li>
              ))}
            </ol>
          </Section>
        </div>
        <aside className="space-y-4">
          {r && (
            <Card className="px-4 py-4">
              <div className="flex gap-3">
                <Portrait record={r} className="h-24 w-20" />
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-slate-900">{r.firstName} {r.middleName} {r.lastName}</p>
                  <p className="font-mono text-xs text-slate-600">{r.reg}</p>
                  <p className="mt-1 text-slate-600">{r.department}</p>
                </div>
              </div>
              <ButtonLink to={`/jamb/students/${r.reg}`} className="mt-3 w-full justify-center">Open identity record</ButtonLink>
            </Card>
          )}
        </aside>
      </div>

      {dialog === 'assign' && (
        <Modal open onClose={() => setDialog(null)} title="Assign exception" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => run(() => assignException(e.id, officer, reviewer), `Assigned to ${reviewer}`)}>Assign</Button></>}>
          <Field label="Reviewer">{(p) => <Select {...p} value={reviewer} onChange={(x) => setReviewer(x.target.value)}>{REVIEWERS.map((n) => <option key={n}>{n}</option>)}</Select>}</Field>
        </Modal>
      )}
      {(dialog === 'note' || dialog === 'info' || dialog === 'reopen') && (
        <Modal open onClose={() => setDialog(null)} title={dialog === 'note' ? 'Add note' : dialog === 'info' ? 'Request information' : 'Reopen exception'}
          footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => run(() => (dialog === 'note' ? addExceptionNote(e.id, officer, text) : dialog === 'info' ? requestInformation(e.id, officer, text) : reopenException(e.id, officer, text)), dialog === 'note' ? 'Note added' : dialog === 'info' ? 'Information requested' : 'Exception reopened')}>{dialog === 'note' ? 'Add note' : dialog === 'info' ? 'Send request' : 'Reopen'}</Button></>}>
          {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
          <Field label={dialog === 'info' ? 'What’s needed' : 'Note'}>{(p) => <Textarea {...p} rows={4} value={text} onChange={(x) => setText(x.target.value)} />}</Field>
        </Modal>
      )}
      {dialog === 'resolve' && (
        <Modal open onClose={() => setDialog(null)} title="Resolve exception" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => run(() => resolveException(e.id, officer, resolution, text), 'Exception resolved')}>Record resolution</Button></>}>
          <div className="space-y-3">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <Field label="Outcome">{(p) => <Select {...p} value={resolution} onChange={(x) => setResolution(x.target.value as ExceptionResolution)}>{resolutions.map((o) => <option key={o} value={o}>{RESOLUTION_LABEL[o]}</option>)}</Select>}</Field>
            <Field label="Resolution notes" required>{(p) => <Textarea {...p} rows={4} value={text} onChange={(x) => setText(x.target.value)} />}</Field>
          </div>
        </Modal>
      )}
      <ConfirmDialog open={dialog === 'close'} title="Close this exception?" description="The resolution is kept in its history." confirmLabel="Close exception" onCancel={() => setDialog(null)} onConfirm={() => run(() => closeException(e.id, officer), 'Exception closed')} />
    </>
  );
}

/* ---------------- Student records ---------------- */

export function StudentSearchPage() {
  const navigate = useNavigate();
  const state = useJambState();
  const [q, setQ] = useQueryState('reg');
  const reg = normaliseReg(q);
  const r = reg ? recordOf(reg, state) : undefined;
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return allActivities(state).filter((a) => a.reg && !seen.has(a.reg) && seen.add(a.reg)).slice(0, 8);
  }, [state]);
  return (
    <>
      <PageHeader title="Student Records" description="Search a student’s identity record by JAMB Registration Number." />
      <Card className="max-w-3xl px-5 py-5">
        <form onSubmit={(e) => { e.preventDefault(); if (r) navigate(`/jamb/students/${r.reg}`); }} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-slate-700">JAMB Registration Number
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 20250190101CN" className="mt-1.5 h-11 font-mono uppercase" autoComplete="off" />
          </label>
          <Button type="submit" size="lg" disabled={!r} icon={<Search className="h-4 w-4" />}>Open record</Button>
        </form>
        {reg && !r && <p className="mt-3 text-sm text-slate-600" role="status">No JAMB record has this registration number.</p>}
        {r && (
          <Link to={`/jamb/students/${r.reg}`} className="mt-4 flex items-center gap-4 rounded-xl p-3 ring-1 ring-slate-200 hover:bg-slate-50" role="status">
            <Portrait record={r} className="h-16 w-14" />
            <span className="min-w-0 text-sm"><span className="block font-semibold text-slate-900">{r.firstName} {r.middleName} {r.lastName}</span><span className="block text-slate-600">{institutionByCode(r.institution)?.name} · {r.session} · {r.department}</span></span>
          </Link>
        )}
      </Card>
      <Section title="Recently verified students">
        <ul className="divide-y divide-slate-100">
          {recent.map((a) => { const x = recordOf(a.reg!, state)!; return (
            <li key={a.ref}><Link to={`/jamb/students/${x.reg}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50"><span><span className="font-medium text-slate-900">{x.firstName} {x.lastName}</span> <span className="font-mono text-xs text-slate-500">{x.reg}</span></span><span className="text-slate-500">{institutionByCode(x.institution)?.shortName} · {dateTime(a.at)}</span></Link></li>
          ); })}
        </ul>
      </Section>
    </>
  );
}

export function JambStudentPage() {
  const { reg = '' } = useParams();
  const state = useJambState();
  const r = recordOf(reg, state);
  if (!r) return <NotFound what="Student" back="/jamb/students" />;
  const inst = institutionByCode(r.institution)!;
  const entries = auditLog(state).filter((a) => a.reg === r.reg);
  return (
    <>
      <PageHeader title="" breadcrumbs={[{ label: 'Student Records', to: '/jamb/students' }, { label: inst.shortName, to: `/jamb/institutions/${inst.code}` }, { label: `${r.firstName} ${r.lastName}` }]} />
      <StudentJourney record={r} exceptionPath={(id) => `/jamb/exceptions/${id}`}
        actions={r.clearance === 'cleared' ? <ButtonLink to={`/jamb/certificate/${r.reg}`}>View clearance certificate</ButtonLink> : undefined}
        showAudit={(
          <Section title="Audit history">
            {entries.length === 0 ? <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No platform actions recorded for this student" /> : (
              <DataTable rows={entries} rowKey={(a) => a.id} columns={[
                { key: 't', header: 'Date and time', cell: (a) => <span className="tabular-nums text-slate-600">{dateTime(a.at)}</span> },
                { key: 'u', header: 'User', cell: (a) => <span>{a.user}<span className="block text-xs text-slate-500">{a.role}, {a.organisation}</span></span> },
                { key: 'a', header: 'Activity', cell: (a) => a.action },
                { key: 'o', header: 'Outcome', cell: (a) => a.outcome ?? '—' },
                { key: 'r', header: 'Reference', cell: (a) => <span className="font-mono text-xs">{a.reference ?? '—'}</span> },
              ]} />
            )}
          </Section>
        )} />
    </>
  );
}

/* ---------------- Users & Access ---------------- */

export function UsersPage() {
  const state = useJambState();
  const officer = useOfficer();
  const toast = useToast();
  const [q, setQ] = useQueryState('q');
  const [type, setType] = useQueryState('type', 'all');
  const [status, setStatus] = useQueryState('status', 'all');
  const [page, setPage] = usePageParam();
  const [inviting, setInviting] = useState(false);
  const [roleFor, setRoleFor] = useState<PlatformUser | null>(null);
  const [disabling, setDisabling] = useState<PlatformUser | null>(null);
  const users = usersOf(state);
  const query = q.trim().toLowerCase();
  const orgRank = (u: PlatformUser) => (u.organisation === 'JAMB' ? 0 : u.organisation === 'NYSC' ? 1 : 2);
  const kindOf = (u: PlatformUser) => (u.organisation === 'JAMB' ? 'jamb' : u.organisation === 'NYSC' ? 'nysc' : 'university');
  const rows = users.filter((u) => (type === 'all' || kindOf(u) === type) && (status === 'all' || u.status === status) && (!query || `${u.name} ${u.email} ${organisationName(u.organisation)}`.toLowerCase().includes(query)))
    .sort((a, b) => (a.status === 'invited' ? -1 : 0) - (b.status === 'invited' ? -1 : 0) || orgRank(a) - orgRank(b) || organisationName(a.organisation).localeCompare(organisationName(b.organisation)) || a.name.localeCompare(b.name));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, PAGE);
  const act = (x: { ok: boolean; error?: string }, title: string) => toast(x.ok ? { tone: 'success', title } : { tone: 'error', title: 'Nothing was changed', description: (x as { error: string }).error });
  return (
    <>
      <PageHeader title="Users & Access" description="People in participating organisations who can use the platform, and what they can access."
        actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviting(true)}>Invite user</Button>} />
      <section aria-label="Users summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="JAMB users" value={users.filter((u) => kindOf(u) === 'jamb').length} />
        <StatCard label="University officers" value={users.filter((u) => kindOf(u) === 'university').length} />
        <StatCard label="NYSC officers" value={users.filter((u) => kindOf(u) === 'nysc').length} />
        <StatCard label="Disabled" value={users.filter((u) => u.status === 'disabled').length} />
      </section>
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Name, email or organisation" className="sm:w-72" label="Search users" />
          <FilterSelect label="Organisation" value={type} onChange={setType} options={[{ value: 'all', label: 'All organisations' }, { value: 'jamb', label: 'JAMB' }, { value: 'university', label: 'Universities' }, { value: 'nysc', label: 'NYSC' }]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'invited', label: 'Invited' }, { value: 'disabled', label: 'Disabled' }]} />
        </div>
        <DataTable rows={pageRows} rowKey={(u) => u.id} empty={<EmptyState title="No users match" />}
          columns={[
            { key: 'n', header: 'User', className: '!whitespace-normal min-w-[12rem]', cell: (u) => <span><span className="block font-medium text-slate-900">{u.name}</span><span className="text-xs text-slate-500">{u.email}</span></span> },
            { key: 'o', header: 'Organisation', className: '!whitespace-normal', cell: (u) => <span className="text-slate-600">{organisationName(u.organisation)}</span> },
            { key: 'r', header: 'Role', cell: (u) => USER_ROLE_LABEL[u.role] },
            { key: 's', header: 'Status', cell: (u) => <Badge tone={u.status === 'active' ? 'success' : u.status === 'invited' ? 'info' : 'neutral'} dot>{u.status === 'active' ? 'Active' : u.status === 'invited' ? 'Invited' : 'Disabled'}</Badge> },
            { key: 'l', header: 'Last active', cell: (u) => <span className="text-slate-600">{u.lastActiveAt ? formatDate(u.lastActiveAt) : '—'}</span> },
            { key: 'm', header: <span className="sr-only">Actions</span>, cell: (u) => u.email === officer.email ? <span className="text-xs text-slate-400">You</span> : (
              <OverflowMenu label={`Actions for ${u.name}`} items={[
                { key: 'role', label: 'Change role', icon: <UserCog className="h-4 w-4" />, onSelect: () => setRoleFor(u) },
                u.status === 'disabled'
                  ? { key: 'enable', label: 'Enable access', icon: <CheckCircle2 className="h-4 w-4" />, onSelect: () => act(setUserStatus(officer, u.id, 'active'), `Access enabled for ${u.name}`) }
                  : { key: 'disable', label: 'Disable access', tone: 'danger', icon: <Ban className="h-4 w-4" />, onSelect: () => setDisabling(u) },
              ]} />
            ) },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={PAGE} onPage={setPage} />
      </Card>
      {inviting && <InviteDrawer onClose={() => setInviting(false)} />}
      {roleFor && <RoleDialog user={roleFor} onClose={() => setRoleFor(null)} />}
      <ConfirmDialog open={!!disabling} tone="danger" title={`Disable ${disabling?.name}’s access?`} confirmLabel="Disable access"
        description="They’ll be signed out of the platform and can’t sign in until access is enabled again. Their recorded activity is kept."
        onCancel={() => setDisabling(null)} onConfirm={() => { act(setUserStatus(officer, disabling!.id, 'disabled'), `Access disabled for ${disabling!.name}`); setDisabling(null); }} />
    </>
  );
}

function InviteDrawer({ onClose }: { onClose: () => void }) {
  const officer = useOfficer();
  const toast = useToast();
  const [kind, setKind] = useState<'university' | 'nysc' | 'jamb'>('university');
  const [inst, setInst] = useState(INSTITUTIONS[0].code);
  const organisation = kind === 'university' ? inst : kind === 'nysc' ? 'NYSC' : 'JAMB';
  const [role, setRole] = useState<UserRole>('clearance-officer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const roles = rolesFor(organisation);
  const effectiveRole = roles.includes(role) ? role : roles[0];
  const submit = () => {
    const r = inviteUser(officer, { name, email, organisation, role: effectiveRole });
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: 'success', title: 'Invitation sent', description: `${r.value.name} · ${organisationName(organisation)}` });
    onClose();
  };
  return (
    <Drawer open onClose={onClose} title="Invite user" description="Grant access to a participating organisation’s officer."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={<Mail className="h-4 w-4" />} onClick={submit}>Send invitation</Button></div>}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <Field label="Full name" required>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email address" required>{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Organisation type">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="university">University</option><option value="nysc">NYSC</option><option value="jamb">JAMB</option></Select>}</Field>
        {kind === 'university' && <Field label="Institution">{(p) => <Select {...p} value={inst} onChange={(e) => setInst(e.target.value)}>{INSTITUTIONS.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}</Select>}</Field>}
        <Field label="Role">{(p) => <Select {...p} value={effectiveRole} onChange={(e) => setRole(e.target.value as UserRole)}>{roles.map((r) => <option key={r} value={r}>{USER_ROLE_LABEL[r]}</option>)}</Select>}</Field>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-inset ring-slate-200"><span className="font-medium text-slate-900">Access: </span>{ROLE_ACCESS[effectiveRole]}</p>
      </div>
    </Drawer>
  );
}

function RoleDialog({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const officer = useOfficer();
  const toast = useToast();
  const [role, setRole] = useState<UserRole>(user.role);
  const save = () => {
    const r = setUserRole(officer, user.id, role);
    toast(r.ok ? { tone: 'success', title: 'Role updated', description: `${user.name}: ${USER_ROLE_LABEL[role]}` } : { tone: 'error', title: 'Nothing was changed', description: r.error });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Change ${user.name}’s role`} description={organisationName(user.organisation)} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={role === user.role}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Role">{(p) => <Select {...p} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>{rolesFor(user.organisation).map((r) => <option key={r} value={r}>{USER_ROLE_LABEL[r]}</option>)}</Select>}</Field>
        <p className="text-sm text-slate-600">{ROLE_ACCESS[role]}</p>
      </div>
    </Modal>
  );
}

/* ---------------- Audit logs ---------------- */

export function AuditPage() {
  const state = useJambState();
  const [q, setQ] = useQueryState('q');
  const [org, setOrg] = useQueryState('organisation', 'all');
  const [page, setPage] = usePageParam();
  const all = useMemo(() => auditLog(state), [state]);
  const orgs = [...new Set(all.map((a) => a.organisation))].sort();
  const query = q.trim().toLowerCase();
  const rows = all.filter((a) => (org === 'all' || a.organisation === org) && (!query || [a.user, a.action, a.reg, a.student, a.reference, a.outcome].join(' ').toLowerCase().includes(query)));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, PAGE);
  return (
    <>
      <PageHeader title="Audit Logs" description="Who did what, for which student, when, and with what outcome." />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="User, action, student or reference" className="sm:w-80" label="Search audit logs" />
          <div className="min-w-0 max-w-full [&_select]:w-full [&_select]:max-w-full"><FilterSelect label="Organisation" value={org} onChange={setOrg} options={[{ value: 'all', label: 'All organisations' }, ...orgs.map((o) => ({ value: o, label: o }))]} /></div>
        </div>
        <DataTable rows={pageRows} rowKey={(a) => a.id} empty={<EmptyState icon={<ScrollText className="h-5 w-5" />} title="No entries match" />}
          columns={[
            { key: 't', header: 'Date and time', cell: (a) => <span className="tabular-nums text-slate-600">{dateTime(a.at)}</span> },
            { key: 'u', header: 'User', className: '!whitespace-normal min-w-[10rem]', cell: (a) => <span><span className="block font-medium text-slate-900">{a.user}</span><span className="text-xs text-slate-500">{a.role}</span></span> },
            { key: 'o', header: 'Organisation', className: '!whitespace-normal', cell: (a) => <span className="text-slate-600">{a.organisation}</span> },
            { key: 'a', header: 'Activity', className: '!whitespace-normal', cell: (a) => a.action },
            { key: 's', header: 'Student', cell: (a) => a.reg ? <Link to={`/jamb/students/${a.reg}`} className={linkCls}>{a.student ?? a.reg}<span className="block font-mono text-xs font-normal text-slate-500">{a.reg}</span></Link> : '—' },
            { key: 'r', header: 'Outcome', className: '!whitespace-normal', cell: (a) => <span className="text-slate-600">{a.outcome ?? '—'}</span> },
            { key: 'ref', header: 'Reference', cell: (a) => <span className="font-mono text-xs text-slate-600">{a.reference ?? '—'}</span> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={PAGE} onPage={setPage} />
      </Card>
    </>
  );
}

/* ---------------- Settings ---------------- */

export function SettingsPage() {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <PageHeader title="Settings" />
      <Card className="max-w-3xl px-5 py-5">
        <h2 className="text-base font-semibold text-slate-900">Platform</h2>
        <div className="mt-3"><DescriptionList items={[
          { label: 'Platform', value: 'JAMB Identity Verification Platform' },
          { label: 'Operated by', value: 'Joint Admissions and Matriculation Board' },
          { label: 'Admission sessions', value: SESSIONS.join(', ') },
          { label: 'Participating institutions', value: String(INSTITUTIONS.length) },
          { label: 'Event categories', value: 'Admission Clearance, NYSC Identity Verification' },
        ]} /></div>
      </Card>
      <Card className="max-w-3xl px-5 py-5">
        <h2 className="text-base font-semibold text-slate-900">Demonstration data</h2>
        <p className="mt-1 text-sm text-slate-500">Restore the original student records, exceptions, users and audit trail. Verifications, clearances and access changes made since are removed.</p>
        <Button className="mt-4" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm(true)}>Reset demonstration data</Button>
      </Card>
      <ConfirmDialog open={confirm} tone="danger" title="Reset demonstration data?" description="All three workspaces return to their original records." confirmLabel="Reset"
        onCancel={() => setConfirm(false)} onConfirm={() => { resetJambDemo(); setConfirm(false); toast({ tone: 'success', title: 'Demonstration data reset' }); }} />
    </>
  );
}

export { sessionSlug };
