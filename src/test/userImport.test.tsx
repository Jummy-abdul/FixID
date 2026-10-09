import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import { SAMPLE_ORGANIZATION_ID } from '@/data/seed';
import type { IdentifierConfig } from '@/domain/types';
import {
  checkHeader, checkIdentities, errorReportCsv, readRecords, requestIdFor, resultsCsv, runImport, templateHeaders, type ImportDeps, type ImportRecord,
} from '@/domain/userImport';
import { parseCsv, toCsv } from '@/lib/csv';
import { createMockIdSwitch } from '@/services/mockIdSwitch';
import { applyCreateUser, applyImportSummary, isIdentifierTaken, prepareCreateUser, type CreateUserInput } from '@/store/operations';
import { loadState } from '@/store/persistence';
import { authorizeAction, createInitialState, reducer, type AppState } from '@/store/state';

const ORG = SAMPLE_ORGANIZATION_ID;
const AT = new Date().toISOString();
const GEN = 'org_northbridge_idc_member';
const MANUAL = 'org_northbridge_idc_matric-number';

/** Northbridge, with an extra generated identifier (manual ones are seeded). */
function base(): AppState {
  let s = createInitialState(new Date());
  s.session.currentOrganizationId = ORG;
  s = reducer(s, { type: 'config/identifier', input: { organizationId: ORG, at: AT, id: GEN, name: 'Member Number', mode: 'generated',
    segments: [{ id: 'a', kind: 'static', value: 'MEM' }, { id: 'b', kind: 'separator', value: '-' }, { id: 'c', kind: 'sequence', start: 1, digits: 4, zeroPad: true }] } });
  return s;
}
const cfg = (s: AppState, id: string) => s.data.identifierConfigs.find((c) => c.id === id)!;
const others = (s: AppState) => s.data.identifierConfigs.filter((c) => c.organizationId === ORG);
const orgMembers = (s: AppState) => s.data.members.filter((m) => m.organizationId === ORG);

let n = 0;
const person = (over: Partial<Record<string, string>> = {}) => {
  const i = ++n;
  return { 'First Name': 'Zainab', 'Last Name': `Quistwood${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i / 26) | 0) % 26)}`, 'Email Address': `zq.import${i}@example.org`, 'Phone Number': '', Country: '', 'Region/State': '', Gender: '', ...over };
};
function csv(config: IdentifierConfig, rows: Record<string, string>[], headers = templateHeaders(config)) {
  return [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))];
}

/** Parses and reads a file the way the page does. */
function read(s: AppState, config: IdentifierConfig, rows: string[][]) {
  const [header, ...data] = rows;
  const head = checkHeader(header, config, others(s));
  if (!head.ok) throw new Error(head.errors.join(' '));
  return readRecords(data, head.index, header.length, config, (v) => isIdentifierTaken(s, config.id, v));
}

/** The store's createUser action, without React. */
function harness(initial: AppState) {
  let state = initial;
  const idSwitch = createMockIdSwitch();
  const createUser: ImportDeps['createUser'] = (input: CreateUserInput) => {
    const denied = authorizeAction(state, 'users/create');
    if (denied) return { ok: false, errors: { form: denied } };
    const p = prepareCreateUser(state, input);
    if (!p.ok) return p;
    if (p.duplicateRequest) return { ok: true, memberId: p.duplicateRequest.memberId, identifier: p.prepared.assigned.value };
    const r = applyCreateUser(state, p.prepared);
    if (!r.ok) return r;
    state = reducer(state, { type: 'users/create', prepared: p.prepared });
    return { ok: true, memberId: r.memberId, identifier: p.prepared.assigned.value };
  };
  const deps: ImportDeps = { idSwitch, createUser, createdFor: (id) => state.data.members.find((m) => m.organizationId === ORG && m.creationRequestId === id) };
  return { get state() { return state; }, idSwitch, deps };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('CSV handling', () => {
  it('parses quoted values, CRLF and a byte order mark, and refuses malformed quoting', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual({ ok: true, rows: [['a', 'b'], ['x, y', 'say "hi"']] });
    expect(parseCsv('a\n"open')).toMatchObject({ ok: false, error: expect.stringMatching(/missing closing quote/) });
    expect(parseCsv('a,b\nx"y,z')).toMatchObject({ ok: false, error: expect.stringMatching(/Row 2 has a quote/) });
  });

  it('writes spreadsheet-safe CSV and neutralizes formulas, but keeps phone numbers', () => {
    const out = toCsv([['A', 'B'], ['=SUM(1)', '+234 803 555 0101'], ['a,b', '@x']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toBe('﻿A,B\r\n\'=SUM(1),+234 803 555 0101\r\n"a,b",\'@x\r\n');
  });
});

describe('template', () => {
  it('includes a required identifier column only for manual identifiers, and headings only', () => {
    const s = base();
    expect(templateHeaders(cfg(s, MANUAL))).toEqual(['Matric number', 'First Name', 'Last Name', 'Email Address', 'Phone Number', 'Country', 'Region/State', 'Gender']);
    expect(templateHeaders(cfg(s, GEN))).toEqual(['First Name', 'Last Name', 'Email Address', 'Phone Number', 'Country', 'Region/State', 'Gender']);
  });

  it('rejects the wrong template, a generated identifier column, missing, unknown and duplicate columns', () => {
    const s = base();
    const manual = cfg(s, MANUAL);
    const gen = cfg(s, GEN);
    expect(checkHeader(templateHeaders(manual), manual, others(s)).ok).toBe(true);
    expect(checkHeader(['Staff number', 'First Name', 'Last Name', 'Email Address'], manual, others(s))).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/you selected Matric number/), 'Missing column: Matric number.']) });
    expect(checkHeader(['Member Number', ...templateHeaders(gen)], gen, others(s))).toMatchObject({ ok: false, errors: [expect.stringMatching(/generated by FixID/)] });
    expect(checkHeader(templateHeaders(gen), manual, others(s))).toMatchObject({ ok: false, errors: ['Missing column: Matric number.'] });
    expect(checkHeader(['First Name', 'Surname', 'First Name'], gen, others(s))).toMatchObject({ ok: false, errors: expect.arrayContaining(['“Surname” isn’t a column in the template.', 'The column “First Name” appears more than once.', 'Missing columns: Last Name, Email Address.']) });
    // Optional columns may be left out; headings are matched case-insensitively.
    expect(checkHeader(['first name', 'LAST NAME', 'Email address'], gen, others(s)).ok).toBe(true);
  });
});

describe('validation and preview', () => {
  it('applies the Create User rules row by row and finds duplicates within the file and conflicts with existing users', () => {
    const s = base();
    const manual = cfg(s, MANUAL);
    const existing = orgMembers(s).find((m) => m.identifier?.configId === MANUAL)!.identifier!.value;
    const records = read(s, manual, csv(manual, [
      person({ 'Matric number': 'NB/IMP/001' }),
      person({ 'Matric number': '', 'First Name': '' }),
      person({ 'Matric number': 'NB/IMP/001' }),
      person({ 'Matric number': existing }),
      person({ 'Matric number': 'NB/IMP/004', 'Email Address': 'not-an-email', 'Phone Number': '12', Gender: 'X', Country: 'Atlantis' }),
      person({ 'Matric number': 'NB/IMP/005', 'Email Address': 'zq.import1@example.org' }),
      person({ 'Matric number': 'NB/IMP/006', 'Phone Number': '2348035550199', Country: 'ng', 'Region/State': 'lagos', Gender: 'female' }),
    ]));
    expect(records.map((r) => r.status)).toEqual(['valid', 'invalid', 'invalid', 'invalid', 'invalid', 'valid', 'valid'].map((x, i) => (i === 5 ? 'invalid' : x)));
    expect(records[1].errors).toEqual(['First Name: Enter their first name.', 'Matric number: Enter their Matric number.']);
    expect(records[2].errors).toEqual(['Matric number is the same as row 2. Each user needs their own.']);
    expect(records[3].errors).toEqual([`Matric number: ${existing} is already assigned to another user.`]);
    expect(records[4].errors).toEqual(expect.arrayContaining([expect.stringMatching(/^Country: /), 'Gender: use Female or Male, or leave it empty.', 'Email Address: Enter a valid email address.', 'Phone Number: Enter a valid phone number.']));
    expect(records[5].errors).toEqual(['Email Address is the same as row 2. Each user needs their own.']);
    // A number whose + a spreadsheet dropped is restored; names of countries and regions are normalized.
    expect(records[6].person).toMatchObject({ phone: '+2348035550199', phoneCountry: 'NG', country: 'NG', region: 'Lagos', gender: 'Female' });
    expect(records.map((r) => r.row)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('ignores blank lines, flags rows with extra values, and creates nothing', () => {
    const s = base();
    const gen = cfg(s, GEN);
    const before = s.data.members.length;
    const rows = csv(gen, [person()]);
    const records = read(s, gen, [...rows, ['', '', ''], [...rows[1], 'extra']]);
    expect(records).toHaveLength(2);
    expect(records[1].errors[0]).toMatch(/more values than there are columns/);
    expect(s.data.members).toHaveLength(before);
  });

  it('refuses people who are already users, or whose details belong to someone else, before importing', async () => {
    const s = base();
    const gen = cfg(s, GEN);
    const registry = buildIdSwitchRegistry();
    const member = orgMembers(s).find((m) => registry.some((r) => r.idSwitchId === m.idSwitchId && r.email))!;
    const rec = registry.find((r) => r.idSwitchId === member.idSwitchId)!;
    const check = (rows: Record<string, string>[]) => checkIdentities(read(s, gen, csv(gen, rows)), createMockIdSwitch(), orgMembers(s));
    const checked = [
      ...await check([person({ 'First Name': rec.givenName, 'Last Name': rec.familyName, 'Email Address': rec.email })]),
      ...await check([person({ 'Email Address': rec.email })]),
      ...await check([person()]),
    ];
    expect(checked[0]).toMatchObject({ status: 'invalid', errors: [expect.stringMatching(/already a user in your organization/)] });
    expect(checked[1]).toMatchObject({ status: 'invalid', errors: [expect.stringMatching(/different name/)] });
    expect(checked[2]).toMatchObject({ status: 'valid', resolution: { kind: 'none' } });
  });
});

describe('import', () => {
  async function prepared(h: ReturnType<typeof harness>, config: IdentifierConfig, rows: Record<string, string>[]) {
    return checkIdentities(read(h.state, config, csv(config, rows)), h.idSwitch, orgMembers(h.state));
  }

  it('creates users with the identifiers in the file, as regular users, without credentials or roles', async () => {
    const h = harness(base());
    const manual = cfg(h.state, MANUAL);
    const credsBefore = h.state.data.credentials.length;
    const adminsBefore = h.state.data.administrators.length;
    const records = await prepared(h, manual, [person({ 'Matric number': 'NB/IMP/101' }), person({ 'Matric number': 'NB/IMP/102' })]);
    const results = await runImport(h.deps, { importId: 'imp_a', organizationId: ORG, config: manual, records, identities: new Map() });
    expect(results.map((r) => [r.status, r.identifier])).toEqual([['created', 'NB/IMP/101'], ['created', 'NB/IMP/102']]);
    const made = results.map((r) => h.state.data.members.find((m) => m.id === r.memberId)!);
    expect(made.map((m) => [m.organizationId, m.identifier!.configId, m.status, m.resolution])).toEqual([[ORG, MANUAL, 'active', 'created-new'], [ORG, MANUAL, 'active', 'created-new']]);
    expect(h.state.data.credentials).toHaveLength(credsBefore);
    expect(h.state.data.administrators).toHaveLength(adminsBefore);
    expect(h.state.data.audit.filter((e) => e.action === 'user.created').slice(0, 2).map((e) => e.summary)).toEqual(expect.arrayContaining([expect.stringContaining('NB/IMP/101'), expect.stringContaining('NB/IMP/102')]));
  });

  it('generates a unique identifier for each created user and reports them in the results file', async () => {
    const h = harness(base());
    const gen = cfg(h.state, GEN);
    const records = await prepared(h, gen, [person(), person({ 'Email Address': 'bad' }), person()]);
    const results = await runImport(h.deps, { importId: 'imp_g', organizationId: ORG, config: gen, records, identities: new Map() });
    expect(results.map((r) => r.status)).toEqual(['created', 'skipped', 'created']);
    expect(results[0].identifier).toBe('MEM-0001');
    expect(results[2].identifier).toBe('MEM-0002');
    expect(cfg(h.state, GEN).nextSequence).toBe(3);
    const file = resultsCsv(gen, results);
    expect(file[0]).toEqual(['Row', 'Status', 'Member Number', 'First Name', 'Last Name', 'Email Address', 'Reason']);
    expect(file[1].slice(0, 3)).toEqual(['2', 'Created', 'MEM-0001']);
    expect(file[2][1]).toBe('Skipped');
    expect(file[2][6]).toMatch(/valid email/);
    // The error report uses the template columns, so corrected rows can be uploaded again.
    const report = errorReportCsv(gen, results.filter((r) => r.status !== 'created').map((r) => ({ row: r.row, values: r.values, reason: r.reason! })));
    expect(report[0]).toEqual(['Row', ...templateHeaders(gen), 'Errors']);
    expect(checkHeader(report[0], gen, others(h.state)).ok).toBe(true);
  });

  it('never creates a user twice when the same import is submitted again', async () => {
    const h = harness(base());
    const gen = cfg(h.state, GEN);
    const records = await prepared(h, gen, [person(), person()]);
    const job = { importId: 'imp_r', organizationId: ORG, config: gen, records, identities: new Map<number, string>() };
    const first = await runImport(h.deps, job);
    const count = h.state.data.members.length;
    const again = await runImport(h.deps, job);
    expect(h.state.data.members).toHaveLength(count);
    expect(again.map((r) => r.memberId)).toEqual(first.map((r) => r.memberId));
    expect(again.map((r) => r.identifier)).toEqual(['MEM-0001', 'MEM-0002']);
    expect(h.state.data.members.filter((m) => m.creationRequestId === requestIdFor('imp_r', 2))).toHaveLength(1);
  });

  it('stops cleanly when the identity service fails mid-import, then resumes without duplicates', async () => {
    const h = harness(base());
    const gen = cfg(h.state, GEN);
    const records = await prepared(h, gen, [person(), person(), person()]);
    const job = { importId: 'imp_x', organizationId: ORG, config: gen, records, identities: new Map<number, string>() };
    let calls = 0;
    const flaky: ImportDeps = { ...h.deps, idSwitch: { ...h.idSwitch, createIdentity: async (q) => { if (++calls === 2) h.idSwitch.simulation.setOutage(true); return h.idSwitch.createIdentity(q); } } };
    const partial = await runImport(flaky, job);
    expect(partial.map((r) => r.status)).toEqual(['created', 'not-processed', 'not-processed']);
    expect(orgMembers(h.state).filter((m) => m.creationRequestId?.startsWith('imp_x'))).toHaveLength(1);
    h.idSwitch.simulation.setOutage(false);
    const resumed = await runImport(h.deps, job);
    expect(resumed.map((r) => r.status)).toEqual(['created', 'created', 'created']);
    expect(resumed[0].memberId).toBe(partial[0].memberId);
    expect(orgMembers(h.state).filter((m) => m.creationRequestId?.startsWith('imp_x'))).toHaveLength(3);
  });

  it('reports every row as failed, with reasons, when nothing can be created', async () => {
    const h = harness(base());
    const manual = cfg(h.state, MANUAL);
    const records = await prepared(h, manual, [person({ 'Matric number': 'NB/IMP/201' })]);
    // Someone else takes the identifier between preview and import.
    const taken = harness(base());
    const r1 = taken.deps.createUser({ requestId: 'x', organizationId: ORG, at: AT, identifierConfigId: MANUAL, identifierValue: 'NB/IMP/201', person: { givenName: 'Ada', familyName: 'Other' }, identity: { idSwitchId: 'IDS-X', resolution: 'created-new' }, memberId: 'm_x' });
    expect(r1.ok).toBe(true);
    const results = await runImport({ ...taken.deps, idSwitch: h.idSwitch }, { importId: 'imp_f', organizationId: ORG, config: manual, records, identities: new Map() });
    expect(results).toMatchObject([{ status: 'failed', reason: 'NB/IMP/201 is already assigned to another user.' }]);
  });

  it('refuses unauthorized administrators and other organizations', async () => {
    const s = base();
    const input: CreateUserInput = { requestId: 'r', organizationId: ORG, at: AT, identifierConfigId: MANUAL, identifierValue: 'NB/IMP/301', person: { givenName: 'Ada', familyName: 'Eze' }, identity: { idSwitchId: 'IDS-Y', resolution: 'created-new' }, memberId: 'm_y' };
    // Role preview (read-only) and roles without users.manage.
    expect(harness(reducer(s, { type: 'preview/start', roleId: 'viewer' })).deps.createUser(input)).toMatchObject({ ok: false });
    const viewer = s.data.administrators.find((a) => a.organizationId === ORG && a.roleIds.includes('credential-manager') && a.status === 'active')!;
    const asViewer: AppState = { ...s, data: { ...s.data, admin: { ...s.data.admin, id: viewer.userId! } } };
    expect(harness(asViewer).deps.createUser(input)).toMatchObject({ ok: false, errors: { form: "You don't have permission to do this." } });
    // Into an organization other than the one the administrator is working in.
    const other = s.data.organizations.find((o) => o.id !== ORG && s.data.admin.organizationIds.includes(o.id))!;
    const cross = { ...input, organizationId: other.id };
    expect(prepareCreateUser(s, cross)).toMatchObject({ ok: false, errors: { form: expect.stringMatching(/organization you’re working in/) } });
    expect(applyCreateUser(s, { ...cross, assigned: { value: 'NB/IMP/301', nextSequence: null } })).toMatchObject({ ok: false });
    expect(reducer(s, { type: 'users/create', prepared: { ...cross, assigned: { value: 'NB/IMP/301', nextSequence: null } } }).data.members).toHaveLength(s.data.members.length);
    expect(applyImportSummary(s, { organizationId: other.id, importId: 'i', at: AT, fileName: 'f.csv', identifierName: 'x', counts: { total: 1, created: 1, failed: 0, skipped: 0, notProcessed: 0 } })).toMatchObject({ ok: false });
  });
});

describe('Import users screen', () => {
  let downloads: { name: string; text: Promise<string> }[] = [];
  beforeEach(() => {
    downloads = [];
    let pending: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => { pending = b; return 'blob:test'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      const blob = pending!;
      downloads.push({ name: this.download, text: new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(blob); }) });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  function renderApp(path: string, state: AppState) {
    render(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
      </MemoryRouter>,
    );
    return userEvent.setup({ applyAccept: false });
  }
  const upload = (user: ReturnType<typeof userEvent.setup>, name: string, text: string) => user.upload(screen.getByLabelText('Upload CSV file'), new File([text], name, { type: 'text/csv' }));

  it('downloads a real template, previews, imports manual identifiers and shows the users in the list', async () => {
    const s = base();
    const user = renderApp('/users', s);
    await user.click(screen.getByRole('link', { name: 'Import Users' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Import users' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose CSV file' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Matric number/ }));
    await user.click(screen.getByRole('button', { name: 'Download CSV Template' }));
    expect(downloads[0].name).toBe('fixid-user-import-matric-number.csv');
    expect(await downloads[0].text).toBe('Matric number,First Name,Last Name,Email Address,Phone Number,Country,Region/State,Gender\r\n'.replace(/^/, ''));

    const manual = cfg(s, MANUAL);
    const a = person({ 'Matric number': 'NB/UI/001', 'First Name': 'Folake' });
    const b = person({ 'Matric number': 'NB/UI/001' });
    await upload(user, 'staff.csv', toCsv(csv(manual, [a, b])));
    const summary = await screen.findByLabelText('Import summary');
    expect(summary).toHaveTextContent('Total records2');
    expect(summary).toHaveTextContent('Ready to import1');
    expect(summary).toHaveTextContent('Need correction1');
    expect(screen.getByRole('row', { name: /Row 3|^3/ })).toHaveTextContent('Matric number is the same as row 2');
    expect(loadState()!.data.members.some((m) => m.identifier?.value === 'NB/UI/001')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Import 1 user' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('1 row has problems and will be skipped');
    expect(dialog).toHaveTextContent('No digital IDs are issued');
    await user.click(within(dialog).getByRole('button', { name: 'Import Users' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Import results' })).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: 'Import totals' });
    expect(totals).toHaveTextContent('Records processed2');
    expect(totals).toHaveTextContent('Users created1');
    expect(totals).toHaveTextContent('Skipped1');
    const saved = loadState()!;
    expect(saved.data.members.filter((m) => m.identifier?.value === 'NB/UI/001')).toHaveLength(1);
    expect(saved.data.audit.find((e) => e.action === 'user.imported')!.summary).toMatch(/Imported 1 of 2 users from staff.csv \(Matric number\); 0 failed, 1 skipped/);

    await user.click(screen.getByRole('button', { name: 'Download Error Report' }));
    const report = await downloads[1].text;
    expect(report).toContain('Row,Matric number,First Name');
    expect(report).toContain('Matric number is the same as row 2');

    await user.click(screen.getByRole('link', { name: 'Go to Users' }));
    await user.type(await screen.findByRole('searchbox', { name: /search name/i }), 'Folake');
    expect(await screen.findByText(`Folake ${a['Last Name']}`)).toBeInTheDocument();
  });

  it('imports with a generated identifier and downloads the assigned identifiers', async () => {
    const s = base();
    const user = renderApp('/users/import', s);
    await user.click(screen.getByRole('radio', { name: /Member Number/ }));
    expect(screen.getByRole('list', { name: 'Template columns' })).not.toHaveTextContent('Member Number');
    await upload(user, 'members.csv', toCsv(csv(cfg(s, GEN), [person(), person()])));
    await user.click(await screen.findByRole('button', { name: 'Import 2 users' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Import Users' }));
    expect(await screen.findByText('2 users were created')).toBeInTheDocument();
    expect(screen.getByText('MEM-0001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download Results' }));
    const file = await downloads[0].text;
    expect(file).toMatch(/2,Created,MEM-0001/);
    expect(file).toMatch(/3,Created,MEM-0002/);
  });

  it('explains unusable files and keeps nothing', async () => {
    const s = base();
    const user = renderApp('/users/import', s);
    await user.click(screen.getByRole('radio', { name: /Member Number/ }));
    const problem = async (name: string, text: string, message: RegExp) => {
      await upload(user, name, text);
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
    };
    await problem('people.xlsx', 'x', /Upload a .csv file/);
    await user.click(screen.getByRole('button', { name: 'Replace file' }));
    await problem('empty.csv', '', /This file is empty/);
    await problem('headers.csv', toCsv([templateHeaders(cfg(s, GEN))]), /no users/);
    await problem('wrong.csv', toCsv(csv(cfg(s, MANUAL), [person({ 'Matric number': 'X1' })])), /you selected Member Number/);
    await problem('broken.csv', 'First Name,Last Name,Email Address\n"Ada,Eze,a@b.co', /missing closing quote/);
    expect(screen.queryByRole('button', { name: /^Import \d/ })).toBeNull();
    expect(loadState()?.data.members.length ?? s.data.members.length).toBe(s.data.members.length);
  });

  it('disables import when every record is invalid, and clears the file when the identifier changes', async () => {
    const s = base();
    const user = renderApp('/users/import', s);
    await user.click(screen.getByRole('radio', { name: /Member Number/ }));
    await upload(user, 'bad.csv', toCsv(csv(cfg(s, GEN), [person({ 'Email Address': 'x' }), person({ 'First Name': '' })])));
    expect(await screen.findByRole('button', { name: 'No users to import' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Staff number/ }));
    expect(screen.queryByText('bad.csv')).toBeNull();
    expect(screen.getByText(/The uploaded file was removed because it was for Member Number/)).toBeInTheDocument();
  });

  it('is only available to administrators who can add users', async () => {
    renderApp('/users/import', reducer(base(), { type: 'preview/start', roleId: 'viewer' }));
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it('keeps the individual Create User flow and links both from Add users', async () => {
    const user = renderApp('/users/new', base());
    expect(screen.getByRole('link', { name: /Add manually/ })).toHaveAttribute('href', '/users/new/manual');
    await user.click(screen.getByRole('link', { name: /Import users/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Import users' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Identifier' })).toBeInTheDocument());
  });
});

// Keep the record type referenced for readers of the tests.
export type { ImportRecord };
