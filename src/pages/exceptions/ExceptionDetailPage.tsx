import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Lock, Repeat, ShieldAlert } from 'lucide-react';
import { Button, Card, ConfirmDialog, Field, Input, PageHeader, Select, Textarea, useToast } from '@/components/ui';
import { DecisionBadge, EligibilityStatusBadge, LivenessBadge, MatchBadge, SimulatedBadge, lookupLabel, sourceName } from '@/components/verification/transactionParts';
import {
  EXCEPTION_ACTION_LABEL, EXCEPTION_REASON_LABEL, EXCEPTION_STATUS_LABEL, RESOLUTION_LABEL, isUnresolved,
  type ResolutionOutcome, type VerificationException,
} from '@/domain/exceptions';
import { formatDateTime } from '@/lib/dates';
import { exceptionFor, exceptionsVisibleTo, resolutionProblem, reviewProblem, reviewersFor } from '@/store/exceptionOps';
import { useActions, useSession, useStore } from '@/store/AppStore';
import { useVerificationService } from '@/verification/useVerificationService';
import { ExceptionStatusBadge } from './ExceptionsPage';

const OUTCOMES: ResolutionOutcome[] = ['verification-confirmed', 'verification-not-confirmed', 'reverification-required', 'unable-to-resolve'];

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

function Detail({ e }: { e: VerificationException }) {
  const { organization } = useSession();
  const { state } = useStore();
  const actions = useActions();
  const service = useVerificationService();
  const toast = useToast();
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [refs, setRefs] = useState('');
  const [infoRequest, setInfoRequest] = useState('');
  const [outcome, setOutcome] = useState<ResolutionOutcome>('verification-not-confirmed');
  const [reason, setReason] = useState('');
  const [closing, setClosing] = useState(false);
  const [reviewerId, setReviewerId] = useState('');
  const tx = state.data.verificationAttempts.find((a) => a.id === e.transactionId);
  const reverifications = state.data.verificationAttempts.filter((a) => e.reverificationTransactionIds.includes(a.id));
  const orgName = (id: string) => state.data.organizations.find((o) => o.id === id)?.name ?? id;
  const programme = e.programmeId ? state.data.verificationProgrammes.find((p) => p.id === e.programmeId) : undefined;
  const cannot = reviewProblem(state, organization.id, e);
  const canReview = !cannot;
  const reviewers = reviewersFor(state, e);
  const me = state.data.administrators.find((a) => a.organizationId === organization.id && a.userId === state.data.admin.id);
  const resolutionBlock = resolutionProblem(state, e, outcome);
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

  return (
    <>
      <PageHeader title={<span className="font-mono">{e.id}</span>} breadcrumbs={[{ label: 'Exceptions', to: '/exceptions' }, { label: e.id }]} meta={<ExceptionStatusBadge status={e.status} />}
        description={`${EXCEPTION_REASON_LABEL[e.reason]} · ${e.activityName}`} />
      {!canReview && (
        <p className="mb-6 flex gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />Read-only. {cannot}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="px-5 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Overview</h2>
            <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Exception overview">
              <Row label="Exception reference"><span className="font-mono text-xs">{e.id}</span></Row>
              <Row label="Current status"><ExceptionStatusBadge status={e.status} /></Row>
              <Row label="Exception reason">{EXCEPTION_REASON_LABEL[e.reason]}<span className="block text-xs text-slate-500">{e.reasonDetail}</span></Row>
              <Row label="Assigned reviewer">{e.assignedReviewerName ?? 'Unassigned'}</Row>
              <Row label="Organization">{orgName(e.organizationId)}</Row>
              <Row label="Review queue">{e.route === 'programme' ? `Programme reviewers (${orgName(e.reviewOrganizationId)})` : `${orgName(e.reviewOrganizationId)} reviewers`}</Row>
              <Row label="Programme">{programme?.name ?? '—'}</Row>
              <Row label="Activity">{e.activityName}</Row>
            </dl>
          </Card>

          <Card className="px-5 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Verification information</h2>
            <p className="mt-0.5 text-xs text-slate-500">As recorded when verification completed. A review never changes these results.</p>
            {tx ? (
              <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Verification information">
                <Row label="Transaction reference"><span className="font-mono text-xs">{tx.id}</span>{tx.simulated && <span className="ml-1"><SimulatedBadge /></span>}</Row>
                <Row label="Identity source">{sourceName(tx)}</Row>
                <Row label="Identity reference">{tx.lookup ? <span className="font-mono">{tx.lookup.reference.toUpperCase()}</span> : tx.subject?.label ?? 'Not identified'}</Row>
                {tx.lookup && <Row label="Lookup result">{lookupLabel(tx)}</Row>}
                <Row label="Liveness result"><LivenessBadge status={tx.liveness?.status} /></Row>
                <Row label="Identity match result"><MatchBadge status={tx.match?.status} /></Row>
                <Row label="Eligibility result"><EligibilityStatusBadge status={tx.eligibilityStatus} /></Row>
                <Row label="Original activity decision"><DecisionBadge decision={tx.decision} />{tx.decisionExplanation && <span className="block text-xs text-slate-500">{tx.decisionExplanation}</span>}</Row>
                {tx.reviewDisposition && <Row label="Current disposition (after review)"><DecisionBadge decision={tx.reviewDisposition.decision} /></Row>}
                <Row label="Date and time">{formatDateTime(tx.completedAt ?? tx.startedAt)}</Row>
              </dl>
            ) : <p className="mt-3 text-sm text-slate-500">The transaction isn’t available.</p>}
            <p className="mt-3 text-xs text-slate-500">No biometric captures or reference templates are held, so none can be shown.</p>
          </Card>

          {(reverifications.length > 0 || e.reverificationRequested) && (
            <Card className="px-5 py-5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Repeat className="h-4 w-4 text-slate-400" aria-hidden="true" />Reverification</h2>
              {e.reverificationRequested && <p className="mt-1 text-sm text-slate-600">Requested by {e.reverificationRequested.by} on {formatDateTime(e.reverificationRequested.at)}. A new transaction applies the activity’s current mandatory requirements; the original stays unchanged.</p>}
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
              {e.reverificationRequested && !canReverify && <p className="mt-2 text-xs text-slate-500">An assigned verifier in {orgName(e.organizationId)} performs the reverification.</p>}
            </Card>
          )}

          <Card className="px-5 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Review history</h2>
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

          <Card className="px-5 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Resolution</h2>
            {e.resolution ? (
              <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" aria-label="Resolution">
                <Row label="Resolution outcome">{RESOLUTION_LABEL[e.resolution.outcome]}</Row>
                <Row label="Final disposition">{e.resolution.disposition === 'pending-review' ? 'Pending (reverification)' : <DecisionBadge decision={e.resolution.disposition} />}</Row>
                <Row label="Resolution reason">{e.resolution.reason}</Row>
                <Row label="Recorded">{formatDateTime(e.resolution.at)} by {e.resolution.by}</Row>
              </dl>
            ) : <p className="mt-2 text-sm text-slate-500">No resolution has been recorded.</p>}
          </Card>
        </div>

        {canReview && (
          <div className="space-y-6">
            {isUnresolved(e) && (
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
                  {(e.status === 'open' || e.status === 'assigned' || (e.status === 'awaiting-information' && !e.reverificationRequested)) && (!e.assignedReviewerId || e.assignedReviewerId === me?.id) && (
                    <Button onClick={() => done(actions.startExceptionReview(organization.id, e.id), 'Review started')}>Start Review</Button>
                  )}
                </div>
              </Card>
            )}
            {e.status !== 'closed' && (
              <Card className="space-y-3 px-5 py-5">
                <h2 className="text-sm font-semibold text-slate-900">Add Review Note</h2>
                <Field label="Note">{(p) => <Textarea {...p} rows={3} value={note} onChange={(x) => setNote(x.target.value)} />}</Field>
                <Field label="Supporting evidence references" hint="Optional, comma-separated references to documents held elsewhere. Never upload biometric data.">{(p) => <Input {...p} value={refs} onChange={(x) => setRefs(x.target.value)} />}</Field>
                <Button variant="secondary" disabled={!note.trim()} onClick={() => done(actions.addExceptionNote(organization.id, e.id, note, refs.split(',')), 'Note added', () => { setNote(''); setRefs(''); })}>Add Note</Button>
              </Card>
            )}
            {isUnresolved(e) && (
              <Card className="space-y-3 px-5 py-5">
                <h2 className="text-sm font-semibold text-slate-900">Request Information</h2>
                <Field label="What’s needed">{(p) => <Textarea {...p} rows={2} value={infoRequest} onChange={(x) => setInfoRequest(x.target.value)} />}</Field>
                <Button variant="secondary" disabled={!infoRequest.trim()} onClick={() => done(actions.requestExceptionInformation(organization.id, e.id, infoRequest), 'Marked Awaiting Information', () => setInfoRequest(''))}>Request Information</Button>
              </Card>
            )}
            {isUnresolved(e) && (
              <Card className="space-y-3 px-5 py-5">
                <h2 className="text-sm font-semibold text-slate-900">Record Resolution</h2>
                <Field label="Resolution outcome">{(p) => (
                  <Select {...p} value={outcome} onChange={(x) => setOutcome(x.target.value as ResolutionOutcome)}>
                    {OUTCOMES.map((o) => <option key={o} value={o}>{RESOLUTION_LABEL[o]}</option>)}
                  </Select>
                )}</Field>
                {resolutionBlock && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">{resolutionBlock}</p>}
                <Field label="Resolution reason">{(p) => <Textarea {...p} rows={2} value={reason} onChange={(x) => setReason(x.target.value)} />}</Field>
                <p className="text-xs text-slate-500">Your determination is recorded beside the original results. It doesn’t change the identity match, liveness or eligibility results.</p>
                <Button disabled={!reason.trim() || !!resolutionBlock} onClick={() => done(actions.resolveException(organization.id, e.id, outcome, reason), 'Resolution recorded', () => setReason(''))}>Record Resolution</Button>
              </Card>
            )}
            {e.status === 'resolved' && (
              <Card className="space-y-3 px-5 py-5">
                <h2 className="text-sm font-semibold text-slate-900">Close Exception</h2>
                <p className="text-sm text-slate-600">The resolution is recorded. Closing ends the case; its history is kept.</p>
                <Button variant="secondary" onClick={() => setClosing(true)}>Close Exception</Button>
              </Card>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog open={closing} title={`Close ${e.id}?`} description="The exception and its full history stay available. It can’t be reopened from here." confirmLabel="Close Exception"
        onCancel={() => setClosing(false)} onConfirm={() => { setClosing(false); done(actions.closeException(organization.id, e.id), 'Exception closed'); }} />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-900">{children}</dd></div>;
}
