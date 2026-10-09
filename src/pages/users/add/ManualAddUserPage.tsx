import { useAuthorization } from '@/auth/authorization';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, CheckCircle2 } from 'lucide-react';
import { Button, ConfirmDialog, Modal, PageHeader, useToast } from '@/components/ui';
import { assignUrl } from '@/components/issuance/assignment';
import { useOrgData } from '@/store/AppStore';
import { clearDraft, emptyDraft, hasProgress, loadDraft, saveDraft, type Draft } from './draft';
import { Stepper } from './parts';
import { StepDetails } from './StepDetails';
import { StepIdentifier } from './StepIdentifier';

const STEPS = [
  { id: 'identifier', label: 'Identifier' },
  { id: 'details', label: 'User information' },
  { id: 'create', label: 'Create user' },
];

export function ManualAddUserPage() {
  const org = useOrgData();
  const orgId = org.organization.id;
  const navigate = useNavigate();
  const toast = useToast();
  const canIssue = useAuthorization().can('credentials.issue');
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

  const config = draft.identifierConfigId ? org.identifierConfigById.get(draft.identifierConfigId) : undefined;
  const member = draft.memberId ? org.memberById.get(draft.memberId) : undefined;

  // Recover from configuration that no longer exists (e.g. after a demo reset).
  useEffect(() => {
    if (draft.phase === 'details' && !config) update({ phase: 'identifier' });
    if (draft.phase === 'created' && !member) setDraft(emptyDraft(orgId));
  }, [draft.phase, config, member, orgId, update]);

  const cancel = () => (hasProgress(draft) ? setConfirmCancel(true) : navigate('/users/new'));
  const footerStart = <Button variant="ghost" onClick={cancel}>Cancel</Button>;
  const stepIndex = draft.phase === 'identifier' ? 0 : draft.phase === 'details' ? 1 : STEPS.length;

  const finish = (issue: boolean) => {
    if (!member) return;
    clearDraft(orgId);
    if (issue) {
      navigate(assignUrl({ recipientIds: [member.id], from: 'new-user' }));
    } else {
      toast({ tone: 'success', title: `${member.displayName} added`, description: 'You can issue a digital ID from their profile at any time.' });
      navigate('/users');
    }
  };
  const memberIdentifier = member?.identifier;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Users', to: '/users' }, { label: 'Add users', to: '/users/new' }, { label: 'Manually' }]}
        title="Add a user"
      />
      <Stepper steps={STEPS} currentIndex={stepIndex} />

      {draft.phase === 'identifier' && <StepIdentifier org={org} draft={draft} update={update} footerStart={footerStart} />}
      {draft.phase === 'details' && config && <StepDetails org={org} draft={draft} config={config} update={update} footerStart={footerStart} />}
      {draft.phase === 'created' && member && (
        <section aria-label="User created" className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-card">
          <p className="font-semibold text-slate-900">{member.displayName} has been added.</p>
        </section>
      )}

      <Modal open={draft.phase === 'created' && !!member} onClose={() => finish(false)} size="sm"
        title={<span className="flex flex-col gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500 text-white"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /></span>User created successfully</span>}
        description={member && `${member.displayName} has been added to your organization.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => finish(false)}>Not now</Button>
            {canIssue && <Button icon={<BadgeCheck className="h-4 w-4" />} onClick={() => finish(true)}>Yes, issue ID</Button>}
          </>
        }>
        {member && memberIdentifier && (
          <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200">
            <p className="text-xs text-slate-500">{org.identifierConfigById.get(memberIdentifier.configId)?.name}</p>
            <p className="font-mono text-base font-semibold text-slate-900">{memberIdentifier.value}</p>
          </div>
        )}
        <p className="mt-4 text-sm font-medium text-slate-900">Would you like to issue a digital ID for this user?</p>
      </Modal>

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
