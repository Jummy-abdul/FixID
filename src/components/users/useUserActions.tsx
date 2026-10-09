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
  | { kind: 'invite'; memberId: string }
  | { kind: 'bulk'; action: BulkAction; memberIds: string[]; onDone?: () => void };

export type BulkAction = 'invite' | 'activate' | 'deactivate';

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

  /** Opens the confirmation for a bulk action; `onDone` runs after it completes (not on cancel). */
  const openBulk = useCallback((action: BulkAction, memberIds: string[], onDone?: () => void) => {
    setPending({ kind: 'bulk', action, memberIds, onDone });
  }, []);

  const dialogs = (
    <>
      <StatusDialog pending={pending?.kind === 'status' ? pending : null} onDone={() => setPending(null)} />
      <InviteDialog memberId={pending?.kind === 'invite' ? pending.memberId : null} onDone={() => setPending(null)} />
      {pending?.kind === 'bulk' && (
        <BulkDialog key={`${pending.action}:${pending.memberIds.join(',')}`} action={pending.action} memberIds={pending.memberIds}
          onCancel={() => setPending(null)} onDone={() => { const done = pending.onDone; setPending(null); done?.(); }} />
      )}
    </>
  );

  return { menuItems, dialogs, openBulk };
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
        title: resend ? 'Enrollment link resent' : 'Enrollment link sent',
        description: `An enrollment invitation has been sent to ${contact.email}.`,
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
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">{error}</p>}
    </Modal>
  );
}

const users = (n: number) => `${n} ${n === 1 ? 'user' : 'users'}`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Which of the selected users a bulk action applies to, and why the others are skipped. */
export function bulkEligibility(action: BulkAction, members: Member[], now = new Date()) {
  const eligible: Member[] = [];
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  for (const m of members) {
    if (action === 'activate') {
      if (m.status === 'inactive') eligible.push(m);
      else skip(m.status === 'active' ? 'Already active' : 'Still being onboarded');
    } else if (action === 'deactivate') {
      if (m.status === 'active') eligible.push(m);
      else skip(m.status === 'inactive' ? 'Already inactive' : 'Still being onboarded');
    } else {
      const e = enrollmentInviteEligibility(m, now);
      if (e.ok) eligible.push(m);
      else if (m.faceEnrollment.status === 'enrolled') skip('Already enrolled');
      else if (m.status !== 'active') skip('Not active');
      else skip('Link sent less than a minute ago');
    }
  }
  return { eligible, skipped };
}

function BulkDialog({ action, memberIds, onCancel, onDone }: { action: BulkAction; memberIds: string[]; onCancel: () => void; onDone: () => void }) {
  const { organization, memberById } = useOrgData();
  const { setMemberStatus, recordEnrollmentInvite } = useActions();
  const { enrollment, idSwitch } = useServices();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const selected = memberIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m);
  // Computed once when the dialog opens so the counts don't shift while it's in progress.
  const [{ eligible, skipped }] = useState(() => bulkEligibility(action, selected));
  const [emails, setEmails] = useState<Map<string, string> | 'loading' | 'error'>(action === 'invite' ? 'loading' : new Map());

  useEffect(() => {
    if (action !== 'invite') return;
    let cancelled = false;
    idSwitch.getContacts(eligible.map((m) => m.idSwitchId))
      .then((map) => {
        if (cancelled) return;
        const out = new Map<string, string>();
        for (const m of eligible) {
          const email = map.get(m.idSwitchId)?.email?.trim();
          if (email && EMAIL.test(email)) out.set(m.id, email);
        }
        setEmails(out);
      })
      .catch(() => { if (!cancelled) setEmails('error'); });
    return () => { cancelled = true; };
  }, [action, eligible, idSwitch]);

  const reachable = action === 'invite' && emails instanceof Map ? eligible.filter((m) => emails.has(m.id)) : eligible;
  const noEmail = action === 'invite' && emails instanceof Map ? eligible.length - reachable.length : 0;
  const skips = [...skipped.entries(), ...(noEmail ? [['No email address', noEmail] as [string, number]] : [])];
  const count = reachable.length;

  const copy = {
    invite: { title: 'Send enrollment links?', confirm: 'Send Links', tone: 'primary' as const, body: `Enrollment links will be sent to ${count} selected ${count === 1 ? 'user' : 'users'}.` },
    activate: { title: 'Activate users?', confirm: 'Activate Users', tone: 'primary' as const, body: `${users(count)} will be activated.` },
    deactivate: { title: 'Deactivate users?', confirm: 'Deactivate Users', tone: 'danger' as const, body: `${users(count)} will be deactivated.` },
  }[action];

  const loading = action === 'invite' && emails === 'loading';
  let description: string;
  if (loading) description = 'Checking the selected users…';
  else if (emails === 'error') description = "Contact details couldn't be loaded right now. Nothing was sent.";
  else if (count === 0) description = `None of the ${users(selected.length)} selected can receive this action.`;
  else description = copy.body;

  const run = async () => {
    setBusy(true);
    const at = () => new Date().toISOString();
    let ok = 0;
    let failed = 0;
    if (action === 'invite' && emails instanceof Map) {
      for (const m of reachable) {
        try {
          const inv = await enrollment.sendInvitation({ memberId: m.id, name: m.displayName, email: emails.get(m.id)! });
          const r = recordEnrollmentInvite({ organizationId: organization.id, memberId: m.id, invitationId: inv.invitationId, sentTo: inv.sentTo, at: at() });
          if (r.ok) ok += 1; else failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (ok) toast({ tone: 'success', title: 'Enrollment invitations sent', description: `Enrollment invitations have been sent to ${users(ok)}.` });
    } else {
      const status = action === 'activate' ? 'active' : 'inactive';
      for (const m of reachable) {
        const r = setMemberStatus({ organizationId: organization.id, memberId: m.id, status, at: at() });
        if (r.ok) ok += 1; else failed += 1;
      }
      if (ok) toast({ tone: 'success', title: `${users(ok)} ${action === 'activate' ? 'activated' : 'deactivated'}` });
    }
    if (failed) toast({ tone: 'error', title: `${users(failed)} couldn't be updated`, description: 'Nothing else was changed for them.' });
    setBusy(false);
    onDone();
  };

  return (
    <Modal open onClose={busy ? () => {} : onCancel} size="sm" title={copy.title} description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{count > 0 && !loading ? 'Cancel' : 'Close'}</Button>
          {count > 0 && !loading && emails !== 'error' && <Button variant={copy.tone} onClick={run} loading={busy}>{copy.confirm}</Button>}
        </>
      }>
      {!loading && skips.length > 0 && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          <p className="font-medium text-slate-800">Skipped</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {skips.map(([reason, n]) => <li key={reason}>{reason}: {users(n)}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
