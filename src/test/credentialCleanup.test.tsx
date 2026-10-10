import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { DEMO_SESSION } from '@/auth/authCore';
import { NEW_ORGANIZATION_ID } from '@/data/seed';
import type { IdentifierSegment } from '@/domain/types';
import { selectOrgData } from '@/store/AppStore';
import { applyCreateUser, applyCredentialConfig, applyIdentifierConfig, applyIssuance, applyUploadLogo, prepareCreateUser } from '@/store/operations';
import { bytesToDataUrl, checkLogo, MAX_LOGO_BYTES } from '@/domain/logo';
import { loadState } from '@/store/persistence';
import { createInitialState, type AppState } from '@/store/state';

const ORG = NEW_ORGANIZATION_ID;
const AT = new Date().toISOString();
const PATTERN: IdentifierSegment[] = [
  { id: 's1', kind: 'static', value: 'STU' }, { id: 's2', kind: 'separator', value: '/' }, { id: 's3', kind: 'date', format: 'YYYY' },
  { id: 's4', kind: 'separator', value: '/' }, { id: 's5', kind: 'sequence', start: 1, digits: 5, zeroPad: true },
];

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify((r as unknown as { errors: unknown }).errors));
  return r as Extract<T, { ok: true }>;
}

/** A new organization with Matric Number and two users (no credentials). */
function baseState(): AppState {
  let s = ok(applyIdentifierConfig(createInitialState(new Date()), { organizationId: ORG, at: AT, id: 'idc_1', name: 'Matric Number', mode: 'generated', segments: PATTERN })).state;
  for (const [i, [given, family]] of [['Amara', 'Okonkwo'], ['Tunde', 'Bello']].entries()) {
    const p = prepareCreateUser(s, {
      requestId: `req_${i}`, organizationId: ORG, at: AT, identifierConfigId: 'idc_1', person: { givenName: given, familyName: family },
      identity: { idSwitchId: `IDS-T-${i}`, resolution: 'created-new' }, memberId: `mem_${i}`,
    }, () => 0.5);
    if (!p.ok) throw new Error('prepare failed');
    s = ok(applyCreateUser(s, p.prepared)).state;
  }
  return s;
}

function withStudentId(s: AppState, over: Partial<Parameters<typeof applyCredentialConfig>[1]> = {}) {
  return ok(applyCredentialConfig(s, {
    organizationId: ORG, at: AT, id: 'ct_1', name: 'Student ID', identifierConfigId: 'idc_1', templateId: 'classic-portrait',
    effectiveDate: 'on-issue', validity: { kind: 'duration', months: 24 }, renewable: false, ...over,
  })).state;
}

function renderApp(path: string, state: AppState) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProviders initialState={state} authSession={DEMO_SESSION}><AppRoutes /></AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const org = () => selectOrgData(loadState()!, ORG);


beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** A PNG header of the given size (enough for the format and dimension checks). */
function png(w = 64, h = 32, extra = 64) {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function jpeg(w = 40, h = 20) {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0]);
}
function webp(w = 100, h = 50) {
  const b = new Uint8Array(30);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
  b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0], 24);
  return b;
}
const logoUrl = (bytes = png()) => bytesToDataUrl(bytes, 'image/png');

describe('Issue #001: user created modal', () => {
  it('asks about issuing a credential, with Issue Credential and Not now', async () => {
    const user = renderApp('/users/new/manual', baseState());
    await user.click(screen.getByRole('radio', { name: /Matric Number/ }));
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    await user.type(screen.getByLabelText(/first name/i), 'Chika');
    await user.type(screen.getByLabelText(/last name/i), 'Obi');
    await user.type(screen.getByLabelText(/email/i), 'chika@crestfield.example');
    await user.click(screen.getByRole('button', { name: 'Create user' }));
    const modal = await screen.findByRole('dialog', { name: 'User created successfully' }, { timeout: 3000 });
    expect(modal).toHaveTextContent('Chika Obi has been added to your organization.');
    expect(modal).toHaveTextContent('Would you like to issue a credential to this user?');
    expect(modal).not.toHaveTextContent(/digital ID/i);
    expect(within(modal).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: 'Issue Credential' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Issue credential' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recipient')).toHaveTextContent('Continuing for Chika Obi');
  });
});

describe('Issue #002: Issue Credential page', () => {
  it('uses the new description and empty state, without the removed helper text', async () => {
    renderApp('/credentials/issue', baseState());
    expect(screen.getByRole('heading', { level: 1, name: 'Issue credential' })).toBeInTheDocument();
    expect(screen.getByText('Select a credential and issue it to a user.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No credentials configured yet' })).toBeInTheDocument();
    expect(screen.getByText('Create a credential to start issuing it to users.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create credential' })).toBeInTheDocument();
    expect(screen.queryByText(/A default template is ready to use/)).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(/digital ID/i);
  });

  it('still lists credentials for selection', async () => {
    const user = renderApp('/credentials/issue?recipients=mem_0', withStudentId(baseState()));
    expect(screen.getByRole('radio', { name: /Student ID/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: /^Continue/ }));
    expect(await screen.findByRole('heading', { name: 'Review and issue' })).toBeInTheDocument();
  });
});

describe('Issue #005: Review and Issue', () => {
  it('uses credential wording, drops the wallet note, and issues directly with one record', async () => {
    const s = withStudentId(baseState(), { effectiveDate: 'custom-date' });
    const user = renderApp('/credentials/issue?recipients=mem_0&credential=ct_1&step=review&from=user', s);
    expect(await screen.findByRole('heading', { name: 'Review and issue' })).toBeInTheDocument();
    expect(screen.getByText('When this credential becomes valid.')).toBeInTheDocument();
    expect(screen.queryByText(/Seamfix Wallet|Delivery is tracked separately/)).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(/digital ID/i);
    const button = screen.getByRole('button', { name: 'Issue Credential' });
    await user.tripleClick(button);
    const done = await screen.findByRole('dialog', { name: 'Credential issued successfully' }, { timeout: 3000 });
    expect(done).toHaveTextContent('Student ID has been issued to Amara Okonkwo.');
    expect(screen.getByRole('button', { name: 'Issue Credential' })).toBeDisabled();
    expect(org().credentials).toHaveLength(1);
    await user.click(within(done).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Credentials' })).toBeInTheDocument();
    expect(org().credentials).toHaveLength(1);
  });

  it('stays on Review and Issue with a clear error when issuance fails, and allows a retry', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const base = withStudentId(baseState());
    const s: AppState = { ...base, data: { ...base.data, credentialTypes: base.data.credentialTypes.map((t) => (t.id === 'ct_1' ? { ...t, validity: { kind: 'fixed-date', date: past } } : t)) } };
    const user = renderApp('/credentials/issue?recipients=mem_0&credential=ct_1&step=review&from=user', s);
    await user.click(await screen.findByRole('button', { name: 'Issue Credential' }));
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(/expire before it becomes effective.*Nothing was issued/);
    expect(screen.queryByRole('dialog', { name: 'Credential issued successfully' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Review and issue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue Credential' })).toBeEnabled();
    expect(org().credentials).toHaveLength(0);
  });
});

describe('Issue #004: credential logo', () => {
  it('validates logos by their real contents', () => {
    expect(checkLogo(png(), 'image/png')).toEqual({ ok: true, mimeType: 'image/png', width: 64, height: 32 });
    expect(checkLogo(jpeg(), 'image/jpeg')).toEqual({ ok: true, mimeType: 'image/jpeg', width: 40, height: 20 });
    expect(checkLogo(webp(), 'image/webp')).toEqual({ ok: true, mimeType: 'image/webp', width: 100, height: 50 });
    expect(checkLogo(new TextEncoder().encode('<svg onload="x()"></svg>'), 'image/svg+xml')).toMatchObject({ ok: false, error: 'Upload a PNG, JPEG or WebP image.' });
    expect(checkLogo(new TextEncoder().encode('not really an image'), 'image/png')).toMatchObject({ ok: false, error: /isn’t a valid/ });
    expect(checkLogo(png(), 'image/jpeg')).toMatchObject({ ok: false, error: /don’t match its type/ });
    expect(checkLogo(png(8, 8), 'image/png')).toMatchObject({ ok: false, error: /too small/ });
    expect(checkLogo(png(64, 64, MAX_LOGO_BYTES), 'image/png')).toMatchObject({ ok: false, error: /512 KB or smaller/ });
    expect(checkLogo(new Uint8Array(), 'image/png')).toMatchObject({ ok: false });
  });

  it('saves logos per organization, reuses them, keeps them with the configuration and the issued credential, and blocks other organizations’ logos', () => {
    let s = baseState();
    const up = applyUploadLogo(s, { organizationId: ORG, at: AT, id: 'logo_1', name: 'crest.png', dataUrl: logoUrl() });
    if (!up.ok) throw new Error('upload failed');
    s = up.state;
    expect(s.data.logoAssets).toMatchObject([{ id: 'logo_1', organizationId: ORG, mimeType: 'image/png', width: 64, height: 32 }]);
    // The same image again is reused, not duplicated; tampered contents are refused.
    expect(applyUploadLogo(s, { organizationId: ORG, at: AT, id: 'logo_2', name: 'again.png', dataUrl: logoUrl() })).toMatchObject({ ok: true, logoAssetId: 'logo_1' });
    expect(applyUploadLogo(s, { organizationId: ORG, at: AT, id: 'logo_3', name: 'x.png', dataUrl: 'data:image/png;base64,' + btoa('hello') })).toMatchObject({ ok: false });
    s = withStudentId(s, { logoAssetId: 'logo_1' });
    expect(s.data.credentialTypes.find((t) => t.id === 'ct_1')!.logoAssetId).toBe('logo_1');
    s = ok(applyIssuance(s, { requestId: 'r1', organizationId: ORG, at: AT, memberId: 'mem_0', credentialTypeId: 'ct_1', credentialId: 'cr_1' })).state;
    expect(s.data.credentials.find((c) => c.id === 'cr_1')!.snapshot).toMatchObject({ logoAssetId: 'logo_1' });
    // Another organization can neither see nor use this logo.
    const other = s.data.organizations.find((o) => o.id !== ORG)!;
    expect(selectOrgData(s, other.id).logoAssets).toEqual([]);
    expect(applyCredentialConfig(s, { organizationId: other.id, at: AT, id: 'ct_x', name: 'Borrowed', identifierConfigId: s.data.identifierConfigs.find((i) => i.organizationId === other.id)?.id ?? 'none', templateId: 'classic-landscape', effectiveDate: 'on-issue', validity: { kind: 'no-expiry' }, renewable: true, logoAssetId: 'logo_1' }))
      .toMatchObject({ ok: false, errors: { logoAssetId: expect.stringMatching(/your organization’s saved logos/) } });
  });

  it('keeps the initials by default, previews an uploaded logo, rejects invalid files, and offers saved logos next time', async () => {
    const s = baseState();
    const initials = s.data.organizations.find((o) => o.id === ORG)!.shortName.slice(0, 3).toUpperCase();
    const user = renderApp('/credentials', s);
    await user.click(await screen.findByRole('button', { name: 'Create credential' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Choose template' })).getByRole('button', { name: /Next: Configure credential/ }));
    const drawer = screen.getByRole('dialog', { name: 'Configure credential' });
    const preview = within(drawer).getByRole('complementary', { name: 'Preview' });
    expect(within(drawer).getByRole('radio', { name: `Organization initials (${initials})` })).toHaveAttribute('aria-checked', 'true');
    expect(within(preview).getByRole('img', { name: /front/ })).toHaveTextContent(initials);

    const input = within(drawer).getByLabelText('Upload logo file');
    await user.upload(input, new File(['plain text'], 'notes.png', { type: 'image/png' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(/isn’t a valid PNG, JPEG or WebP image/);
    expect(org().logoAssets).toHaveLength(0);

    await user.upload(input, new File([png()], 'crest.png', { type: 'image/png' }));
    const option = await within(drawer).findByRole('radio', { name: 'Logo crest.png' });
    expect(option).toHaveAttribute('aria-checked', 'true');
    const card = within(preview).getByRole('img', { name: /front/ });
    expect(within(card).getByRole('img', { name: /logo$/ })).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/));
    expect(card).not.toHaveTextContent(initials);
    await user.click(within(drawer).getByRole('button', { name: 'Save credential' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Credential created successfully' })).getByRole('button', { name: "I'll do this later" }));
    const saved = org().credentialTypes[0];
    expect(saved.logoAssetId).toBe(org().logoAssets[0].id);

    // A second credential can reuse it, or keep the initials.
    await user.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Credentials' }));
    await user.click(await screen.findByRole('button', { name: /Create Credential/i }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Choose template' })).getByRole('button', { name: /Next: Configure credential/ }));
    const second = screen.getByRole('dialog', { name: 'Configure credential' });
    expect(within(second).getByRole('radio', { name: `Organization initials (${initials})` })).toHaveAttribute('aria-checked', 'true');
    expect(within(second).getByRole('radio', { name: 'Logo crest.png' })).toHaveAttribute('aria-checked', 'false');
  });
});
