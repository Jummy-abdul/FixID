import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { AUTH_STORAGE_KEY } from '@/auth/authCore';
import { DEMO_PERSONAS, ORG_A, ORG_B, ORG_B1 } from '@/data/demoPersonas';
import { defaultSettings } from '@/domain/activitySettings';
import { applyActivate, applySaveActivity } from '@/store/activityOps';
import {
  ORG_IMPORT_COLUMNS, ORG_TEMPLATE_ROWS, applyBulkCreateOrganizations, checkOrganizationFile, type BulkCreateInput, type OrgImportRow,
} from '@/store/orgImport';
import { subRelationships } from '@/store/orgOps';
import { configFromSettings, executionUnavailable, invitableOrganizations, participation } from '@/store/sharingOps';
import { createInitialState, reducer, type AppState } from '@/store/state';
import { wizardToVerifiers } from './helpers/activityWizard';

const AT = new Date().toISOString();
const HEADER = ORG_IMPORT_COLUMNS.join(',');

function as(accountId: string, s = createInitialState(new Date())): AppState {
  const p = DEMO_PERSONAS.find((x) => x.accountId === accountId)!;
  return { ...s, data: { ...s.data, admin: { id: accountId, name: `${p.firstName} ${p.lastName}`, email: p.email, role: 'Owner', organizationIds: [p.organizationId!] } }, session: { ...s.session, currentOrganizationId: p.organizationId! } };
}
const VICTOR = 'acct_demo_b_admin';

const AUDITOR = `${ORG_A}_usr_2`;
const LINA = 'acct_demo_b1_admin';

const check = (s: AppState, text: string, name = 'orgs.csv', org = ORG_B) => checkOrganizationFile(s, org, { name, text });
const rowsOf = (s: AppState, text: string) => { const r = check(s, text); if (!r.ok) throw new Error(r.error); return r.rows; };
const input = (rows: OrgImportRow[], org = ORG_B): BulkCreateInput => ({
  parentOrganizationId: org, at: AT,
  rows: rows.map((r, i) => ({ row: r.row, name: r.name, adminEmail: r.adminEmail, token: `tok_${i}`, ids: { organizationId: `org_up_${i}`, administratorId: `adm_up_${i}`, relationshipId: `rel_up_${i}` } })),
});
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');
const UNIS = csv('Lakeside University,registrar@lakeside.example', 'Hillcrest College,admin@hillcrest.example', '"Northfield Institute, Main Campus",office@northfield.example');

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('bulk organization upload (store)', () => {
  it('the template has only the required columns and one sample row', () => {
    expect(ORG_TEMPLATE_ROWS).toEqual([['Organization name', 'Administrator email'], ['Example University', 'admin@example-university.example']]);
  });

  it('creates every ready organization exactly like Add organization, without inviting them to any activity', () => {
    const s = as(VICTOR);
    const rows = rowsOf(s, UNIS);
    expect(rows.map((r) => [r.row, r.name, r.status])).toEqual([[2, 'Lakeside University', 'ready'], [3, 'Hillcrest College', 'ready'], [4, 'Northfield Institute, Main Campus', 'ready']]);
    const r = applyBulkCreateOrganizations(s, input(rows));
    if (!r.ok) throw new Error(r.error);
    expect(r.results.map((x) => x.outcome)).toEqual(['created', 'created', 'created']);
    const created = r.state.data.organizations.filter((o) => o.id.startsWith('org_up_'));
    expect(created.map((o) => o.name)).toEqual(['Lakeside University', 'Hillcrest College', 'Northfield Institute, Main Campus']);
    expect(created.every((o) => o.onboarding === 'awaiting-administrator' && o.status === 'active' && o.memberLabel === 'Member')).toBe(true);
    // Related to the uploader; each has an invited administrator; the uploader gets no access to them.
    expect(subRelationships(r.state, ORG_B).filter((x) => x.childOrganizationId.startsWith('org_up_'))).toHaveLength(3);
    expect(r.state.data.administrators.filter((a) => a.organizationId.startsWith('org_up_')).map((a) => [a.email, a.status])).toEqual([
      ['registrar@lakeside.example', 'invited'], ['admin@hillcrest.example', 'invited'], ['office@northfield.example', 'invited'],
    ]);
    expect(r.state.data.administrators.some((a) => a.organizationId.startsWith('org_up_') && a.userId === VICTOR)).toBe(false);
    // No activity invitations were sent.
    expect(r.state.data.activityConfigs.some((a) => a.sharing?.participants.some((p) => p.organizationId.startsWith('org_up_')))).toBe(false);
    expect(r.state.data.audit[0]).toMatchObject({ action: 'organization.bulk-imported', organizationId: ORG_B, summary: expect.stringContaining('3 created, 0 already in FixID, 0 failed') });
  });

  it('flags missing values, invalid emails and duplicates within the file', () => {
    const rows = rowsOf(as(VICTOR), csv(
      ',someone@a.example',
      'No Email College,',
      'Bad Email College,not-an-email',
      'Twin University,one@twin.example',
      'twin  university,two@twin.example',
      'Other College,one@twin.example',
    ));
    expect(rows.map((r) => [r.row, r.status, r.problems.join(' ')])).toEqual([
      [2, 'invalid', 'Organization name is missing.'],
      [3, 'invalid', 'Administrator email is missing.'],
      [4, 'invalid', 'Enter a valid email address.'],
      [5, 'ready', ''],
      [6, 'invalid', 'Same organization as row 5.'],
      [7, 'invalid', 'Same administrator email as row 5.'],
    ]);
  });

  it('skips organizations that already exist in FixID and administrators already in use', () => {
    const s = as(VICTOR);
    const existingAdmin = s.data.administrators.find((a) => a.organizationId === ORG_A && a.status === 'active')!;
    const rows = rowsOf(s, csv('meridian harbourside,x@new.example', 'Brightwater Partners,y@new.example', `Fresh College,${existingAdmin.email}`));
    expect(rows[0]).toMatchObject({ status: 'exists', problems: ['Already in FixID.'] });
    expect(rows.find((r) => r.name === 'Fresh College')).toMatchObject({ status: 'invalid' });
    expect(rows.find((r) => r.name === 'Fresh College')!.problems[0]).toMatch(/email/i);
  });

  it('rejects files that aren’t usable: wrong type, empty, headings only, wrong columns, unreadable', () => {
    const s = as(VICTOR);
    expect(check(s, UNIS, 'orgs.xlsx')).toEqual({ ok: false, error: expect.stringContaining('CSV') });
    expect(check(s, '')).toEqual({ ok: false, error: 'The file is empty.' });
    expect(check(s, '﻿\n  \n')).toEqual({ ok: false, error: 'The file is empty.' });
    expect(check(s, `${HEADER}\n`)).toEqual({ ok: false, error: expect.stringContaining('no organizations') });
    expect(check(s, 'Name,Email\nA,b@c.example')).toEqual({ ok: false, error: expect.stringContaining('template headings') });
    expect(check(s, `${HEADER},Country\nA,b@c.example,X`)).toEqual({ ok: false, error: expect.stringContaining('Unknown column “Country”') });
    expect(check(s, 'PK\u0003\u0004\u0000\u0000binary')).toMatchObject({ ok: false });
    expect(check(s, `${HEADER}\n"Unclosed,a@b.example`)).toMatchObject({ ok: false, error: expect.stringContaining('quote') });
  });

  it('re-checks at import time and reports each row: created, skipped or failed', () => {
    const s = as(VICTOR);
    const rows = rowsOf(s, csv('Lakeside University,registrar@lakeside.example', 'Hillcrest College,admin@hillcrest.example'));
    // Lakeside is created by someone else after the preview.
    const first = applyBulkCreateOrganizations(s, input([rows[0]]));
    if (!first.ok) throw new Error(first.error);
    const again = applyBulkCreateOrganizations(first.state, { ...input(rows), rows: input(rows).rows.map((r) => ({ ...r, ids: { ...r.ids, organizationId: `${r.ids.organizationId}_b` }, token: `${r.token}_b` })) });
    if (!again.ok) throw new Error(again.error);
    expect(again.results.map((r) => [r.row, r.outcome, r.reason])).toEqual([[2, 'exists', 'Already in FixID.'], [3, 'created', undefined]]);
    expect(again.state.data.organizations.filter((o) => o.name === 'Lakeside University')).toHaveLength(1);
    // Rows that aren't valid at import time fail with their reason; nothing is created for them.
    const bad = applyBulkCreateOrganizations(s, input([{ row: 9, name: 'X', adminEmail: 'nope', status: 'ready', problems: [] }]));
    if (!bad.ok) throw new Error(bad.error);
    expect(bad.results[0]).toMatchObject({ row: 9, outcome: 'failed' });
    expect(bad.state.data.organizations).toHaveLength(s.data.organizations.length);
  });

  it('only administrators who can manage organizations, in a top-level organization, can upload', () => {
    const base = createInitialState(new Date());
    const rows = rowsOf(as(VICTOR, base), UNIS);
    const auditor = as(AUDITOR, base);
    expect(applyBulkCreateOrganizations(auditor, input(rows, ORG_A))).toMatchObject({ ok: false, error: expect.stringContaining('permission') });
    expect(reducer(auditor, { type: 'organizations/bulkCreate', organizationId: ORG_A, input: input(rows, ORG_A) })).toBe(auditor);
    expect(applyBulkCreateOrganizations(as(LINA, base), input(rows, ORG_B1))).toMatchObject({ ok: false });
    // Acting for another organization is refused.
    const victor = as(VICTOR, base);
    expect(reducer(victor, { type: 'organizations/bulkCreate', organizationId: ORG_B, input: input(rows, ORG_A) })).toBe(victor);
    expect(applyBulkCreateOrganizations(victor, input(rows, ORG_A))).toMatchObject({ ok: false });
  });

  it('imported organizations can be selected and invited to a shared activity through the normal flow', () => {
    const s0 = as(VICTOR);
    const created = applyBulkCreateOrganizations(s0, input(rowsOf(s0, UNIS)));
    if (!created.ok) throw new Error(created.error);
    let s = created.state;
    expect(invitableOrganizations(s, ORG_B).map((o) => o.id)).toEqual(expect.arrayContaining(['org_up_0', 'org_up_1', 'org_up_2']));
    const settings = { ...defaultSettings(), identitySource: { kind: 'external' as const, integrationId: 'int_b_identity' }, exceptions: 'review' as const };
    let n = 0;
    const gen = configFromSettings(settings, s.data.organizations.find((o) => o.id === ORG_B)!, () => `chk_${++n}`);
    const saved = applySaveActivity(s, { organizationId: ORG_B, ids: { activityId: 'uni_entry', versionId: 'uni_entry_v1' }, at: AT, form: {
      name: 'University Entry', description: '', purpose: '', verifierIds: [], type: gen.type, checks: gen.checks, outcome: gen.outcome, requirements: gen.requirements,
      customized: false, verification: settings, audience: 'shared', participantIds: ['org_up_0', 'org_up_2'],
    } });
    if (!saved.ok) throw new Error(saved.error);
    const act = applyActivate(saved.state, { organizationId: ORG_B, activityId: 'uni_entry', at: AT });
    if (!act.ok) throw new Error(act.error);
    s = act.state;
    const a = s.data.activityConfigs.find((x) => x.id === 'uni_entry')!;
    expect(participation(a, 'org_up_0')).toBe('invited');
    expect(participation(a, 'org_up_2')).toBe('invited');
    expect(participation(a, 'org_up_1')).toBeFalsy();
    // Being invited gives no access to run it until the organization accepts.
    expect(executionUnavailable(s, a, 'org_up_0')).toBeTruthy();
  });
});

function renderAs(path: string, accountId: string, state = createInitialState(new Date())) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accounts: [], session: { accountId } }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup({ applyAccept: false });
}

describe('bulk organization upload (screens)', () => {
  it('uploads, previews, confirms and summarises; problems are explained by row', async () => {
    const user = renderAs('/organizations', VICTOR);
    const bulk = await screen.findByRole('link', { name: 'Bulk upload' });
    expect(screen.getByRole('button', { name: 'Add organization' })).toBeTruthy();
    await user.click(bulk);
    const upload = await screen.findByLabelText('Upload CSV file');
    // A wrong file is explained and nothing is created.
    await user.upload(upload, new File(['x'], 'orgs.xlsx'));
    expect(await screen.findByRole('alert')).toHaveTextContent('orgs.xlsx: Upload a CSV file');
    await user.upload(screen.getByLabelText('Upload CSV file'), new File([csv('Lakeside University,registrar@lakeside.example', 'Hillcrest College,bad-email', 'Meridian Harbourside,x@new.example', 'Lakeside University,other@lakeside.example')], 'unis.csv', { type: 'text/csv' }));
    const summary = await screen.findByRole('region', { name: 'Preview summary' });
    expect(summary).toHaveTextContent('Ready to import1');
    expect(summary).toHaveTextContent('Already in FixID1');
    expect(summary).toHaveTextContent('Need attention2');
    expect(screen.getByRole('row', { name: /Hillcrest College/ })).toHaveTextContent('Enter a valid email address.');
    expect(screen.getByRole('row', { name: /other@lakeside/ })).toHaveTextContent('Same organization as row 2.');
    await user.click(screen.getByRole('button', { name: 'Import 1 organization' }));
    const dialog = screen.getByRole('dialog', { name: 'Create 1 organization?' });
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));
    const results = await screen.findByRole('region', { name: 'Import results' });
    expect(results).toHaveTextContent('Created1');
    expect(results).toHaveTextContent('Skipped (already in FixID)1');
    expect(results).toHaveTextContent('Failed2');
    expect(screen.getByRole('row', { name: /Hillcrest College/ })).toHaveTextContent('Failed');
    await user.click(screen.getByRole('link', { name: 'Back to Organizations' }));
    expect(await screen.findByRole('row', { name: /Lakeside University/ })).toHaveTextContent('Invitation pending');
  }, 30_000);

  it('people without permission don’t see or reach bulk upload', async () => {
    renderAs('/organizations/bulk-upload', AUDITOR);
    await screen.findByRole('navigation', { name: 'Primary' });
    expect(screen.queryByLabelText('Upload CSV file')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload CSV' })).toBeNull();
  }, 20_000);

  it('the activity wizard finds sub-organizations by name when there are many', async () => {
    const s0 = as(VICTOR);
    const many = csv(...Array.from({ length: 10 }, (_, i) => `Campus ${i + 1} University,admin${i}@campus.example`));
    const r = applyBulkCreateOrganizations(s0, input(rowsOf(s0, many)));
    if (!r.ok) throw new Error(r.error);
    const user = renderAs('/verification-activities/new', VICTOR, r.state);
    await wizardToVerifiers(user, { name: 'Campus Entry', source: 'Group Identity Service' });
    const group = await screen.findByRole('group', { name: 'Authorised sub-organizations' });
    await user.type(screen.getByLabelText('Search organizations'), 'Campus 1');
    expect(within(group).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual(['Campus 1 University', 'Campus 10 University']);
    await user.click(screen.getByRole('button', { name: 'Select all shown' }));
    expect(screen.getByText('2 selected')).toBeTruthy();
  }, 20_000);
});
