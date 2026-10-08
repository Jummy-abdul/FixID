import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ConfirmDialog, PageHeader } from '@/components/ui';
import { DigitalIdCard } from '@/components/domain/DigitalIdCard';
import { formatIdentifier } from '@/lib/identifiers';
import { computeValidity, previewIdentifier } from '@/services/issuance';
import { useOrgData } from '@/store/AppStore';
import { clearDraft, emptyDraft, hasProgress, loadDraft, saveDraft, type Draft } from './draft';
import { IssuedSuccess } from './IssuedSuccess';
import { Stepper } from './parts';
import { StepCredential, toValidity } from './StepCredential';
import { StepDetails } from './StepDetails';
import { StepIdentity } from './StepIdentity';
import { StepReview } from './StepReview';
import { StepUserType } from './StepUserType';

export function ManualAddUserPage() {
  const org = useOrgData();
  const orgId = org.organization.id;
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(orgId) ?? emptyDraft(orgId));
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Switching organization (demo setting) starts a separate draft.
  useEffect(() => {
    if (draft.organizationId !== orgId) setDraft(loadDraft(orgId) ?? emptyDraft(orgId));
  }, [orgId, draft.organizationId]);

  useEffect(() => {
    if (draft.step === 'done') clearDraft(draft.organizationId);
    else saveDraft(draft);
  }, [draft]);

  useEffect(() => { window.scrollTo?.(0, 0); }, [draft.step]);

  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);

  const userType = draft.userType && 'id' in draft.userType ? org.userTypes.find((u) => u.id === (draft.userType as { id: string }).id) : undefined;
  const userTypeName = userType?.name ?? (draft.userType && 'name' in draft.userType ? draft.userType.name : '');
  const type = draft.credentialTypeId ? org.credentialTypeById.get(draft.credentialTypeId) : undefined;

  // A step that depends on missing configuration falls back to the right place (e.g. after a demo reset).
  useEffect(() => {
    if (['details', 'identity', 'review'].includes(draft.step) && (!type || !userType)) update({ step: draft.userType ? 'credential' : 'type' });
    if (draft.step === 'credential' && (!draft.userType || !draft.credentialForm)) update({ step: 'type' });
  }, [draft.step, draft.userType, draft.credentialForm, type, userType, update]);

  const cancel = () => (hasProgress(draft) ? setConfirmCancel(true) : navigate('/users/new'));
  const footerStart = <Button variant="ghost" onClick={cancel}>Cancel</Button>;

  // Live preview of what will be issued.
  const form = draft.credentialChoice === 'new' && !type ? draft.credentialForm : null;
  const previewType = type ?? (typeof draft.credentialChoice === 'object' && draft.credentialChoice ? org.credentialTypeById.get(draft.credentialChoice.existingId) : undefined);
  const designId = form?.cardDesignId ?? previewType?.cardDesignId ?? org.organization.defaultCardDesignId;
  const design = org.cardDesignById.get(designId) ?? org.cardDesignById.get(org.organization.defaultCardDesignId)!;
  const name = `${draft.person.givenName} ${draft.person.familyName}`.trim();
  const identifier = form
    ? (form.identifierMode === 'generated' ? formatIdentifier(form.prefix.toUpperCase(), form.digits, 1) : form.identifierLabel)
    : previewType
      ? (previewType.identifier.mode === 'manual' ? draft.person.identifier || previewType.identifier.label : previewIdentifier(previewType)!)
      : 'ID number';
  const expiresAt = previewType
    ? computeValidity(previewType, new Date()).expiresAt
    : form ? computeValidity({ effectiveDate: 'on-issue', validity: toValidity(form) }, new Date()).expiresAt : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users', to: '/users' }, { label: 'Add user', to: '/users/new' }, { label: 'Manually' }]}
        title={draft.step === 'done' ? 'User added' : org.members.length === 0 ? 'Add your first user' : 'Add a user'}
      />

      {draft.step === 'done' && draft.issued ? (
        <IssuedSuccess org={org} credentialId={draft.issued.credentialId} memberId={draft.issued.memberId}
          onAddAnother={() => setDraft(emptyDraft(orgId))} />
      ) : (
        <>
          <Stepper current={draft.step} reusedCredential={draft.reusedCredential} onSelect={(step) => update({ step })} />
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
            <div className="min-w-0 xl:col-span-8">
              {draft.step === 'type' && <StepUserType org={org} draft={draft} onContinue={update} footerStart={footerStart} />}
              {draft.step === 'credential' && draft.credentialForm && draft.userType && (
                <StepCredential org={org} draft={draft} userTypeName={userTypeName} update={update} footerStart={footerStart} />
              )}
              {draft.step === 'details' && type && userType && (
                <StepDetails org={org} draft={draft} type={type} userTypeName={userTypeName} update={update} footerStart={footerStart} />
              )}
              {draft.step === 'identity' && type && userType && (
                <StepIdentity org={org} draft={draft} type={type} update={update} footerStart={footerStart} />
              )}
              {draft.step === 'review' && type && userType && (
                <StepReview org={org} draft={draft} type={type} userTypeName={userTypeName} update={update} footerStart={footerStart}
                  onIssued={(issued) => setDraft((d) => ({ ...d, issued, step: 'done' }))} />
              )}
            </div>
            <aside className="xl:col-span-4" aria-label="Digital ID preview">
              <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
                <p className="text-sm font-semibold text-slate-900">Digital ID preview</p>
                <p className="mt-0.5 text-xs text-slate-500">{design.name}{previewType ? ` · ${previewType.name}` : form ? ` · ${form.name || 'New credential'}` : ''}</p>
                <div className="mt-5 flex justify-center overflow-hidden">
                  <div className="origin-top scale-[0.85] sm:scale-100 xl:scale-[0.82] 2xl:scale-100">
                    <DigitalIdCard design={design} organization={org.organization} content={{
                      name: name || 'Full name',
                      identifier,
                      identifierLabel: form?.identifierLabel || previewType?.identifier.label,
                      credentialTypeName: previewType?.name ?? form?.name ?? 'Digital ID',
                      relationship: userTypeName || org.organization.memberLabel,
                      expiresAt: expiresAt ? expiresAt.toISOString() : null,
                      photoUrl: draft.person.photoDataUrl,
                    }} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">Preview. The final identifier and dates are set when the ID is issued.</p>
              </div>
            </aside>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Discard this user?"
        description="The details you've entered for this person will be cleared. Any credential settings you've already saved are kept."
        confirmLabel="Discard"
        tone="danger"
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => { clearDraft(orgId); setConfirmCancel(false); navigate('/users/new'); }}
      />
    </>
  );
}
