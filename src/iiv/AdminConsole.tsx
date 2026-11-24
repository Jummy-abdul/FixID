import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Building2, CalendarCheck, ClipboardList, Database, Download, Fingerprint, Home, ImagePlus, Mail, Plus, Send, Upload, UserPlus } from 'lucide-react';
import {
  Badge, Button, ButtonLink, Card, DataTable, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Select, StatCard, Textarea, usePageSlice, useToast,
} from '@/components/ui';
import type { NavGroup } from '@/layout/navigation';
import { usePageParam, useQueryState } from '@/hooks/useQueryState';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { ConsoleLayout, OrgMark, fmt } from '@/jamb/ui';
import { dateTime } from '@/jamb/format';
import { PHOTO_LIBRARY, fingerprintImage, personOf, readPhoto } from './media';
import {
  IMPORT_COLUMNS, INSTITUTION_TYPES, SESSIONS, addInstitution, closeEvent, eventById, eventIncludes, importRecords, institutionByCode, inviteExisting, publishEvent,
  recordByReg, recordComplete, saveEvent, saveRecord, setInstitutionStatus, useIiv, verificationByRef,
  type EventInput, type InstitutionInput, type InstitutionType, type RecordInput, type Session, type VerificationEvent,
} from './store';
import { EventStatusBadge, EvidenceImage, FingerprintScanner, InstitutionStatusBadge, MethodLabel, OutcomeBadge, ResultPill, VerificationEvidence, useIivUser } from './ui';

const NAV: NavGroup[] = [
  { label: null, items: [{ label: 'Dashboard', to: '/admin', end: true, icon: Home, description: 'Verification overview' }] },
  {
    label: 'Institutional verification',
    items: [
      { label: 'Institutions', to: '/admin/institutions', icon: Building2, description: 'Participating institutions' },
      { label: 'Verification Events', to: '/admin/events', icon: CalendarCheck, description: 'Admission verification events' },
      { label: 'Verification Records', to: '/admin/records', icon: ClipboardList, description: 'Verifications submitted by institutions' },
    ],
  },
  { label: 'Data administration', items: [{ label: 'Identity Record Enrollment', to: '/admin/identity-records', icon: Database, description: 'JAMB identity reference records' }] },
];

/** The JAMB administrator's portal for institutional identity verification. */
export function AdminConsole() {
  const me = useIivUser();
  return (
    <ConsoleLayout nav={NAV} organisation={{ name: 'Joint Admissions and Matriculation Board', role: me.title }} mark={<OrgMark letters="JAMB" tone="green" />} hideEnvironmentLabel user={me}>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="institutions" element={<InstitutionsPage />} />
        <Route path="institutions/:code" element={<InstitutionPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/new" element={<EventForm />} />
        <Route path="events/:id" element={<EventPage />} />
        <Route path="records" element={<RecordsPage />} />
        <Route path="records/:ref" element={<RecordPage />} />
        <Route path="identity-records" element={<IdentityRecordsPage />} />
        <Route path="identity-records/new" element={<IdentityRecordForm />} />
        <Route path="identity-records/:reg" element={<IdentityRecordForm />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </ConsoleLayout>
  );
}

const Rows = ({ rows, cols = 'sm:grid-cols-2 lg:grid-cols-3' }: { rows: [string, ReactNode][]; cols?: string }) => (
  <dl className={cn('grid gap-x-6 gap-y-3 text-sm', cols)}>{rows.map(([k, v]) => <div key={k}><dt className="text-slate-500">{k}</dt><dd className="mt-0.5 font-medium text-slate-900">{v}</dd></div>)}</dl>
);
const NotFoundCard = ({ what, back, to }: { what: string; back: string; to: string }) => <EmptyState title={`${what} not found`} action={<ButtonLink to={to} variant="secondary">{back}</ButtonLink>} />;

/* ---------------- dashboard ---------------- */

function Dashboard() {
  const me = useIivUser();
  const state = useIiv();
  const v = state.verifications;
  const ok = v.filter((x) => x.outcome === 'verified').length;
  const byInst = state.institutions.map((i) => ({ i, n: v.filter((x) => x.institution === i.code).length, ok: v.filter((x) => x.institution === i.code && x.outcome === 'verified').length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...byInst.map((x) => x.n));
  return (
    <>
      <PageHeader title={`Welcome, ${me.name.split(' ')[0]}`} description="Institutional identity verification overview"
        actions={<ButtonLink to="/admin/events/new" variant="primary" icon={<Plus className="h-4 w-4" />}>Create verification event</ButtonLink>} />
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Registered institutions" value={fmt(state.institutions.length)} to="/admin/institutions" />
        <StatCard label="Active institutions" value={fmt(state.institutions.filter((i) => i.status === 'active').length)} tone="emerald" to="/admin/institutions?status=active" />
        <StatCard label="Total verifications" value={fmt(v.length)} to="/admin/records" />
        <StatCard label="Successful verifications" value={fmt(ok)} tone="emerald" to="/admin/records?outcome=verified" />
        <StatCard label="Failed verifications" value={fmt(v.length - ok)} tone="amber" to="/admin/records?outcome=discrepancy" />
        <StatCard label="Published events" value={fmt(state.events.filter((e) => e.status === 'published').length)} tone="violet" to="/admin/events" />
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h2 className="font-semibold text-slate-900">Recent verification activity</h2><Link to="/admin/records" className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</Link></div>
          {v.length ? (
            <ul className="divide-y divide-slate-100" aria-label="Recent verification activity">
              {v.slice(0, 8).map((x) => (
                <li key={x.ref}><Link to={`/admin/records/${x.ref}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50">
                  <span><span className="font-medium text-slate-900">{x.candidate.fullName}</span> <span className="font-mono text-xs text-slate-500">{x.reg}</span><span className="block text-xs text-slate-500">{x.institutionName} · {dateTime(x.at)} · <MethodLabel method={x.method} /></span></span>
                  <OutcomeBadge outcome={x.outcome} />
                </Link></li>
              ))}
            </ul>
          ) : <EmptyState title="No verifications yet" description="Verifications submitted by institutions appear here." />}
        </Card>
        <Card className="px-5 py-4" aria-label="Verification activity by institution">
          <h2 className="font-semibold text-slate-900">Activity by institution</h2>
          {byInst.length ? (
            <ul className="mt-3 space-y-3">
              {byInst.map(({ i, n, ok: good }) => (
                <li key={i.code} className="text-sm">
                  <div className="flex justify-between gap-2"><Link to={`/admin/institutions/${i.code}`} className="font-medium text-slate-800 hover:text-brand-700">{i.name}</Link><span className="tabular-nums text-slate-600">{n}</span></div>
                  <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true" style={{ width: `${(n / max) * 100}%` }}>
                    <span className="bg-emerald-500" style={{ width: `${(good / n) * 100}%` }} /><span className="bg-red-400" style={{ width: `${((n - good) / n) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-slate-500">No activity yet.</p>}
          <p className="mt-4 flex gap-4 text-xs text-slate-500"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Verified</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" />Discrepancy</span></p>
        </Card>
      </div>
    </>
  );
}

/* ---------------- institutions ---------------- */

function InstitutionsPage() {
  const state = useIiv();
  const [q, setQ] = useQueryState('q');
  const [status, setStatus] = useQueryState('status', 'all');
  const [dialog, setDialog] = useState<null | 'add' | 'invite'>(null);
  const query = q.trim().toLowerCase();
  const rows = state.institutions.filter((i) => (status === 'all' || i.status === status) && (!query || `${i.name} ${i.code} ${i.contactPerson} ${i.email}`.toLowerCase().includes(query)));
  return (
    <>
      <PageHeader title="Institutions" description="Institutions participating in admission identity verification."
        actions={<><Button variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => setDialog('invite')}>Invite institution</Button><Button icon={<Plus className="h-4 w-4" />} onClick={() => setDialog('add')}>Add institution</Button></>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Name, code or contact" className="sm:w-80" label="Search institutions" />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'invited', label: 'Invitation sent' }, { value: 'inactive', label: 'Inactive' }]} />
        </div>
        <DataTable rows={rows} rowKey={(i) => i.code} rowHref={(i) => `/admin/institutions/${i.code}`} empty={<EmptyState title="No institutions match" />}
          columns={[
            { key: 'n', header: 'Institution', className: '!whitespace-normal min-w-[12rem]', cell: (i) => <Link to={`/admin/institutions/${i.code}`} className="font-medium text-slate-900 hover:text-brand-700">{i.name}</Link> },
            { key: 'c', header: 'Code', cell: (i) => <span className="font-mono text-xs">{i.code}</span> },
            { key: 't', header: 'Type', cell: (i) => <span className="text-slate-600">{i.type}</span> },
            { key: 'p', header: 'Contact person', className: '!whitespace-normal', cell: (i) => <span className="text-slate-600">{i.contactPerson}<span className="block text-xs text-slate-400">{i.email}</span></span> },
            { key: 'o', header: 'Clearance officers', cell: (i) => <span className="tabular-nums">{i.officers.length}</span> },
            { key: 'v', header: 'Verifications', cell: (i) => <span className="tabular-nums">{state.verifications.filter((v) => v.institution === i.code).length}</span> },
            { key: 's', header: 'Status', cell: (i) => <InstitutionStatusBadge status={i.status} /> },
          ]} />
      </Card>
      {dialog && <InstitutionDialog mode={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function InstitutionDialog({ mode, onClose }: { mode: 'add' | 'invite'; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState<InstitutionInput>({ name: '', code: '', type: 'Federal University', email: '', contactPerson: '' });
  const [error, setError] = useState('');
  const set = (k: keyof InstitutionInput) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setError(''); };
  const submit = () => {
    const r = addInstitution(f, mode);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: 'success', title: mode === 'add' ? 'Institution added' : 'Invitation sent', description: mode === 'add' ? r.value.name : `${r.value.name} · ${r.value.invitationRef}` });
    onClose();
    navigate(`/admin/institutions/${r.value.code}`);
  };
  return (
    <Modal open onClose={onClose} title={mode === 'add' ? 'Add institution' : 'Invite institution'} description={mode === 'add' ? 'The institution is added as an active participant.' : 'JAMB sends an invitation to the contact email. The institution participates once it accepts.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={mode === 'add' ? <Plus className="h-4 w-4" /> : <Send className="h-4 w-4" />} onClick={submit}>{mode === 'add' ? 'Add institution' : 'Send invitation'}</Button></>}>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Institution name" required>{(p) => <Input {...p} value={f.name} onChange={set('name')} />}</Field></div>
        <Field label="Institution type" required>{(p) => <Select {...p} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as InstitutionType })}>{INSTITUTION_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
        <Field label="Institution code" required hint="2 to 10 letters or digits">{(p) => <Input {...p} value={f.code} className="uppercase" onChange={set('code')} />}</Field>
        <Field label="Contact person" required>{(p) => <Input {...p} value={f.contactPerson} onChange={set('contactPerson')} />}</Field>
        <Field label="Contact email" required>{(p) => <Input {...p} type="email" value={f.email} onChange={set('email')} />}</Field>
      </div>
    </Modal>
  );
}

function InstitutionPage() {
  const { code = '' } = useParams();
  const state = useIiv();
  const toast = useToast();
  const i = institutionByCode(code, state);
  if (!i) return <NotFoundCard what="Institution" back="Back to Institutions" to="/admin/institutions" />;
  const activity = state.verifications.filter((v) => v.institution === i.code);
  const run = (r: { ok: boolean; error?: string }, title: string) => toast(r.ok ? { tone: 'success', title } : { tone: 'error', title: 'Not changed', description: (r as { error: string }).error });
  const events = state.events.filter((e) => e.status !== 'draft' && eventIncludes(e, i.code));
  return (
    <>
      <PageHeader title={i.name} breadcrumbs={[{ label: 'Institutions', to: '/admin/institutions' }, { label: i.name }]} meta={<><InstitutionStatusBadge status={i.status} /><span className="font-mono text-xs text-slate-500">{i.code}</span></>}
        actions={<>
          {i.status === 'invited' && <Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={() => run(inviteExisting(i.code), 'Invitation resent')}>Resend invitation</Button>}
          {i.status === 'inactive' && <Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={() => run(inviteExisting(i.code), 'Invitation sent')}>Invite to participate</Button>}
          {i.status !== 'active' && <Button onClick={() => run(setInstitutionStatus(i.code, 'active'), 'Institution activated')}>Activate</Button>}
          {i.status === 'active' && <Button variant="secondary" onClick={() => run(setInstitutionStatus(i.code, 'inactive'), 'Institution deactivated')}>Deactivate</Button>}
        </>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card className="px-5 py-5"><h2 className="mb-3 font-semibold text-slate-900">Institution details</h2>
            <Rows rows={[['Institution name', i.name], ['Institution type', i.type], ['Institution code', <span className="font-mono">{i.code}</span>], ['Contact person', i.contactPerson], ['Contact email', i.email], ['Status', <InstitutionStatusBadge status={i.status} />],
              ['Added', dateTime(i.createdAt)], ...(i.invitedAt ? [['Invitation', `${i.invitationRef} · ${dateTime(i.invitedAt)}`] as [string, ReactNode]] : []), ...(i.activatedAt ? [['Activated', dateTime(i.activatedAt)] as [string, ReactNode]] : [])]} />
          </Card>
          <Card>
            <h2 className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-900">Verification activity</h2>
            <DataTable rows={activity} rowKey={(v) => v.ref} rowHref={(v) => `/admin/records/${v.ref}`} empty={<EmptyState title="No verifications yet" />}
              columns={[
                { key: 'c', header: 'Candidate', className: '!whitespace-normal', cell: (v) => <span className="font-medium text-slate-900">{v.candidate.fullName}<span className="block font-mono text-xs font-normal text-slate-500">{v.reg}</span></span> },
                { key: 'e', header: 'Event', cell: (v) => <span className="text-slate-600">{v.eventName}</span> },
                { key: 'd', header: 'Date', cell: (v) => <span className="tabular-nums text-slate-600">{dateTime(v.at)}</span> },
                { key: 'o', header: 'Outcome', cell: (v) => <OutcomeBadge outcome={v.outcome} /> },
              ]} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="px-5 py-4" aria-label="Clearance officers">
            <h2 className="font-semibold text-slate-900">Registered clearance officers</h2>
            {i.officers.length ? <ul className="mt-3 space-y-3 text-sm">{i.officers.map((o) => <li key={o.email}><span className="block font-medium text-slate-900">{o.name}</span><span className="block text-xs text-slate-500">{o.role} · {o.email}</span><span className="text-xs text-slate-400">Since {formatDate(o.addedAt)}</span></li>)}</ul>
              : <p className="mt-2 text-sm text-slate-500">{i.status === 'invited' ? 'Officers are registered once the institution accepts the invitation.' : 'No clearance officers registered.'}</p>}
          </Card>
          <Card className="px-5 py-4"><h2 className="font-semibold text-slate-900">Verification events</h2>
            {events.length ? <ul className="mt-3 space-y-2 text-sm">{events.map((e) => <li key={e.id} className="flex items-center justify-between gap-2"><Link to={`/admin/events/${e.id}`} className="font-medium text-slate-800 hover:text-brand-700">{e.name}</Link><EventStatusBadge status={e.status} /></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">Not included in any event.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

/* ---------------- events ---------------- */

function EventsPage() {
  const state = useIiv();
  const toast = useToast();
  const [status, setStatus] = useQueryState('status', 'all');
  const rows = state.events.filter((e) => status === 'all' || e.status === status);
  const act = (r: { ok: boolean; error?: string }, title: string) => toast(r.ok ? { tone: 'success', title } : { tone: 'error', title: 'Not changed', description: (r as { error: string }).error });
  return (
    <>
      <PageHeader title="Verification Events" description="Admission verification events published to participating institutions." actions={<ButtonLink to="/admin/events/new" icon={<Plus className="h-4 w-4" />}>Create event</ButtonLink>} />
      <Card>
        <div className="border-b border-slate-100 p-4"><FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All events' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'closed', label: 'Closed' }]} /></div>
        <DataTable rows={rows} rowKey={(e) => e.id} rowHref={(e) => `/admin/events/${e.id}`} empty={<EmptyState icon={<CalendarCheck className="h-5 w-5" />} title="No events" />}
          columns={[
            { key: 'n', header: 'Event', className: '!whitespace-normal min-w-[12rem]', cell: (e) => <Link to={`/admin/events/${e.id}`} className="font-medium text-slate-900 hover:text-brand-700">{e.name}</Link> },
            { key: 's', header: 'Admission session', cell: (e) => e.session },
            { key: 'i', header: 'Institutions', cell: (e) => <span className="text-slate-600">{e.institutions === 'all' ? 'All active institutions' : `${e.institutions.length} selected`}</span> },
            { key: 'd', header: 'Period', cell: (e) => <span className="tabular-nums text-slate-600">{formatDate(e.startsAt)} – {formatDate(e.endsAt)}</span> },
            { key: 'v', header: 'Verifications', cell: (e) => <span className="tabular-nums">{state.verifications.filter((v) => v.eventId === e.id).length}</span> },
            { key: 'st', header: 'Status', cell: (e) => <EventStatusBadge status={e.status} /> },
            { key: 'a', header: 'Action', cell: (e) => (
              // The row opens the event; the action stays on this page.
              <span onClick={(x) => x.stopPropagation()}>
                {e.status === 'draft' ? <Button size="sm" variant="secondary" onClick={() => act(publishEvent(e.id), 'Event published')}>Publish</Button> : e.status === 'published' ? <Button size="sm" variant="secondary" onClick={() => act(closeEvent(e.id), 'Event closed')}>Close</Button> : <span className="text-xs text-slate-400">—</span>}
              </span>
            ) },
          ]} />
      </Card>
    </>
  );
}

function EventForm({ existing }: { existing?: VerificationEvent }) {
  const state = useIiv();
  const toast = useToast();
  const navigate = useNavigate();
  const active = state.institutions.filter((i) => i.status === 'active');
  const [f, setF] = useState<EventInput>(existing
    ? { name: existing.name, session: existing.session, institutions: existing.institutions, startsAt: existing.startsAt.slice(0, 10), endsAt: existing.endsAt.slice(0, 10), description: existing.description }
    : { name: '2026/2027 Admission Clearance', session: '2026/2027', institutions: 'all', startsAt: '', endsAt: '', description: '' });
  const [error, setError] = useState('');
  const submit = (publish: boolean) => {
    const r = saveEvent(f, publish, existing?.id);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: 'success', title: publish ? 'Event published' : 'Draft saved', description: r.value.name });
    navigate(`/admin/events/${r.value.id}`);
  };
  const selected = f.institutions === 'all' ? [] : f.institutions;
  return (
    <>
      {!existing && <PageHeader title="Create verification event" breadcrumbs={[{ label: 'Verification Events', to: '/admin/events' }, { label: 'New event' }]} />}
      <Card className="max-w-3xl px-5 py-5" aria-label="Event details">
        {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Event name" required>{(p) => <Input {...p} value={f.name} onChange={(e) => { setF({ ...f, name: e.target.value }); setError(''); }} />}</Field></div>
          <Field label="Admission session" required>{(p) => <Select {...p} value={f.session} onChange={(e) => setF({ ...f, session: e.target.value as Session })}>{SESSIONS.map((s) => <option key={s}>{s}</option>)}</Select>}</Field>
          <Field label="Participating institutions" required>{(p) => <Select {...p} value={f.institutions === 'all' ? 'all' : 'selected'} onChange={(e) => setF({ ...f, institutions: e.target.value === 'all' ? 'all' : [] })}><option value="all">All active institutions</option><option value="selected">Selected institutions</option></Select>}</Field>
          {f.institutions !== 'all' && (
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium text-slate-700">Institutions</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {active.map((i) => (
                  <label key={i.code} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="rounded border-slate-300" checked={selected.includes(i.code)} onChange={(e) => setF({ ...f, institutions: e.target.checked ? [...selected, i.code] : selected.filter((c) => c !== i.code) })} />{i.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field label="Start date" required>{(p) => <Input {...p} type="date" value={f.startsAt} onChange={(e) => { setF({ ...f, startsAt: e.target.value }); setError(''); }} />}</Field>
          <Field label="End date" required>{(p) => <Input {...p} type="date" value={f.endsAt} onChange={(e) => { setF({ ...f, endsAt: e.target.value }); setError(''); }} />}</Field>
          <div className="sm:col-span-2"><Field label="Description">{(p) => <Textarea {...p} rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field></div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button icon={<Send className="h-4 w-4" />} onClick={() => submit(true)}>Publish</Button>
          <Button variant="secondary" onClick={() => submit(false)}>Save as draft</Button>
          <ButtonLink to="/admin/events" variant="ghost">Cancel</ButtonLink>
        </div>
      </Card>
    </>
  );
}

function EventPage() {
  const { id = '' } = useParams();
  const state = useIiv();
  const toast = useToast();
  const e = eventById(id, state);
  if (!e) return <NotFoundCard what="Event" back="Back to Verification Events" to="/admin/events" />;
  const act = (r: { ok: boolean; error?: string }, title: string) => toast(r.ok ? { tone: 'success', title } : { tone: 'error', title: 'Not changed', description: (r as { error: string }).error });
  const v = state.verifications.filter((x) => x.eventId === e.id);
  const insts = e.institutions === 'all' ? state.institutions.filter((i) => i.status === 'active') : e.institutions.map((c) => institutionByCode(c, state)!).filter(Boolean);
  return (
    <>
      <PageHeader title={e.name} breadcrumbs={[{ label: 'Verification Events', to: '/admin/events' }, { label: e.name }]} meta={<EventStatusBadge status={e.status} />}
        actions={e.status === 'draft' ? <Button icon={<Send className="h-4 w-4" />} onClick={() => act(publishEvent(e.id), 'Event published')}>Publish</Button> : e.status === 'published' ? <Button variant="secondary" onClick={() => act(closeEvent(e.id), 'Event closed')}>Close event</Button> : undefined} />
      {e.status === 'draft' ? <EventForm existing={e} /> : (
        <div className="space-y-6">
          <Card className="px-5 py-5"><Rows rows={[['Admission session', e.session], ['Period', `${formatDate(e.startsAt)} – ${formatDate(e.endsAt)}`], ['Status', <EventStatusBadge status={e.status} />], ['Published', e.publishedAt ? dateTime(e.publishedAt) : '—'], ['Created by', e.createdBy], ...(e.closedAt ? [['Closed', dateTime(e.closedAt)] as [string, ReactNode]] : []), ['Description', e.description || '—']]} /></Card>
          <Card className="px-5 py-4"><h2 className="font-semibold text-slate-900">Participating institutions</h2><p className="mt-1 text-sm text-slate-600">{insts.map((i) => i.name).join(', ') || '—'}</p></Card>
          <Card><h2 className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-900">Verifications ({v.length})</h2>
            <DataTable rows={v} rowKey={(x) => x.ref} rowHref={(x) => `/admin/records/${x.ref}`} empty={<EmptyState title="No verifications yet" />}
              columns={[{ key: 'c', header: 'Candidate', cell: (x) => <span className="font-medium text-slate-900">{x.candidate.fullName}</span> }, { key: 'i', header: 'Institution', cell: (x) => x.institutionName }, { key: 'd', header: 'Date', cell: (x) => dateTime(x.at) }, { key: 'o', header: 'Outcome', cell: (x) => <OutcomeBadge outcome={x.outcome} /> }]} />
          </Card>
        </div>
      )}
    </>
  );
}

/* ---------------- verification records ---------------- */

function RecordsPage() {
  const state = useIiv();
  const [q, setQ] = useQueryState('q');
  const [inst, setInst] = useQueryState('institution', 'all');
  const [event, setEvent] = useQueryState('event', 'all');
  const [outcome, setOutcome] = useQueryState('outcome', 'all');
  const [method, setMethod] = useQueryState('method', 'all');
  const [page, setPage] = usePageParam();
  const query = q.trim().toLowerCase();
  const rows = state.verifications.filter((v) => (inst === 'all' || v.institution === inst) && (event === 'all' || v.eventId === event) && (outcome === 'all' || v.outcome === outcome) && (method === 'all' || v.method === method)
    && (!query || `${v.candidate.fullName} ${v.reg} ${v.ref}`.toLowerCase().includes(query)));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 20);
  return (
    <>
      <PageHeader title="Verification Records" description="Every identity verification submitted by participating institutions." />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Candidate, registration number or reference" className="sm:w-80" label="Search verification records" />
          <FilterSelect label="Institution" value={inst} onChange={setInst} options={[{ value: 'all', label: 'All institutions' }, ...state.institutions.map((i) => ({ value: i.code, label: i.name }))]} />
          <FilterSelect label="Event" value={event} onChange={setEvent} options={[{ value: 'all', label: 'All events' }, ...state.events.filter((e) => e.status !== 'draft').map((e) => ({ value: e.id, label: e.name }))]} />
          <FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={[{ value: 'all', label: 'All outcomes' }, { value: 'verified', label: 'Identity Verified' }, { value: 'discrepancy', label: 'Identity Discrepancy' }]} />
          <FilterSelect label="Method" value={method} onChange={setMethod} options={[{ value: 'all', label: 'All methods' }, { value: 'face', label: 'Face verification' }, { value: 'fingerprint', label: 'Fingerprint verification' }]} />
        </div>
        <DataTable rows={pageRows} rowKey={(v) => v.ref} rowHref={(v) => `/admin/records/${v.ref}`} empty={<EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No verification records match" />}
          columns={[
            { key: 'c', header: 'Candidate', className: '!whitespace-normal min-w-[10rem]', cell: (v) => <Link to={`/admin/records/${v.ref}`} className="font-medium text-slate-900 hover:text-brand-700">{v.candidate.fullName}</Link> },
            { key: 'r', header: 'JAMB registration number', cell: (v) => <span className="font-mono text-xs">{v.reg}</span> },
            { key: 'i', header: 'Institution', className: '!whitespace-normal', cell: (v) => <span className="text-slate-600">{v.institutionName}</span> },
            { key: 'e', header: 'Verification event', className: '!whitespace-normal', cell: (v) => <span className="text-slate-600">{v.eventName}</span> },
            { key: 's', header: 'Admission session', cell: (v) => v.session },
            { key: 'd', header: 'Verification date', cell: (v) => <span className="tabular-nums text-slate-600">{dateTime(v.at)}</span> },
            { key: 'm', header: 'Method', cell: (v) => <MethodLabel method={v.method} /> },
            { key: 'n', header: 'NIN comparison', cell: (v) => <ResultPill result={v.ninResult} /> },
            { key: 'j', header: 'JAMB comparison', cell: (v) => <ResultPill result={v.jambResult} /> },
            { key: 'o', header: 'Overall outcome', cell: (v) => <OutcomeBadge outcome={v.outcome} /> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={20} onPage={setPage} />
      </Card>
    </>
  );
}

function RecordPage() {
  const { ref = '' } = useParams();
  const state = useIiv();
  const v = verificationByRef(ref, state);
  if (!v) return <NotFoundCard what="Verification record" back="Back to Verification Records" to="/admin/records" />;
  return (
    <>
      <PageHeader title={v.candidate.fullName} breadcrumbs={[{ label: 'Verification Records', to: '/admin/records' }, { label: v.ref }]} meta={<><OutcomeBadge outcome={v.outcome} /><span className="font-mono text-xs text-slate-500">{v.ref}</span></>} />
      <VerificationEvidence v={v} />
    </>
  );
}

/* ---------------- identity record enrollment ---------------- */

function IdentityRecordsPage() {
  const state = useIiv();
  const me = useIivUser();
  const toast = useToast();
  const [q, setQ] = useQueryState('q');
  const [inst, setInst] = useQueryState('institution', 'all');
  const [page, setPage] = usePageParam();
  const [importing, setImporting] = useState(false);
  const query = q.trim().toLowerCase();
  const rows = state.records.filter((r) => (inst === 'all' || r.institution === inst) && (!query || `${r.fullName} ${r.reg}`.toLowerCase().includes(query)));
  const { pageRows, pageCount, current } = usePageSlice(rows, page, 20);
  return (
    <>
      <PageHeader title="Identity Record Enrollment" description="JAMB identity reference records that institutions verify candidates against."
        actions={<><Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>Batch import</Button><ButtonLink to="/admin/identity-records/new" icon={<UserPlus className="h-4 w-4" />}>Enrol candidate</ButtonLink></>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end">
          <SearchInput value={q} onChange={setQ} placeholder="Candidate name or registration number" className="sm:w-80" label="Search identity records" />
          <FilterSelect label="Institution" value={inst} onChange={setInst} options={[{ value: 'all', label: 'All institutions' }, ...state.institutions.map((i) => ({ value: i.code, label: i.name }))]} />
        </div>
        <DataTable rows={pageRows} rowKey={(r) => r.reg} rowHref={(r) => `/admin/identity-records/${r.reg}`} empty={<EmptyState icon={<Database className="h-5 w-5" />} title="No identity records match" />}
          columns={[
            { key: 'p', header: 'Photograph', cell: (r) => r.jambPhoto ? <img src={r.jambPhoto} alt="" className="h-12 w-10 rounded object-cover ring-1 ring-slate-200" /> : <span className="flex h-12 w-10 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400">—</span> },
            { key: 'n', header: 'Candidate', className: '!whitespace-normal min-w-[10rem]', cell: (r) => <Link to={`/admin/identity-records/${r.reg}`} className="font-medium text-slate-900 hover:text-brand-700">{r.fullName}<span className="block font-mono text-xs font-normal text-slate-500">{r.reg}</span></Link> },
            { key: 'i', header: 'Institution', className: '!whitespace-normal', cell: (r) => <span className="text-slate-600">{institutionByCode(r.institution, state)?.name}</span> },
            { key: 'c', header: 'Course of study', className: '!whitespace-normal', cell: (r) => <span className="text-slate-600">{r.course}</span> },
            { key: 's', header: 'Session', cell: (r) => r.session },
            { key: 'f', header: 'References', cell: (r) => <span className="flex flex-wrap gap-1">{recordComplete(r) ? <Badge tone="success">JAMB and NIN photographs</Badge> : <Badge tone="warning">Photographs pending</Badge>}{r.fingerprint && <Badge tone="info">Fingerprint</Badge>}</span> },
            { key: 'u', header: 'Last updated', cell: (r) => <span className="tabular-nums text-slate-600">{dateTime(r.updatedAt)}</span> },
          ]} />
        <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={20} onPage={setPage} />
      </Card>
      {importing && <ImportDialog by={me.name} onClose={() => setImporting(false)} onDone={(n) => toast({ tone: 'success', title: 'Import complete', description: n })} />}
    </>
  );
}

function ImportDialog({ by, onClose, onDone }: { by: string; onClose: () => void; onDone: (summary: string) => void }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const template = `${IMPORT_COLUMNS.join(',')}\n20260110503OB,Oluwaseun Bayo Ogundipe,2007-03-14,Male,Oyo,UI,B.Sc. Economics,2026/2027,5521\n`;
  const run = () => {
    const r = importRecords(text, by);
    setErrors(r.errors);
    if (r.added || r.updated) onDone(`${r.added} added, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} rows not imported` : ''}`);
    if (!r.errors.length) onClose();
  };
  return (
    <Modal open onClose={onClose} title="Batch import identity records" description="Import candidate biodata from a CSV file. Attach photographs and fingerprint references to each record afterwards." size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={<Upload className="h-4 w-4" />} onClick={run} disabled={!text.trim()}>Import records</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => file.current?.click()}>Choose CSV file</Button>
          <a className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50" download="identity-records-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}><Download className="h-4 w-4" aria-hidden="true" />Download template</a>
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label="CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        </div>
        <Field label="CSV content" hint={`Columns: ${IMPORT_COLUMNS.join(', ')}`}>{(p) => <Textarea {...p} rows={7} value={text} className="font-mono text-xs" onChange={(e) => setText(e.target.value)} />}</Field>
        {errors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-lg bg-red-50 py-2 pl-7 pr-3 text-sm text-red-800">{errors.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul>}
      </div>
    </Modal>
  );
}

/** A reference photograph: uploaded, or chosen from the photo library. */
function PhotoField({ label, value, onChange }: { label: string; value?: string; onChange: (v: string | undefined) => void }) {
  const [library, setLibrary] = useState(false);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="mt-2 flex items-start gap-4">
        <div className="w-28 shrink-0">{value ? <img src={value} alt={label} className="aspect-[4/5] w-full rounded-lg object-cover ring-1 ring-slate-200" /> : <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 text-center text-xs text-slate-400">No photograph</div>}</div>
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => file.current?.click()}>Upload photograph</Button>
          <Button size="sm" variant="secondary" icon={<ImagePlus className="h-4 w-4" />} onClick={() => setLibrary(true)}>Choose from photo library</Button>
          {value && <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>Remove</Button>}
          <input ref={file} type="file" accept="image/*" className="hidden" aria-label={`Upload ${label}`} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setError(''); onChange(await readPhoto(f)); } catch (x) { setError((x as Error).message); } e.target.value = ''; }} />
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </div>
      </div>
      {library && (
        <Modal open onClose={() => setLibrary(false)} title="Photo library" description={`Choose the ${label.toLowerCase()}.`} size="lg" footer={<Button variant="secondary" onClick={() => setLibrary(false)}>Close</Button>}>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5" aria-label="Photo library">
            {PHOTO_LIBRARY.map((p) => (
              <li key={p.id}><button type="button" onClick={() => { onChange(p.url); setLibrary(false); }} aria-label={`Choose photograph ${p.id}`} className={cn('w-full rounded-lg p-1 text-left ring-1 hover:ring-brand-400', value === p.url ? 'ring-2 ring-brand-500' : 'ring-slate-200')}>
                <img src={p.url} alt="" className="aspect-[4/5] w-full rounded object-cover" /><span className="mt-1 block text-center font-mono text-[10px] text-slate-500">{p.id}</span>
              </button></li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function IdentityRecordForm() {
  const { reg } = useParams();
  const state = useIiv();
  const me = useIivUser();
  const toast = useToast();
  const navigate = useNavigate();
  const existing = reg ? recordByReg(reg, state) : undefined;
  const [f, setF] = useState<RecordInput>(() => existing
    ? { reg: existing.reg, fullName: existing.fullName, dateOfBirth: existing.dateOfBirth, gender: existing.gender, stateOfOrigin: existing.stateOfOrigin, institution: existing.institution, course: existing.course, session: existing.session, jambPhoto: existing.jambPhoto, ninPhoto: existing.ninPhoto, ninLast4: existing.ninLast4, fingerprint: existing.fingerprint }
    : { reg: '', fullName: '', institution: 'UI', course: '', session: '2026/2027' });
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const fpFile = useRef<HTMLInputElement>(null);
  const counts = useMemo(() => state.verifications.filter((v) => v.reg === existing?.reg).length, [state, existing?.reg]);
  if (reg && !existing) return <NotFoundCard what="Identity record" back="Back to Identity Record Enrollment" to="/admin/identity-records" />;
  const set = (k: keyof RecordInput) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value || undefined }); setError(''); };
  const save = () => {
    const r = saveRecord(f, me.name, existing?.reg);
    if (!r.ok) { setError(r.error); window.scrollTo?.(0, 0); return; }
    toast({ tone: 'success', title: existing ? 'Identity record updated' : 'Candidate enrolled', description: `${r.value.fullName} · ${r.value.reg}` });
    navigate('/admin/identity-records');
  };
  const scanImage = fingerprintImage(personOf(f.jambPhoto, normaliseRegForPrint(f.reg)) ?? normaliseRegForPrint(f.reg));
  return (
    <>
      <PageHeader title={existing ? existing.fullName : 'Enrol candidate'} description={existing ? `Enrolled ${dateTime(existing.enrolledAt)} by ${existing.enrolledBy} · last updated ${dateTime(existing.updatedAt)}${counts ? ` · ${counts} verification${counts === 1 ? '' : 's'}` : ''}` : 'Add a candidate’s JAMB identity reference record.'}
        breadcrumbs={[{ label: 'Identity Record Enrollment', to: '/admin/identity-records' }, { label: existing ? existing.reg : 'New record' }]} />
      {error && <p role="alert" className="mb-4 max-w-4xl rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="max-w-4xl space-y-6">
        <Card className="px-5 py-5" aria-label="Candidate details">
          <h2 className="mb-3 font-semibold text-slate-900">Candidate details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="JAMB registration number" required hint="11 digits followed by 2 letters">{(p) => <Input {...p} value={f.reg} className="font-mono uppercase" onChange={set('reg')} />}</Field>
            <Field label="Full name" required>{(p) => <Input {...p} value={f.fullName} onChange={set('fullName')} />}</Field>
            <Field label="Date of birth">{(p) => <Input {...p} type="date" value={f.dateOfBirth ?? ''} onChange={set('dateOfBirth')} />}</Field>
            <Field label="Gender">{(p) => <Select {...p} value={f.gender ?? ''} onChange={(e) => setF({ ...f, gender: (e.target.value || undefined) as RecordInput['gender'] })}><option value="">Not specified</option><option>Female</option><option>Male</option></Select>}</Field>
            <Field label="State of origin">{(p) => <Input {...p} value={f.stateOfOrigin ?? ''} onChange={set('stateOfOrigin')} />}</Field>
            <Field label="Institution" required>{(p) => <Select {...p} value={f.institution} onChange={set('institution')}>{state.institutions.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}</Select>}</Field>
            <Field label="Course of study" required>{(p) => <Input {...p} value={f.course} onChange={set('course')} />}</Field>
            <Field label="Admission session" required>{(p) => <Select {...p} value={f.session} onChange={(e) => setF({ ...f, session: e.target.value as Session })}>{SESSIONS.map((s) => <option key={s}>{s}</option>)}</Select>}</Field>
          </div>
        </Card>
        <Card className="px-5 py-5" aria-label="Reference photographs">
          <h2 className="mb-3 font-semibold text-slate-900">Reference photographs</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <PhotoField label="JAMB profile photograph" value={f.jambPhoto} onChange={(v) => { setF({ ...f, jambPhoto: v }); setError(''); }} />
            <PhotoField label="NIN reference photograph" value={f.ninPhoto} onChange={(v) => { setF({ ...f, ninPhoto: v }); setError(''); }} />
          </div>
        </Card>
        <Card className="px-5 py-5" aria-label="Identity reference information">
          <h2 className="mb-3 font-semibold text-slate-900">Identity reference information</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="NIN (last four digits)" hint="The full NIN is held by NIMC.">{(p) => <Input {...p} inputMode="numeric" maxLength={4} value={f.ninLast4 ?? ''} onChange={set('ninLast4')} />}</Field>
            <div>
              <p className="text-sm font-medium text-slate-700">Fingerprint reference</p>
              <div className="mt-2 flex items-start gap-4">
                <div className="w-28 shrink-0">{f.fingerprint ? <EvidenceImage src={f.fingerprint.image} label={f.fingerprint.source === 'scanned' ? 'Scanned' : 'Uploaded sample'} caption={formatDate(f.fingerprint.at)} fingerprint /> : <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 text-center text-xs text-slate-400">No fingerprint</div>}</div>
                <div className="flex flex-col gap-2">
                  <Button size="sm" variant="secondary" icon={<Fingerprint className="h-4 w-4" />} onClick={() => setScanning(true)}>Scan fingerprint</Button>
                  <Button size="sm" variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => fpFile.current?.click()}>Upload fingerprint sample</Button>
                  {f.fingerprint && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, fingerprint: undefined })}>Remove</Button>}
                  <input ref={fpFile} type="file" accept="image/*" className="hidden" aria-label="Upload fingerprint sample" onChange={async (e) => { const x = e.target.files?.[0]; if (!x) return; try { setF({ ...f, fingerprint: { source: 'uploaded', image: await readPhoto(x, 320), at: new Date().toISOString() } }); } catch { /* not an image */ } e.target.value = ''; }} />
                </div>
              </div>
            </div>
          </div>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save}>{existing ? 'Save changes' : 'Save record'}</Button>
          <ButtonLink to="/admin/identity-records" variant="ghost">Cancel</ButtonLink>
        </div>
      </div>
      {scanning && (
        <Modal open onClose={() => setScanning(false)} title="Scan fingerprint" description="Capture the candidate’s right thumb as the fingerprint reference." footer={<Button variant="secondary" onClick={() => setScanning(false)}>Close</Button>}>
          <FingerprintScanner image={scanImage} captured={null} onCaptured={(url) => { setF({ ...f, fingerprint: { source: 'scanned', image: url, at: new Date().toISOString() } }); setScanning(false); }} />
        </Modal>
      )}
    </>
  );
}
const normaliseRegForPrint = (s: string) => s.trim().toUpperCase() || 'candidate';

