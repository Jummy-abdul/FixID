import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Lock, Repeat, ShieldAlert } from 'lucide-react';
import { Button, Card, ConfirmDialog, Field, Input, PageHeader, Select, Textarea, useToast } from '@/components/ui';
import { useAuthorization } from '@/auth/authorization';
import { DecisionBadge, sourceName } from '@/components/verification/transactionParts';
import {
  CATEGORY_LABEL, EXCEPTION_ACTION_LABEL, EXCEPTION_REASON_LABEL, EXCEPTION_STATUS_LABEL, FINAL_OUTCOMES, RESOLUTION_LABEL, categoryOf, isUnresolved, outcomesFor,
  type ResolutionOutcome, type VerificationException,
} from '@/domain/exceptions';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import {
  approvalRequired, exceptionFor, exceptionSubject, exceptionsVisibleTo, informationProblem, resolutionProblem, reviewProblem, reviewersFor,
} from '@/store/exceptionOps';
import { ExceptionEvidence } from './ExceptionEvidence';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { useVerificationService } from '@/verification/useVerificationService';
import { ExceptionStatusBadge } from './ExceptionsPage';


/**
 * One exception, for review. Shows why it exists, the verification steps that were recorded (never raw
 * biometric data), the review history and the resolution. Actions appear only for authorized reviewers in
 * the organization the exception is routed to; everyone else sees it read-only.
 */
export function ExceptionDetailPage() {
  const { exceptionId = '' } = useParams();
  const { organization } = useSession();
  const { state } = useStore();
  const { recordAccessDenied } = useActions();
  const e = exceptionsVisibleTo(state, organization.id).find((x) => x.id === exceptionId);
  const existsElsewhere = !e && !!exceptionFor(state, exceptionId);
  useEffect(() => { if (existsElsewhere) recordAccessDenied(organization.id, 'exception', exceptionId); }, [existsElsewhere, organization.id, exceptionId, recordAccessDenied]);
  if (!e) {
    return (
      <Card className="px-6 py-10 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Exception not available</h1>
        <p className="mt-1 text-slate-500">It doesn’t exist, or it isn’t within {organization.name}’s scope.</p>
        <Link to="/exceptions" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">Back to Exceptions</Link>
      </Card>
    );
  }
  return <Detail key={e.id} e={e} />;
}

const OUTCOME_HELP: Record<ResolutionOutcome, string> = {
  'verification-confirmed': 'The available evidence supports the person’s identity. Eligibility is still decided by the activity’s rules.',
  'verification-not-confirmed': 'The available evidence isn’t enough to establish who the person is.',
  'reverification-required': 'Another attempt is needed, for example because image quality or the evidence was inadequate.',
  escalated: 'The case needs further investigation before it can be decided.',
  'unable-to-resolve': 'The technical issue can’t be resolved; no identity decision is made.',
};

function Detail({ e }: { e: VerificationException }) {
  const { organization } = useSession();
  const { state } = useStore();
  const { can, record } = useAuthorization();
  const actions = useActions();
  const service = useVerificationService();
  const toast = useToast();
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [refs, setRefs] = useState('');
  const [infoRequest, setInfoRequest] = useState('');
  const category = categoryOf(e.reason);
  const options = outcomesFor(category);
  const [outcome, setOutcome] = useState<ResolutionOutcome | ''>('');
  const [reason, setReason] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [confirm, setConfirm] = useState<'decide' | 'approve' | 'reject' | 'return' | 'reopen' | 'close' | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [reviewerId, setReviewerId] = useState('');
  const tx = state.data.verificationAttempts.find((a) => a.id === e.transactionId);
  const who = exceptionSubject(state, e);
  const reverifications = state.data.verificationAttempts.filter((a) => e.reverificationTransactionIds.includes(a.id));
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const cannot = reviewProblem(state, organization.id, e);
  const reviewing = e.reviewOrganizationId === organization.id;
  const canReview = !cannot;
  const canApprove = reviewing && can('exceptions.approve');
  const canResolve = reviewing && can('exceptions.resolve');
  const canReopen = reviewing && can('exceptions.reopen');
  // A participating organization answers the owner's information request; it never records the decision.
  const canInform = !canReview && !informationProblem(state, organization.id, e);
  const required = approvalRequired(state, e.reviewOrganizationId);
  const reviewers = reviewersFor(state, e);
  const me = record;
  const ownProposal = !!e.proposal && e.proposal.byId === me?.id;
  const resolutionBlock = outcome ? resolutionProblem(state, e, outcome) : null;
  const final = !!outcome && FINAL_OUTCOMES.includes(outcome);
  const blockedFinal = final && !required && !canResolve;
  const canDecide = canReview && isUnresolved(e) && e.status !== 'pending-approval';
  const lastReturn = [...e.history].reverse().find((h) => h.action === 'proposal-returned' || h.action === 'proposal-rejected');
  // Reverification runs in the transaction's own organization, by a verifier assigned to the activity.
  const canReverify = !!e.reverificationRequested && organization.id === e.organizationId && service.authorize(organization.id, e.activityId).ok;

  const done = (r: { ok: boolean; error?: string }, title: string, after?: () => void) => {
    if (r.ok) { toast({ tone: 'success', title }); after?.(); } else toast({ tone: 'error', title: 'Nothing was changed', description: r.error });
  };
  const startReverification = () => {
    const r = service.startAttempt(organization.id, e.activityId, { reverificationOf: e.id });
    if (!r.ok) return toast({ tone: 'error', title: 'Reverification can’t start', description: r.error });
    navigate(`/verify/attempts/${r.attempt.id}`);
  };
  const decide = () => {
    setShowErrors(true);
    if (!outcome || !reason.trim() || resolutionBlock || blockedFinal) return;
    if (final) { setConfirm('decide'); return; }
    submitDecision();
  };
  const submitDecision = () => {
    if (!outcome) return;
    setConfirm(null);
    const label = outcome === 'escalated' ? 'Exception escalated' : outcome === 'reverification-required' ? 'Another attempt requested'
      : required ? 'Submitted for approval' : 'Exception resolved';
    done(actions.resolveException(organization.id, e.id, outcome, reason), label, () => { setReason(''); setOutcome(''); setShowErrors(false); });
  };
  const respond = (decision: 'approve' | 'reject' | 'return') => {
    setConfirm(null);
    done(actions.decideExceptionProposal(organization.id, e.id, decision, approvalNote),
      { approve: 'Decision approved', reject: 'Proposal rejected: the case is back with the reviewer', return: 'Returned for further review' }[decision], () => setApprovalNote(''));
  };

  return (
    <>
      <PageHeader title={<span className="font-mono">{e.id}</span>} breadcrumbs={[{ label: 'Exceptions', to: '/exceptions' }, { label: e.id }]} meta={<ExceptionStatusBadge status={e.status} />}
        description={`${EXCEPTION_REASON_LABEL[e.reason]} · ${CATEGORY_LABEL[category]} · ${e.activityName}`} />
      {!canReview && !canApprove && (
        <p className="mb-6 flex gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />{canInform ? 'The activity owner records the decision.' : <>Read-only. {cannot}</>}
        </p>
      )}
      {e.status === 'returned' && lastReturn && (
        <p role="status" className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-inset ring-red-200">
          <span className="font-semibold">{lastReturn.action === 'proposal-rejected' ? 'Proposal rejected' : 'Returned for further review'}</span> by {lastReturn.actorName} on {formatDateTime(lastReturn.at)}: {lastReturn.comment}
          <span className="block">The case is unresolved. Revise the decision and submit it again.</span>
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="px-5 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Summary</h2>
            <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Exception summary">
              <Row label="Participant">{who.name} <span className="font-mono text-xs text-slate-500">{who.identifier}</span></Row>
              <Row label="Activity"><Link to={`/verification-activities/${e.activityId}`} className="text-brand-700 hover:underline">{e.activityName}</Link></Row>
              <Row label="Exception reason">{EXCEPTION_REASON_LABEL[e.reason]}<span className="block text-xs text-slate-500">{e.reasonDetail}</span></Row>
              <Row label="Raised">{formatDateTime(e.createdAt)}</Row>
              <Row label="Originating verifier">{tx?.verifierName ?? '—'}</Row>
              <Row label="Identity source">{tx ? sourceName(tx) : '—'}</Row>
              <Row label="Original automated outcome"><DecisionBadge decision={tx?.decision} />{tx?.decisionExplanation && <span className="block text-xs text-slate-500">{tx.decisionExplanation}</span>}</Row>
              <Row label="Verification record"><span className="font-mono text-xs">{e.transactionId}</span></Row>
              <Row label="Organization">{orgName(e.organizationId)}{e.route === 'owner' ? <span className="block text-xs text-slate-500">Reviewed by {orgName(e.reviewOrganizationId)} (activity owner)</span> : null}</Row>
              <Row label="Status"><ExceptionStatusBadge status={e.status} /></Row>
              <Row label="Reviewer">{e.assignedReviewerName ?? 'Unassigned'}</Row>
              <Row label="Approval">{e.approval ? `Approved by ${e.approval.by}, ${formatDateTime(e.approval.at)}` : e.status === 'pending-approval' ? 'Awaiting approver' : required ? 'Required for final decisions' : 'Not required'}</Row>
            </dl>
            {tx?.reviewDisposition && <p className="mt-3 text-sm text-slate-600">After review: <DecisionBadge decision={tx.reviewDisposition.decision} /> The original outcome above is kept unchanged.</p>}
          </Card>

          <ExceptionEvidence e={e} tx={tx} canView={canReview || canApprove} onView={() => { actions.recordEvidenceViewed(organization.id, e.id); }} />

          {(reverifications.length > 0 || e.reverificationRequested) && (
            <Card className="px-5 py-5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Repeat className="h-4 w-4 text-slate-400" aria-hidden="true" />Follow-up verification</h2>
              {e.reverificationRequested && <p className="mt-1 text-sm text-slate-600">Another attempt was requested by {e.reverificationRequested.by} on {formatDateTime(e.reverificationRequested.at)}. It’s a new record with all the activity’s mandatory checks; the original stays unchanged.</p>}
              {reverifications.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Reverification transactions">
                  {reverifications.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                      <span className="font-mono text-xs">{r.id}</span><span className="flex-1" />
                      {r.status === 'in-progress' ? <span className="text-slate-500">In progress</span> : <DecisionBadge decision={r.decision} />}
                    </li>
                  ))}
                </ul>
              )}
              {canReverify && <Button className="mt-3" icon={<Repeat className="h-4 w-4" />} onClick={startReverification}>Start Reverification</Button>}
              {e.reverificationRequested && !canReverify && <p className="mt-2 text-xs text-slate-500">An assigned verifier in {orgName(e.organizationId)} performs the new attempt.</p>}
            </Card>
          )}

          {(e.resolution || (e.previousResolutions?.length ?? 0) > 0) && (
            <Card className="px-5 py-5">
              <h2 className="text-sm font-semibold text-slate-900">Resolution</h2>
              {e.resolution && (
                <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Resolution">
                  <Row label="Decision">{RESOLUTION_LABEL[e.resolution.outcome]}</Row>
                  <Row label="Final verification state">{e.resolution.disposition === 'pending-review' ? 'Pending' : <DecisionBadge decision={e.resolution.disposition} />}</Row>
                  <Row label="Reason">{e.resolution.reason}</Row>
                  <Row label="Decided by">{e.resolution.by}, {formatDateTime(e.resolution.at)}{e.approval ? <span className="block text-xs text-slate-500">Approved by {e.approval.by}</span> : null}</Row>
                  {e.resolution.outcome === 'verification-confirmed' && tx?.eligibilityStatus === 'ineligible' && <p className="sm:col-span-2 text-xs text-slate-600">Identity was confirmed, but the person isn’t eligible for this activity, so the final state is Not verified.</p>}
                </dl>
              )}
              {e.previousResolutions?.map((r) => <p key={r.at} className="mt-3 text-xs text-slate-500">Earlier: {RESOLUTION_LABEL[r.outcome]} by {r.by}, {formatDateTime(r.at)} (reopened since).</p>)}
            </Card>
          )}

          <Card className="px-5 py-5">
            <h2 className="text-sm font-semibold text-slate-900">History</h2>
            <ol className="mt-3 space-y-3" aria-label="Review history">
              {[...e.history].reverse().map((h) => (
                <li key={h.id} className="rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-inset ring-slate-200">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-900">{EXCEPTION_ACTION_LABEL[h.action]}</span>
                    {h.fromStatus && h.toStatus && h.fromStatus !== h.toStatus && <span className="text-xs text-slate-500">{EXCEPTION_STATUS_LABEL[h.fromStatus]} → {EXCEPTION_STATUS_LABEL[h.toStatus]}</span>}</p>
                  <p className="text-xs text-slate-500">{h.actorName} · {orgName(h.actorOrganizationId)} · {formatDateTime(h.at)}</p>
                  {h.comment && <p className="mt-1 whitespace-pre-line text-slate-700">{h.comment}</p>}
                  {h.evidenceRefs?.length ? <p className="mt-1 text-xs text-slate-500">Evidence references: {h.evidenceRefs.join(', ')}</p> : null}
                  {h.transactionId && h.action.startsWith('reverification') && <p className="mt-1 font-mono text-xs text-slate-500">{h.transactionId}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          {e.status === 'pending-approval' && e.proposal && (
            <Card className="space-y-3 px-5 py-5" aria-label="Approval">
              <h2 className="text-sm font-semibold text-slate-900">Awaiting approval</h2>
              <dl className="space-y-2 text-sm">
                <Row label="Proposed decision">{RESOLUTION_LABEL[e.proposal.outcome]}</Row>
                <Row label="Justification">{e.proposal.reason}</Row>
                <Row label="Submitted by">{e.proposal.by}, {formatDateTime(e.proposal.at)}</Row>
              </dl>
              {!canApprove ? <p className="text-xs text-slate-500">An authorised approver decides this proposal.</p>
                : ownProposal ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">You submitted this proposal, so a different approver must decide it.</p>
                  : (
                    <>
                      <Field label="Approver’s note" hint="Required to reject or return.">{(p) => <Textarea {...p} rows={3} value={approvalNote} onChange={(x) => setApprovalNote(x.target.value)} />}</Field>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => setConfirm('approve')}>Approve</Button>
                        <Button variant="secondary" disabled={!approvalNote.trim()} onClick={() => setConfirm('return')}>Return for review</Button>
                        <Button variant="ghost" disabled={!approvalNote.trim()} onClick={() => setConfirm('reject')}>Reject</Button>
                      </div>
                    </>
                  )}
            </Card>
          )}

          {canDecide && (
            <Card className="space-y-3 px-5 py-5" aria-label="Review decision">
              <h2 className="text-sm font-semibold text-slate-900">Review decision</h2>
              <fieldset className="space-y-2" aria-label="Outcome">
                {options.map((o) => (
                  <label key={o} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm', outcome === o ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50')}>
                    <input type="radio" name="outcome" className="mt-0.5" checked={outcome === o} onChange={() => setOutcome(o)} />
                    <span><span className="block font-medium text-slate-900">{RESOLUTION_LABEL[o]}</span><span className="text-xs text-slate-500">{OUTCOME_HELP[o]}</span></span>
                  </label>
                ))}
              </fieldset>
              {showErrors && !outcome && <p className="text-xs text-red-700">Choose an outcome.</p>}
              {resolutionBlock && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">{resolutionBlock}</p>}
              {blockedFinal && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">Your role can’t resolve exceptions. Request another attempt or escalate instead, or ask someone permitted to resolve them.</p>}
              <Field label={outcome === 'reverification-required' || outcome === 'escalated' ? 'What’s needed next' : 'Reason'} error={showErrors && !reason.trim() ? 'Enter a reason.' : undefined}>
                {(p) => <Textarea {...p} rows={3} value={reason} onChange={(x) => setReason(x.target.value)} />}
              </Field>
              {final && required && <p className="text-xs text-slate-600">Approval is required: this decision is submitted to a different authorised approver before it’s final.</p>}
              <p className="text-xs text-slate-500">The original automated outcome is kept. Confirming identity doesn’t make anyone eligible.</p>
              <Button onClick={decide}>{!outcome ? 'Record decision' : outcome === 'escalated' ? 'Escalate' : outcome === 'reverification-required' ? 'Request another attempt' : required ? 'Submit for approval' : 'Resolve exception'}</Button>
            </Card>
          )}

          {canInform && (
            <Card className="space-y-3 px-5 py-5">
              <h2 className="text-sm font-semibold text-slate-900">Provide information</h2>
              <Field label="Information">{(p) => <Textarea {...p} rows={3} value={note} onChange={(x) => setNote(x.target.value)} />}</Field>
              <Button variant="secondary" disabled={!note.trim()} onClick={() => done(actions.addExceptionNote(organization.id, e.id, note, []), 'Information sent', () => setNote(''))}>Send</Button>
            </Card>
          )}

          {canReview && isUnresolved(e) && e.status !== 'pending-approval' && (
            <Card className="space-y-3 px-5 py-5">
              <h2 className="text-sm font-semibold text-slate-900">Assignment</h2>
              <Field label="Assign Reviewer">{(p) => (
                <Select {...p} value={reviewerId} onChange={(x) => setReviewerId(x.target.value)}>
                  <option value="">Choose a reviewer</option>
                  {reviewers.map((r) => <option key={r.id} value={r.id}>{r.name ?? r.email}</option>)}
                </Select>
              )}</Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={!reviewerId} onClick={() => done(actions.assignException(organization.id, e.id, reviewerId), 'Reviewer assigned', () => setReviewerId(''))}>Assign</Button>
                {me && e.assignedReviewerId !== me.id && <Button variant="ghost" onClick={() => done(actions.assignException(organization.id, e.id, me.id), 'Assigned to you')}>Assign to me</Button>}
                {['open', 'assigned', 'returned', 'reopened'].concat(e.reverificationRequested ? [] : ['awaiting-information']).includes(e.status) && (!e.assignedReviewerId || e.assignedReviewerId === me?.id) && (
                  <Button onClick={() => done(actions.startExceptionReview(organization.id, e.id), 'Review started')}>Start Review</Button>
                )}
              </div>
            </Card>
          )}

          {canReview && e.status !== 'closed' && (
            <details className="rounded-xl border border-slate-200 bg-white px-5 py-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Notes and information requests</summary>
              <div className="mt-4 space-y-6">
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-slate-900">Add Review Note</h2>
                  <Field label="Note">{(p) => <Textarea {...p} rows={3} value={note} onChange={(x) => setNote(x.target.value)} />}</Field>
                  <Field label="Evidence references (optional)" hint="Comma-separated. No biometric data.">{(p) => <Input {...p} value={refs} onChange={(x) => setRefs(x.target.value)} />}</Field>
                  <Button variant="secondary" disabled={!note.trim()} onClick={() => done(actions.addExceptionNote(organization.id, e.id, note, refs.split(',')), 'Note added', () => { setNote(''); setRefs(''); })}>Add Note</Button>
                </div>
                {isUnresolved(e) && e.status !== 'pending-approval' && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-slate-900">Request Information</h2>
                    <Field label="What’s needed">{(p) => <Textarea {...p} rows={2} value={infoRequest} onChange={(x) => setInfoRequest(x.target.value)} />}</Field>
                    <Button variant="secondary" disabled={!infoRequest.trim()} onClick={() => done(actions.requestExceptionInformation(organization.id, e.id, infoRequest), 'Marked Awaiting Information', () => setInfoRequest(''))}>Request Information</Button>
                  </div>
                )}
              </div>
            </details>
          )}

          {(e.status === 'resolved' || e.status === 'closed') && (canResolve || canReopen) && (
            <Card className="space-y-3 px-5 py-5">
              <h2 className="text-sm font-semibold text-slate-900">After resolution</h2>
              {canReopen && <Field label="Reason to reopen">{(p) => <Textarea {...p} rows={2} value={reopenReason} onChange={(x) => setReopenReason(x.target.value)} />}</Field>}
              <div className="flex flex-wrap gap-2">
                {canReopen && <Button variant="secondary" disabled={!reopenReason.trim()} onClick={() => setConfirm('reopen')}>Reopen</Button>}
                {canResolve && e.status === 'resolved' && <Button variant="ghost" onClick={() => setConfirm('close')}>Close exception</Button>}
              </div>
            </Card>
          )}
        </div>
      </div>

      {confirm === 'decide' && outcome && (
        <ConfirmDialog open title={required ? 'Submit this decision for approval?' : 'Resolve this exception?'} confirmLabel={required ? 'Submit for approval' : 'Resolve exception'}
          description={required ? `“${RESOLUTION_LABEL[outcome]}” goes to a different authorised approver. The case stays open until it’s approved.` : `“${RESOLUTION_LABEL[outcome]}” becomes the final review decision. The original outcome is kept beside it.`}
          onCancel={() => setConfirm(null)} onConfirm={submitDecision} />
      )}
      {(confirm === 'approve' || confirm === 'reject' || confirm === 'return') && e.proposal && (
        <ConfirmDialog open tone={confirm === 'approve' ? 'primary' : 'danger'}
          title={{ approve: 'Approve this decision?', reject: 'Reject this proposal?', return: 'Return for further review?' }[confirm]}
          confirmLabel={{ approve: 'Approve', reject: 'Reject', return: 'Return for review' }[confirm]}
          description={{
            approve: `“${RESOLUTION_LABEL[e.proposal.outcome]}” becomes the final decision, proposed by ${e.proposal.by}.`,
            reject: 'The proposal isn’t approved. The case stays unresolved and goes back to the reviewer; it isn’t treated as a failed identity decision.',
            return: 'The case goes back to the reviewer with your instructions.',
          }[confirm]}
          onCancel={() => setConfirm(null)} onConfirm={() => respond(confirm)} />
      )}
      {confirm === 'reopen' && (
        <ConfirmDialog open title={`Reopen ${e.id}?`} confirmLabel="Reopen" description="The case becomes unresolved again. The earlier decision stays in its history, and the verification record is pending review again."
          onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); done(actions.reopenException(organization.id, e.id, reopenReason), 'Exception reopened', () => setReopenReason('')); }} />
      )}
      {confirm === 'close' && (
        <ConfirmDialog open title={`Close ${e.id}?`} description="The exception and its full history stay available." confirmLabel="Close exception"
          onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); done(actions.closeException(organization.id, e.id), 'Exception closed'); }} />
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-900">{children}</dd></div>;
}
