import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, LayoutDashboard, UserPlus, UserRound } from 'lucide-react';
import { Button, ButtonLink, ConfirmDialog, PageHeader } from '@/components/ui';
import { IssueCredentialFlow } from '@/components/issuance/IssueCredentialFlow';
import { useOrgData } from '@/store/AppStore';
import { clearDraft, emptyDraft, hasProgress, loadDraft, saveDraft, type Draft } from './draft';
import { Stepper } from './parts';
import { StepDetails } from './StepDetails';
import { StepIdentifier } from './StepIdentifier';

const STEPS = [
  { id: 'identifier', label: 'Identifier' },
  { id: 'details', label: 'User information' },
  { id: 'credential', label: 'Digital ID (optional)' },
];

export function ManualAddUserPage() {
  const org = useOrgData();
  const orgId = org.organization.id;
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(orgId) ?? emptyDraft(orgId, org.identifierConfigs.length === 1 ? org.identifierConfigs[0].id : null));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (draft.organizationId !== orgId) setDraft(loadDraft(orgId) ?? emptyDraft(orgId));
  }, [orgId, draft.organizationId]);

  useEffect(() => { saveDraft(draft); }, [draft]);
  useEffect(() => { window.scrollTo?.(0, 0); }, [draft.phase]);
  // Leaving after the user was created ends this journey; a refresh (no unmount) keeps it.
  useEffect(() => () => {
    if (!['identifier', 'details'].includes(draftRef.current.phase)) clearDraft(draftRef.current.organizationId);
  }, []);

  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const restart = () => setDraft(emptyDraft(orgId, draft.identifierConfigId));

  const config = draft.identifierConfigId ? org.identifierConfigById.get(draft.identifierConfigId) : undefined;
  const member = draft.memberId ? org.memberById.get(draft.memberId) : undefined;

  // Recover from configuration that no longer exists (e.g. after a demo reset).
  useEffect(() => {
    if (draft.phase === 'details' && !config) update({ phase: 'identifier' });
    if (['created', 'issue', 'skipped'].includes(draft.phase) && !member) setDraft(emptyDraft(orgId));
  }, [draft.phase, config, member, orgId, update]);

  const cancel = () => (hasProgress(draft) ? setConfirmCancel(true) : navigate('/users/new'));
  const footerStart = <Button variant="ghost" onClick={cancel}>Cancel</Button>;
  const stepIndex = draft.phase === 'identifier' ? 0 : draft.phase === 'details' ? 1 : 2;

  const doneActions = (memberId: string) => (
    <>
      <ButtonLink to={`/users/${memberId}`} variant="primary" icon={<UserRound className="h-4 w-4" />}>View user</ButtonLink>
      <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={restart}>Add another user</Button>
      <ButtonLink to="/" variant="ghost" icon={<LayoutDashboard className="h-4 w-4" />}>Return to dashboard</ButtonLink>
    </>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users', to: '/users' }, { label: 'Add users', to: '/users/new' }, { label: 'Manually' }]}
        title="Add a user"
      />
      <Stepper steps={STEPS} currentIndex={stepIndex} />

      {draft.phase === 'identifier' && <StepIdentifier org={org} draft={draft} update={update} footerStart={footerStart} />}
      {draft.phase === 'details' && config && <StepDetails org={org} draft={draft} config={config} update={update} footerStart={footerStart} />}

      {(draft.phase === 'created' || draft.phase === 'skipped') && member && (
        <section aria-labelledby="added-title" className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-emerald-50/50 shadow-card">
          <div className="px-6 py-10 sm:px-10 lg:px-14 lg:py-12">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white"><CheckCircle2 className="h-6 w-6" aria-hidden="true" /></span>
            <h2 id="added-title" className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">User added successfully</h2>
            <p className="mt-2 text-lg text-slate-600">
              {draft.phase === 'created' ? 'The user has been added to your organization.' : "You can issue a digital ID for this user whenever you're ready."}
            </p>
            <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 text-sm">
              <div><dt className="text-slate-500">Name</dt><dd className="mt-0.5 font-medium text-slate-900">{member.displayName}</dd></div>
              {member.identifier && (
                <div><dt className="text-slate-500">{org.identifierConfigById.get(member.identifier.configId)?.name}</dt><dd className="mt-0.5 font-mono font-medium text-slate-900">{member.identifier.value}</dd></div>
              )}
              <div><dt className="text-slate-500">Identity</dt><dd className="mt-0.5 text-slate-900">{member.resolution === 'linked-existing' ? 'Existing ID Switch identity linked' : 'New ID Switch identity (simulated)'}</dd></div>
            </dl>

            {draft.phase === 'created' ? (
              <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6">
                <p className="text-lg font-semibold text-slate-900">Would you like to issue a digital ID?</p>
                <p className="mt-1 text-sm text-slate-500">Optional. {member.displayName.split(' ')[0]} is saved either way, and you can issue one later from their profile.</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button icon={<BadgeCheck className="h-4 w-4" />} onClick={() => update({ phase: 'issue' })}>Issue digital ID</Button>
                  <Button variant="secondary" onClick={() => update({ phase: 'skipped' })}>I'll do this later</Button>
                </div>
              </div>
            ) : (
              <div className="mt-10 flex flex-wrap gap-3">{doneActions(member.id)}</div>
            )}
          </div>
        </section>
      )}

      {draft.phase === 'issue' && member && (
        <IssueCredentialFlow memberId={member.id} cancelLabel="Back" onCancel={() => update({ phase: 'created' })}
          issuedActions={() => doneActions(member.id)} />
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Discard this user?"
        description="The details you've entered will be cleared. Identifiers and credentials you've already configured are kept."
        confirmLabel="Discard"
        tone="danger"
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => { clearDraft(orgId); setConfirmCancel(false); navigate('/users/new'); }}
      />
    </>
  );
}
