import { useRef, useState, type ChangeEvent } from 'react';
import { Download, Upload } from 'lucide-react';
import { Badge, Button, ButtonLink, Card, ConfirmDialog, DataTable, PageHeader, StatCard, useToast } from '@/components/ui';
import { downloadCsv } from '@/lib/csv';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { canHaveSubOrganizations } from '@/store/orgOps';
import {
  ORG_TEMPLATE_FILE, ORG_TEMPLATE_ROWS, checkOrganizationFile, type OrgImportResult, type OrgImportRow,
} from '@/store/orgImport';

type Step =
  | { kind: 'upload'; error?: { fileName: string; message: string } }
  | { kind: 'preview'; fileName: string; rows: OrgImportRow[] }
  | { kind: 'done'; fileName: string; results: OrgImportResult[] };

const readText = (file: File) => (typeof file.text === 'function' ? file.text() : new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result ?? ''));
  r.onerror = () => reject(r.error);
  r.readAsText(file);
}));

const STATUS = {
  ready: <Badge tone="success">Ready</Badge>,
  exists: <Badge tone="neutral">Already in FixID</Badge>,
  invalid: <Badge tone="danger">Needs attention</Badge>,
};
const OUTCOME = {
  created: <Badge tone="success">Created</Badge>,
  exists: <Badge tone="neutral">Skipped</Badge>,
  failed: <Badge tone="danger">Failed</Badge>,
};

/** Organizations → Bulk upload: create many organizations from a CSV file, checked before anything is created. */
export function BulkUploadOrganizationsPage() {
  const { organization } = useSession();
  const { state, getState } = useStore();
  const { bulkCreateOrganizations } = useActions();
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: 'upload' });
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const allowed = canHaveSubOrganizations(state, organization.id);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let text = '';
    try { text = await readText(file); } catch { return setStep({ kind: 'upload', error: { fileName: file.name, message: 'The file couldn’t be read. Try again.' } }); }
    const r = checkOrganizationFile(getState(), organization.id, { name: file.name, size: file.size, text });
    setStep(r.ok ? { kind: 'preview', fileName: file.name, rows: r.rows } : { kind: 'upload', error: { fileName: file.name, message: r.error } });
  };

  const runImport = () => {
    if (step.kind !== 'preview') return;
    setConfirming(false);
    const ready = step.rows.filter((r) => r.status === 'ready');
    const res = bulkCreateOrganizations(organization.id, ready);
    if (!res.ok) return toast({ tone: 'error', title: 'Nothing was imported', description: res.error });
    // Rows that weren't ready are reported with the import's results, in file order.
    const byRow = new Map(res.results.map((x) => [x.row, x]));
    const results = step.rows.map((r): OrgImportResult => byRow.get(r.row)
      ?? { row: r.row, name: r.name, adminEmail: r.adminEmail, outcome: r.status === 'exists' ? 'exists' : 'failed', reason: r.problems.join(' ') });
    setStep({ kind: 'done', fileName: step.fileName, results });
  };

  const picker = (label: string, variant: 'primary' | 'secondary' = 'primary') => (
    <>
      <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-label="Upload CSV file" onChange={(e) => void onPick(e)} />
      <Button variant={variant} icon={<Upload className="h-4 w-4" />} onClick={() => input.current?.click()}>{label}</Button>
    </>
  );

  if (!allowed) {
    return (
      <>
        <PageHeader title="Bulk upload" breadcrumbs={[{ label: 'Organizations', to: '/organizations' }, { label: 'Bulk upload' }]} />
        <Card className="p-5 text-sm text-slate-600">A sub-organization can’t create organizations of its own.</Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Bulk upload" description="Add several organizations from a CSV file. Each gets its own workspace and an invitation for its administrator."
        breadcrumbs={[{ label: 'Organizations', to: '/organizations' }, { label: 'Bulk upload' }]} />

      {step.kind === 'upload' && (
        <Card className="space-y-4 p-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Download the template and add one organization per row.</li>
            <li>Upload the file. You’ll see a preview before anything is created.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadCsv(ORG_TEMPLATE_FILE, ORG_TEMPLATE_ROWS)}>Download template</Button>
            {picker('Upload CSV')}
          </div>
          {step.error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">
              <span className="font-medium">{step.error.fileName}:</span> {step.error.message}
            </p>
          )}
        </Card>
      )}

      {step.kind === 'preview' && (() => {
        const ready = step.rows.filter((r) => r.status === 'ready').length;
        const exists = step.rows.filter((r) => r.status === 'exists').length;
        const invalid = step.rows.filter((r) => r.status === 'invalid').length;
        return (
          <div className="space-y-4">
            <section aria-label="Preview summary" className="grid grid-cols-3 gap-3">
              <StatCard label="Ready to import" value={ready} tone="emerald" />
              <StatCard label="Already in FixID" value={exists} />
              <StatCard label="Need attention" value={invalid} tone="amber" />
            </section>
            {invalid > 0 && <p className="text-sm text-slate-600">Rows that need attention won’t be imported. Correct the file and upload it again, or import the ready rows now.</p>}
            <Card>
              <div className="border-b border-slate-100 px-4 py-3 text-sm text-slate-600">{step.fileName}</div>
              <DataTable rows={step.rows} rowKey={(r) => String(r.row)} columns={[
                { key: 'row', header: 'Row', cell: (r) => <span className="tabular-nums text-slate-500">{r.row}</span> },
                { key: 'name', header: 'Organization name', cell: (r) => r.name || <span className="text-slate-400">—</span> },
                { key: 'email', header: 'Administrator email', cell: (r) => r.adminEmail || <span className="text-slate-400">—</span> },
                { key: 'status', header: 'Status', cell: (r) => STATUS[r.status] },
                { key: 'issue', header: 'Issue', cell: (r) => <span className="text-slate-600">{r.status === 'ready' ? '' : r.problems.join(' ')}</span> },
              ]} />
            </Card>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!ready} onClick={() => setConfirming(true)}>{`Import ${ready} ${ready === 1 ? 'organization' : 'organizations'}`}</Button>
              {picker('Upload another file', 'secondary')}
            </div>
            <ConfirmDialog open={confirming} title={`Create ${ready} ${ready === 1 ? 'organization' : 'organizations'}?`}
              description="Each gets its own workspace, and its administrator is invited. Organizations aren’t invited to any activity."
              confirmLabel="Import" onCancel={() => setConfirming(false)} onConfirm={runImport} />
          </div>
        );
      })()}

      {step.kind === 'done' && (() => {
        const count = (o: OrgImportResult['outcome']) => step.results.filter((r) => r.outcome === o).length;
        const issues = step.results.filter((r) => r.outcome !== 'created');
        return (
          <div className="space-y-4">
            <section aria-label="Import results" className="grid grid-cols-3 gap-3">
              <StatCard label="Created" value={count('created')} tone="emerald" />
              <StatCard label="Skipped (already in FixID)" value={count('exists')} />
              <StatCard label="Failed" value={count('failed')} tone="amber" />
            </section>
            {issues.length > 0 && (
              <Card>
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-900">Rows not imported</div>
                <DataTable rows={issues} rowKey={(r) => String(r.row)} columns={[
                  { key: 'row', header: 'Row', cell: (r) => <span className="tabular-nums text-slate-500">{r.row}</span> },
                  { key: 'name', header: 'Organization name', cell: (r) => r.name || <span className="text-slate-400">—</span> },
                  { key: 'outcome', header: 'Result', cell: (r) => OUTCOME[r.outcome] },
                  { key: 'reason', header: 'Issue', cell: (r) => <span className="text-slate-600">{r.reason}</span> },
                ]} />
              </Card>
            )}
            <p className="text-sm text-slate-600">To invite organizations, open a shared activity and choose them under Participating organizations.</p>
            <div className="flex flex-wrap gap-2">
              <ButtonLink to="/organizations?view=sub-organizations" variant="primary">Back to Organizations</ButtonLink>
              <Button variant="secondary" icon={<Download className="h-4 w-4" />}
                onClick={() => downloadCsv('fixid-organization-upload-results.csv', [['Row', 'Organization name', 'Administrator email', 'Result', 'Issue'],
                  ...step.results.map((r) => [String(r.row), r.name, r.adminEmail, r.outcome === 'created' ? 'Created' : r.outcome === 'exists' ? 'Skipped' : 'Failed', r.reason ?? ''])])}>Download results</Button>
              <Button variant="ghost" onClick={() => setStep({ kind: 'upload' })}>Upload another file</Button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
