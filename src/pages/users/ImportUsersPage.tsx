import { useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, FileSpreadsheet, Plus, RotateCcw, Upload, Users, X } from 'lucide-react';
import { Badge, Button, ButtonLink, ConfirmDialog, DataTable, EmptyState, PageHeader, Pagination, StatCard, Tabs, usePageSlice } from '@/components/ui';
import { IdentifierDrawer } from '@/components/config/IdentifierDrawer';
import { previewIdentifier } from '@/domain/identifierPattern';
import type { IdentifierConfig } from '@/domain/types';
import {
  MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, PERSON_COLUMNS, checkHeader, checkIdentities, errorReportCsv, readRecords, resultsCsv, runImport,
  templateFileName, templateHeaders, type ImportRecord, type ImportResult,
} from '@/domain/userImport';
import { downloadCsv, parseCsv } from '@/lib/csv';
import { cn } from '@/lib/cn';
import { newId } from '@/lib/identifiers';
import { useServices } from '@/services/ServicesProvider';
import { IdSwitchUnavailableError } from '@/services/types';
import { useActions, useOrgData, useStore } from '@/store/AppStore';
import { isIdentifierTaken } from '@/store/operations';
import { Callout, RadioCard } from './add/parts';

type Upload =
  | { kind: 'error'; fileName: string; errors: string[] }
  | { kind: 'checking'; fileName: string }
  | { kind: 'ready'; fileName: string; importId: string; configId: string; records: ImportRecord[] };

type Phase = { kind: 'prepare' } | { kind: 'importing'; done: number; total: number } | { kind: 'done'; results: ImportResult[] };

const readText = (file: File) => (typeof file.text === 'function' ? file.text() : new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result ?? ''));
  r.onerror = () => reject(r.error);
  r.readAsText(file);
}));

/** Users → Import users: create many regular users from a CSV file, with the same rules as adding one. */
export function ImportUsersPage() {
  const org = useOrgData();
  const { getState } = useStore();
  const { idSwitch } = useServices();
  const { createUser, recordImportSummary } = useActions();
  const configs = org.identifierConfigs;
  const [configId, setConfigId] = useState<string | null>(configs.length === 1 ? configs[0].id : null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [cleared, setCleared] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'prepare' });
  const [confirming, setConfirming] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  // Identities created in ID Switch per row, reused if the import is retried.
  const identities = useRef(new Map<number, string>());
  const config = configId ? org.identifierConfigById.get(configId) : undefined;

  const select = (id: string) => {
    if (id === configId) return;
    if (upload) setCleared(`The uploaded file was removed because it was for ${config?.name ?? 'a different identifier'}. Download the ${org.identifierConfigById.get(id)?.name} template and upload again.`);
    setUpload(null);
    setConfigId(id);
  };

  const handleFile = async (file: File) => {
    if (!config) return;
    setCleared(null);
    const fileName = file.name;
    const fail = (...errors: string[]) => setUpload({ kind: 'error', fileName, errors });
    if (!/\.csv$/i.test(fileName)) return fail('Upload a .csv file. Save spreadsheets as “CSV (Comma delimited)” first.');
    if (file.size > MAX_IMPORT_BYTES) return fail('This file is larger than 1 MB. Split it into smaller files.');
    if (file.size === 0) return fail('This file is empty. Add the column headings from the template and at least one user.');
    setUpload({ kind: 'checking', fileName });
    let text: string;
    try { text = await readText(file); } catch { return fail('The file couldn’t be read. Try saving it again as CSV.'); }
    if (text.includes('\u0000')) return fail('This doesn’t look like a CSV text file. Save it as “CSV (Comma delimited)” and try again.');
    const parsed = parseCsv(text);
    if (!parsed.ok) return fail(parsed.error);
    const [header, ...rows] = parsed.rows;
    if (!header || header.every((h) => !h.trim())) return fail('This file is empty. Add the column headings from the template and at least one user.');
    const head = checkHeader(header, config, configs);
    if (!head.ok) return fail(...head.errors);
    const records = readRecords(rows, head.index, header.length, config, (v) => isIdentifierTaken(getState(), config.id, v));
    if (!records.length) return fail('The file has column headings but no users. Add one user per row below the headings.');
    if (records.length > MAX_IMPORT_ROWS) return fail(`This file has ${records.length.toLocaleString()} users. Import up to ${MAX_IMPORT_ROWS.toLocaleString()} at a time.`);
    try {
      const checked = await checkIdentities(records, idSwitch, org.members);
      identities.current = new Map();
      setUpload({ kind: 'ready', fileName, importId: newId('imp'), configId: config.id, records: checked });
    } catch (err) {
      if (err instanceof IdSwitchUnavailableError) return fail('Existing records couldn’t be checked because the identity service is unavailable. Nothing was saved. Try again shortly.');
      return fail('The file couldn’t be checked. Nothing was saved.');
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void handleFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && config) void handleFile(f);
  };

  const ready = upload?.kind === 'ready' && upload.configId === configId ? upload : null;
  const valid = ready?.records.filter((r) => r.status === 'valid') ?? [];
  const invalid = ready?.records.filter((r) => r.status === 'invalid') ?? [];

  const start = async (records: ImportRecord[]) => {
    if (!ready || !config || inFlight.current) return;
    inFlight.current = true;
    setConfirming(false);
    const toCreate = records.filter((r) => r.status === 'valid').length;
    setPhase({ kind: 'importing', done: 0, total: toCreate });
    let done = 0;
    const results = await runImport(
      { idSwitch, createUser, createdFor: (requestId) => getState().data.members.find((m) => m.organizationId === org.organization.id && m.creationRequestId === requestId) },
      { importId: ready.importId, organizationId: org.organization.id, config, records, identities: identities.current },
      () => setPhase({ kind: 'importing', done: Math.min(++done, toCreate), total: toCreate }),
    );
    const count = (s: ImportResult['status']) => results.filter((r) => r.status === s).length;
    recordImportSummary({
      organizationId: org.organization.id, importId: ready.importId, at: new Date().toISOString(), fileName: ready.fileName, identifierName: config.name,
      counts: { total: results.length, created: count('created'), failed: count('failed'), skipped: count('skipped'), notProcessed: count('not-processed') },
    });
    inFlight.current = false;
    setPhase({ kind: 'done', results });
  };

  const retry = (results: ImportResult[]) => {
    if (!ready) return;
    // Rows already created are found by their request ID and not created again.
    const pending = new Set(results.filter((r) => r.status === 'not-processed' || r.status === 'created').map((r) => r.row));
    void start(ready.records.map((r) => (pending.has(r.row) ? r : { ...r, status: 'invalid' as const, errors: r.errors.length ? r.errors : [results.find((x) => x.row === r.row)?.reason ?? 'Not imported.'] })));
  };

  const reset = () => { setUpload(null); setPhase({ kind: 'prepare' }); identities.current = new Map(); };

  if (phase.kind === 'done' && config && ready) {
    return <Results config={config} fileName={ready.fileName} results={phase.results} onRetry={() => retry(phase.results)} onAnother={reset} />;
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users', to: '/users' }, { label: 'Add users', to: '/users/new' }, { label: 'Import users' }]}
        title="Import users"
        description="Add many people at once from a CSV file. Each row becomes a regular user in your organization, checked with the same rules as adding one user. No digital IDs are issued and no administrator roles are given."
      />

      {phase.kind === 'importing' ? (
        <section aria-label="Import in progress" className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-card">
          <p className="font-semibold text-slate-900" aria-live="polite">Creating users… {phase.done} of {phase.total}</p>
          <div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={phase.total} aria-valuenow={phase.done}>
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${phase.total ? (phase.done / phase.total) * 100 : 100}%` }} />
          </div>
          <p className="mt-3 text-sm text-slate-500">Keep this page open until the import finishes.</p>
        </section>
      ) : (
        <div className="space-y-6">
          <Section n={1} title="Select identifier" description="How the people in this file will be identified. Use one file per identifier.">
            {configs.length > 0 ? (
              <div role="radiogroup" aria-label="Identifier" className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {configs.map((c) => (
                  <RadioCard key={c.id} checked={configId === c.id} onSelect={() => select(c.id)} title={c.name}
                    badge={<Badge tone="neutral">{c.mode === 'manual' ? 'Manual' : 'Generated'}</Badge>}
                    description={c.mode === 'manual'
                      ? 'You provide a value for each user in the file.'
                      : <>FixID generates one for each user, e.g. <span className="font-mono text-slate-700">{previewIdentifier(c.segments, c.nextSequence, org.organization.timezone)}</span>. Not included in the file.</>} />
                ))}
              </div>
            ) : <p className="text-sm text-slate-500">No identifiers are set up yet.</p>}
            <button type="button" onClick={() => setDrawer(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
              <Plus className="h-4 w-4" aria-hidden="true" />Set up another identifier
            </button>
          </Section>

          <Section n={2} title="Download the template" description="Fill in one user per row below the headings, then save it as CSV.">
            {config ? (
              <>
                <ul className="flex flex-wrap gap-2" aria-label="Template columns">
                  {templateHeaders(config).map((h) => {
                    const required = h === config.name || PERSON_COLUMNS.find((c) => c.header === h)?.required;
                    return <li key={h}><Badge tone={required ? 'brand' : 'neutral'}>{h}{required ? ' (required)' : ''}</Badge></li>;
                  })}
                </ul>
                <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-slate-500">
                  {config.mode === 'manual'
                    ? <li>{config.name} must be unique for each user.</li>
                    : <li>{config.name} isn’t in the template: FixID assigns one to each user it creates. You can download them after the import.</li>}
                  <li>Phone numbers in international format, e.g. +234 803 555 0101. Country as a name or two-letter code. Gender as Female or Male.</li>
                  <li>Up to {MAX_IMPORT_ROWS.toLocaleString()} users per file. The template has headings only.</li>
                </ul>
                <Button className="mt-4" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadCsv(templateFileName(config), [templateHeaders(config)])}>Download CSV Template</Button>
              </>
            ) : <p className="text-sm text-slate-500">Select an identifier first.</p>}
          </Section>

          <Section n={3} title="Upload the completed file">
            {cleared && <div className="mb-4"><Callout tone="info">{cleared}</Callout></div>}
            <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" onChange={onPick} aria-label="Upload CSV file" disabled={!config} tabIndex={-1} />
            {!upload ? (
              <div onDragOver={(e) => { e.preventDefault(); if (config) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
                className={cn('flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center', dragging ? 'border-brand-400 bg-brand-50/50' : 'border-slate-300', !config && 'opacity-60')}>
                <Upload className="h-6 w-6 text-slate-400" aria-hidden="true" />
                <p className="mt-2 text-sm text-slate-600">Drag a .csv file here, or</p>
                <Button className="mt-3" variant="secondary" disabled={!config} onClick={() => fileInput.current?.click()}>Choose CSV file</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <FileSpreadsheet className="h-5 w-5 text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-slate-900">{upload.fileName}</span>
                {upload.kind === 'checking' && <span className="text-sm text-slate-500" role="status">Checking records…</span>}
                <Button size="sm" variant="secondary" disabled={upload.kind === 'checking'} onClick={() => fileInput.current?.click()}>Replace file</Button>
                <Button size="sm" variant="ghost" disabled={upload.kind === 'checking'} icon={<X className="h-4 w-4" />} onClick={() => setUpload(null)}>Remove</Button>
              </div>
            )}
            {upload?.kind === 'error' && (
              <div className="mt-4">
                <Callout tone="danger" title="This file can’t be imported">
                  <ul className="list-disc space-y-0.5 pl-5">{upload.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </Callout>
              </div>
            )}
          </Section>

          {ready && config && (
            <Section n={4} title="Review and import" description="Nothing has been created yet.">
              <Preview config={config} records={ready.records} />
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                {invalid.length > 0 ? (
                  <Button variant="ghost" icon={<Download className="h-4 w-4" />}
                    onClick={() => downloadCsv(`fixid-import-errors-${ready.importId}.csv`, errorReportCsv(config, invalid.map((r) => ({ row: r.row, values: r.values, reason: r.errors.join(' ') }))))}>
                    Download Error Report
                  </Button>
                ) : <span />}
                <Button icon={<Users className="h-4 w-4" />} disabled={!valid.length} onClick={() => setConfirming(true)}>
                  {valid.length ? `Import ${valid.length} ${valid.length === 1 ? 'user' : 'users'}` : 'No users to import'}
                </Button>
              </div>
              {!valid.length && <p className="mt-2 text-right text-sm text-slate-500">Correct the rows in your file and upload it again.</p>}
            </Section>
          )}
        </div>
      )}

      {ready && config && (
        <ConfirmDialog open={confirming} onCancel={() => setConfirming(false)} onConfirm={() => void start(ready.records)}
          title={`Import ${valid.length} ${valid.length === 1 ? 'user' : 'users'}?`} confirmLabel="Import Users"
          description={`They’ll be added to ${org.organization.name} as regular users, identified by ${config.name}.${config.mode === 'generated' ? ` FixID will generate each ${config.name}.` : ''}${invalid.length ? ` ${invalid.length} ${invalid.length === 1 ? 'row has' : 'rows have'} problems and will be skipped.` : ''} No digital IDs are issued.`} />
      )}
      <IdentifierDrawer open={drawer} suggestedName="" onClose={() => setDrawer(false)} onSaved={(id) => { setDrawer(false); select(id); }} />
    </>
  );
}

function Section({ n, title, description, children }: { n: number; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`import-step-${n}`} className="rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-card sm:px-8">
      <h2 id={`import-step-${n}`} className="flex items-center gap-3 text-lg font-semibold text-slate-900">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 ring-1 ring-brand-200" aria-hidden="true">{n}</span>
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const PAGE = 20;

function Preview({ config, records }: { config: IdentifierConfig; records: ImportRecord[] }) {
  const [filter, setFilter] = useState<'all' | 'valid' | 'invalid'>(() => (records.some((r) => r.status === 'invalid') ? 'invalid' : 'all'));
  const [page, setPage] = useState(1);
  const shown = useMemo(() => records.filter((r) => filter === 'all' || r.status === filter), [records, filter]);
  const { pageRows, pageCount, current } = usePageSlice(shown, page, PAGE);
  const validCount = records.filter((r) => r.status === 'valid').length;
  return (
    <>
      <div className="grid grid-cols-3 gap-3" aria-label="Import summary">
        <StatCard label="Total records" value={records.length} />
        <StatCard label="Ready to import" value={validCount} tone="emerald" />
        <StatCard label="Need correction" value={records.length - validCount} tone="amber" />
      </div>
      <div className="mt-4">
        <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }}
          tabs={[{ value: 'all', label: 'All', count: records.length }, { value: 'valid', label: 'Ready', count: validCount }, { value: 'invalid', label: 'Need correction', count: records.length - validCount }]} />
      </div>
      <DataTable
        rows={pageRows}
        rowKey={(r) => String(r.row)}
        empty={<EmptyState title="No rows here" />}
        columns={[
          { key: 'row', header: 'Row', cell: (r) => <span className="tabular-nums text-slate-500">{r.row}</span> },
          ...(config.mode === 'manual' ? [{ key: 'id', header: config.name, cell: (r: ImportRecord) => <span className="font-mono text-xs">{r.values[config.name] || '—'}</span> }] : []),
          { key: 'name', header: 'Name', cell: (r) => `${r.values['First Name']} ${r.values['Last Name']}`.trim() || '—' },
          { key: 'email', header: 'Email Address', cell: (r) => r.values['Email Address'] || '—' },
          { key: 'status', header: 'Status', cell: (r) => (r.status === 'valid' ? <Badge tone="success" dot>Ready</Badge> : <Badge tone="danger" dot>Needs correction</Badge>) },
          {
            key: 'issues', header: 'Issues', cell: (r) => (r.errors.length
              ? <ul className="min-w-[16rem] max-w-md list-disc space-y-0.5 whitespace-normal pl-4 text-sm text-red-700">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>
              : <span className="text-sm text-slate-500">{r.note ?? '—'}</span>),
          },
        ]}
      />
      <Pagination page={current} pageCount={pageCount} total={shown.length} pageSize={PAGE} onPage={setPage} />
    </>
  );
}

function Results({ config, fileName, results, onRetry, onAnother }: { config: IdentifierConfig; fileName: string; results: ImportResult[]; onRetry: () => void; onAnother: () => void }) {
  const count = (s: ImportResult['status']) => results.filter((r) => r.status === s).length;
  const created = count('created');
  const failed = count('failed');
  const skipped = count('skipped');
  const notProcessed = count('not-processed');
  const problems = results.filter((r) => r.status !== 'created');
  const stamp = new Date().toISOString().slice(0, 16).split(/\D/).join('');
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Users', to: '/users' }, { label: 'Import users' }]} title="Import results" description={`${fileName} · identified by ${config.name}`} />
      <div className="space-y-6">
        {created > 0 && !problems.length && <Callout tone="success" title={`${created} ${created === 1 ? 'user was' : 'users were'} created`}>Every row in the file was imported.</Callout>}
        {created > 0 && problems.length > 0 && <Callout tone="warning" title={`${created} of ${results.length} users were created`}>The other rows weren’t imported. Download the error report, correct those rows and upload them again.</Callout>}
        {created === 0 && <Callout tone="danger" title="No users were created">{notProcessed ? 'The identity service became unavailable. Nothing was saved for the remaining rows; retry to continue.' : 'None of the rows could be imported.'}</Callout>}
        <section aria-label="Import totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Records processed" value={results.length} />
          <StatCard label="Users created" value={created} tone="emerald" />
          <StatCard label="Failed" value={failed + notProcessed} tone="amber" />
          <StatCard label="Skipped" value={skipped} />
        </section>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Download className="h-4 w-4" />} variant="secondary" onClick={() => downloadCsv(`fixid-import-results-${stamp}.csv`, resultsCsv(config, results))}>Download Results</Button>
          {problems.length > 0 && (
            <Button icon={<Download className="h-4 w-4" />} variant="secondary"
              onClick={() => downloadCsv(`fixid-import-errors-${stamp}.csv`, errorReportCsv(config, problems.map((r) => ({ row: r.row, values: r.values, reason: r.reason ?? '' }))))}>Download Error Report</Button>
          )}
          {notProcessed > 0 && <Button icon={<RotateCcw className="h-4 w-4" />} onClick={onRetry}>Retry {notProcessed} remaining</Button>}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onAnother}>Import another file</Button>
          <ButtonLink to="/users" icon={<CheckCircle2 className="h-4 w-4" />}>Go to Users</ButtonLink>
        </div>
        {config.mode === 'generated' && created > 0 && (
          <p className="text-sm text-slate-500">FixID generated a {config.name} for each new user. They’re in the results file and on each user’s profile.</p>
        )}
        <section aria-labelledby="result-rows" className="rounded-2xl border border-slate-200 bg-white shadow-card">
          <h2 id="result-rows" className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">Rows</h2>
          <DataTable
            rows={results}
            rowKey={(r) => String(r.row)}
            rowHref={(r) => (r.memberId ? `/users/${r.memberId}` : '')}
            columns={[
              { key: 'row', header: 'Row', cell: (r) => <span className="tabular-nums text-slate-500">{r.row}</span> },
              { key: 'name', header: 'Name', cell: (r) => (r.memberId ? <Link to={`/users/${r.memberId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-900 hover:text-brand-700">{`${r.values['First Name']} ${r.values['Last Name']}`}</Link> : `${r.values['First Name']} ${r.values['Last Name']}`.trim() || '—') },
              { key: 'id', header: config.name, cell: (r) => <span className="font-mono text-xs">{r.identifier ?? (config.mode === 'manual' ? r.values[config.name] : '') ?? '—'}</span> },
              { key: 'status', header: 'Result', cell: (r) => <Badge tone={r.status === 'created' ? 'success' : r.status === 'skipped' ? 'neutral' : 'danger'} dot>{{ created: 'Created', failed: 'Failed', skipped: 'Skipped', 'not-processed': 'Not processed' }[r.status]}</Badge> },
              { key: 'reason', header: 'Reason', cell: (r) => <p className="min-w-[16rem] max-w-md whitespace-normal text-sm text-slate-600">{r.reason ?? '—'}</p> },
            ]}
          />
        </section>
      </div>
    </>
  );
}
