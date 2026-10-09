import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Send, UserCheck, UserX } from 'lucide-react';
import { Button, ConfirmDialog, Modal, useToast, type OverflowMenuItem } from '@/components/ui';
import type { Member } from '@/domain/types';
import { useServices } from '@/services/ServicesProvider';
import { useActions, useOrgData } from '@/store/AppStore';
import { enrollmentInviteEligibility } from '@/store/operations';

type Pending =
  | { kind: 'status'; memberId: string; next: 'active' | 'inactive' }
  | { kind: 'invite'; memberId: string };

type Contact = { status: 'loading' } | { status: 'ready'; email: string } | { status: 'missing' } | { status: 'error' };

/** Row actions for a user (view, activate/deactivate, enrollment link) and the confirmations they open. */
export function useUserActions() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);

  const menuItems = useCallback((m: Member): OverflowMenuItem[] => {
    const items: OverflowMenuItem[] = [
      { key: 'view', label: 'View Details', icon: <Eye className="h-4 w-4" />, onSelect: () => navigate(`/users/${m.id}`) },
    ];
    if (m.status === 'active') {
      items.push({ key: 'status', label: 'Deactivate User', tone: 'danger', icon: <UserX className="h-4 w-4" />, onSelect: () => setPending({ kind: 'status', memberId: m.id, next: 'inactive' }) });
    } else if (m.status === 'inactive') {
      items.push({ key: 'status', label: 'Activate User', icon: <UserCheck className="h-4 w-4" />, onSelect: () => setPending({ kind: 'status', memberId: m.id, next: 'active' }) });
    }
    // Enrolled users never get a link here; re-enrollment is designed separately.
    if (m.status === 'active' && m.faceEnrollment.status !== 'enrolled') {
      const resend = m.faceEnrollment.status === 'pending' && !!m.faceEnrollment.invitation;
      items.push({ key: 'invite', label: resend ? 'Resend Enrollment Link' : 'Send Enrollment Link', icon: <Send className="h-4 w-4" />, onSelect: () => setPending({ kind: 'invite', memberId: m.id }) });
    }
    return items;
  }, [navigate]);

  const dialogs = (
    <>
      <StatusDialog pending={pending?.kind === 'status' ? pending : null} onDone={() => setPending(null)} />
      <InviteDialog memberId={pending?.kind === 'invite' ? pending.memberId : null} onDone={() => setPending(null)} />
    </>
  );

  return { menuItems, dialogs };
}

function StatusDialog({ pending, onDone }: { pending: Extract<Pending, { kind: 'status' }> | null; onDone: () => void }) {
  const { organization, memberById } = useOrgData();
  const { setMemberStatus } = useActions();
  const toast = useToast();
  const member = pending ? memberById.get(pending.memberId) : undefined;
  const activating = pending?.next === 'active';

  return (
    <ConfirmDialog
      open={!!member}
      title={activating ? 'Activate user?' : 'Deactivate user?'}
      description={member ? `Are you sure you want to ${activating ? 'activate' : 'deactivate'} ${member.displayName}?` : ''}
      confirmLabel={activating ? 'Activate User' : 'Deactivate User'}
      tone={activating ? 'primary' : 'danger'}
      onCancel={onDone}
      onConfirm={() => {
        if (!member || !pending) return;
        const r = setMemberStatus({ organizationId: organization.id, memberId: member.id, status: pending.next, at: new Date().toISOString() });
        onDone();
        if (!r.ok) toast({ tone: 'error', title: 'Nothing was changed', description: Object.values(r.errors)[0] });
        else toast({ tone: 'success', title: `${member.displayName} ${activating ? 'activated' : 'deactivated'}` });
      }}
    />
  );
}

function InviteDialog({ memberId, onDone }: { memberId: string | null; onDone: () => void }) {
  const { organization, memberById } = useOrgData();
  const { recordEnrollmentInvite } = useActions();
  const { enrollment, idSwitch } = useServices();
  const toast = useToast();
  const member = memberId ? memberById.get(memberId) : undefined;
  const [contact, setContact] = useState<Contact>({ status: 'loading' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const idSwitchId = member?.idSwitchId;
  useEffect(() => {
    if (!idSwitchId) return;
    let cancelled = false;
    setContact({ status: 'loading' });
    setError(null);
    idSwitch.getContacts([idSwitchId])
      .then((map) => {
        if (cancelled) return;
        const email = map.get(idSwitchId)?.email?.trim();
        setContact(email ? { status: 'ready', email } : { status: 'missing' });
      })
      .catch(() => { if (!cancelled) setContact({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [idSwitchId, idSwitch, attempt]);

  if (!member) return null;
  const eligibility = enrollmentInviteEligibility(member);
  const resend = eligibility.ok && eligibility.resend;

  const send = async () => {
    if (contact.status !== 'ready' || sending) return;
    setSending(true);
    setError(null);
    try {
      const inv = await enrollment.sendInvitation({ memberId: member.id, name: member.displayName, email: contact.email });
      const r = recordEnrollmentInvite({ organizationId: organization.id, memberId: member.id, invitationId: inv.invitationId, sentTo: inv.sentTo, at: new Date().toISOString() });
      if (!r.ok) { setError(Object.values(r.errors)[0] ?? 'The enrollment link could not be created.'); return; }
      onDone();
      toast({
        tone: 'success',
        title: resend ? 'Enrollment link resent' : 'Enrollment link created',
        description: `Simulated: no email was sent. Portrait enrollment for ${member.displayName} is now pending.`,
      });
    } catch (err) {
      setError((err as Error).message || 'The enrollment link could not be created. Nothing was changed.');
    } finally {
      setSending(false);
    }
  };

  const blocked = !eligibility.ok ? eligibility.reason : null;
  let body: React.ReactNode;
  if (blocked) body = blocked;
  else if (contact.status === 'loading') body = 'Checking the email address on record…';
  else if (contact.status === 'missing') body = `${member.displayName} has no email address on record, so an enrollment link can't be sent.`;
  else if (contact.status === 'error') body = "Contact details couldn't be loaded right now. Nothing was sent.";
  else body = resend
    ? `A new enrollment link will be sent to ${member.displayName} at ${contact.email} to complete their portrait enrollment. The previous link will stop working.`
    : `An enrollment link will be sent to ${member.displayName} at ${contact.email} to complete their portrait enrollment.`;

  const canSend = !blocked && contact.status === 'ready';
  return (
    <Modal open onClose={sending ? () => {} : onDone} size="sm" title={resend ? 'Resend enrollment link?' : 'Send enrollment link?'} description={body}
      footer={
        <>
          <Button variant="secondary" onClick={onDone} disabled={sending}>{canSend ? 'Cancel' : 'Close'}</Button>
          {contact.status === 'error' && !blocked && <Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}
          {canSend && <Button onClick={send} loading={sending} icon={sending ? undefined : <Send className="h-4 w-4" />}>{resend ? 'Resend Link' : 'Send Link'}</Button>}
        </>
      }>
      {canSend && <p className="text-xs text-slate-500">Prototype: the link is recorded but no email is delivered.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
    </Modal>
  );
}
