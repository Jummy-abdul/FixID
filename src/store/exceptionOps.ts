import {
  EXCEPTION_STATUS_LABEL, RESOLUTION_LABEL, confirmationProblem, dispositionFor, isUnresolved, reasonFor,
  type ExceptionAction, type ExceptionEvent, type ExceptionStatus, type ResolutionOutcome, type VerificationException,
} from '@/domain/exceptions';
import type { AuditEvent, VerificationAttempt } from '@/domain/types';
import { actorPermissions, actorRecord, adminPermissions } from './adminOps';
import type { AppState } from './state';

/**
 * Verification Exceptions: creation and routing from transactions, and the review workflow. Every action
 * re-checks the reviewer's permission in the organization the exception is routed to, records who did what
 * (previous and new state, reason) in the exception's history and in the Audit Log, and never edits the
 * transaction's recorded evidence. Production must run this on the server.
 */

type Result = { ok: true; state: AppState; exception: VerificationException } | { ok: false; error: string };

export const exceptionsOf = (state: AppState) => state.data.verificationExceptions ?? [];
export const exceptionFor = (state: AppState, id: string) => exceptionsOf(state).find((e) => e.id === id);

/** Exceptions an organization's users may see: its own transactions', and those of its shared activities routed to it for review. */
export function exceptionsVisibleTo(state: AppState, organizationId: string): VerificationException[] {
  const perms = actorPermissions(state, organizationId);
  if (!perms.has('exceptions.view') && !perms.has('exceptions.review')) return [];
  return exceptionsOf(state).filter((e) => e.organizationId === organizationId || e.reviewOrganizationId === organizationId);
}

/** Why the signed-in administrator can't act on an exception from this organization, or null. */
export function reviewProblem(state: AppState, organizationId: string, e: VerificationException | undefined): string | null {
  if (!e) return 'This exception wasn’t found.';
  const rec = actorRecord(state, organizationId);
  if (!rec || rec.status !== 'active') return 'You aren’t an administrator of this organization.';
  if (e.reviewOrganizationId !== organizationId) return e.route === 'owner' ? 'This exception is reviewed by the organization that owns the shared activity.' : 'This exception is reviewed by its own organization.';
  if (!actorPermissions(state, organizationId).has('exceptions.review')) return 'Your role can’t review exceptions.';
  return null;
}

/**
 * Why the organization that performed a shared-activity transaction can't add information to its exception, or
 * null. It can only answer the owner's information request; decisions stay with the owner.
 */
export function informationProblem(state: AppState, organizationId: string, e: VerificationException | undefined): string | null {
  if (!e) return 'This exception wasn’t found.';
  if (e.route !== 'owner' || e.organizationId !== organizationId || e.reviewOrganizationId === organizationId) return reviewProblem(state, organizationId, e);
  const rec = actorRecord(state, organizationId);
  if (!rec || rec.status !== 'active') return 'You aren’t an administrator of this organization.';
  if (!actorPermissions(state, organizationId).has('exceptions.review')) return 'Your role can’t respond to exceptions.';
  if (e.status !== 'awaiting-information') return 'Information can be added when the activity owner requests it.';
  return null;
}

/** Administrators who may be assigned an exception: active, in the reviewing organization, with review permission. */
export function reviewersFor(state: AppState, e: Pick<VerificationException, 'reviewOrganizationId'>) {
  return state.data.administrators.filter((a) => a.organizationId === e.reviewOrganizationId && a.status === 'active' && adminPermissions(state, a).has('exceptions.review'));
}

function nextAuditId(state: AppState, offset = 0) {
  const max = state.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  return `AUD-${String(max + 1 + offset).padStart(5, '0')}`;
}

/** Appends audit events. There's no edit or delete path for audit entries anywhere in the application. */
export function appendAudit(state: AppState, events: Omit<AuditEvent, 'id'>[]): AppState {
  const withIds = events.map((e, i) => ({ ...e, id: nextAuditId(state, i) }));
  return { ...state, data: { ...state.data, audit: [...withIds.reverse(), ...state.data.audit] } };
}

const ACTION_AUDIT: Record<ExceptionAction, AuditEvent['action']> = {
  created: 'exception.created', assigned: 'exception.assigned', 'review-started': 'exception.review-started', 'note-added': 'exception.note-added',
  'information-requested': 'exception.information-requested', 'resolution-recorded': 'exception.resolved', closed: 'exception.closed',
  'reverification-started': 'exception.reverification-started', 'reverification-completed': 'exception.reverification-completed',
};

function write(state: AppState, e: VerificationException, ev: ExceptionEvent, summary: string, audit: { organizationIds: string[]; changes?: AuditEvent['changes'] }): AppState {
  const next: VerificationException = { ...e, history: [...e.history, ev], updatedAt: ev.at };
  const others = exceptionsOf(state).filter((x) => x.id !== e.id);
  const s: AppState = { ...state, data: { ...state.data, verificationExceptions: [...others, next] } };
  const changes = audit.changes ?? (ev.fromStatus && ev.toStatus && ev.fromStatus !== ev.toStatus ? [{ field: 'Exception status', from: EXCEPTION_STATUS_LABEL[ev.fromStatus], to: EXCEPTION_STATUS_LABEL[ev.toStatus] }] : undefined);
  return appendAudit(s, [...new Set(audit.organizationIds)].map((organizationId) => ({
    organizationId, action: ACTION_AUDIT[ev.action], actor: ev.actorName, actorType: ev.actorId === 'system' ? 'system' as const : 'admin' as const,
    actorId: ev.actorId, actorOrganizationId: ev.actorOrganizationId, targetOrganizationId: e.organizationId !== organizationId ? e.organizationId : undefined,
    resourceType: 'exception' as const, resourceId: e.id, subject: { id: e.id, name: `${e.id} · ${e.activityName}` }, result: 'success' as const, occurredAt: ev.at,
    summary, href: `/exceptions/${e.id}`, correlationId: e.transactionId, ...(changes ? { changes } : {}),
  })));
}

const eventId = (e: VerificationException) => `${e.id}-H${e.history.length + 1}`;

/**
 * Where an exception is reviewed: a shared activity's owner reviews exceptions from the organizations taking
 * part (it controls the activity's requirements); otherwise the transaction's own organization.
 */
export function routeFor(_state: AppState, attempt: Pick<VerificationAttempt, 'organizationId' | 'activityOwnerId'>): Pick<VerificationException, 'route' | 'reviewOrganizationId'> {
  return attempt.activityOwnerId && attempt.activityOwnerId !== attempt.organizationId
    ? { route: 'owner', reviewOrganizationId: attempt.activityOwnerId } : { route: 'local', reviewOrganizationId: attempt.organizationId };
}

/**
 * Raises an exception for a completed transaction that requires review (or that its verifier referred).
 * The transaction keeps its recorded results; it only gains a link to the exception.
 */
export function raiseException(state: AppState, attemptId: string, at: string, opts: { referred?: boolean } = {}): AppState {
  const a = state.data.verificationAttempts.find((x) => x.id === attemptId);
  if (!a || a.exceptionId || a.reverificationOf || a.status !== 'completed') return state;
  const max = exceptionsOf(state).reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const { reason, detail } = reasonFor(a, opts.referred);
  const route = routeFor(state, a);
  const e: VerificationException = {
    id: `EXC-${String(max + 1).padStart(5, '0')}`, organizationId: a.organizationId, ...(a.activityOwnerId ? { activityOwnerId: a.activityOwnerId } : {}),
    transactionId: a.id, activityId: a.activityId, activityName: a.activityName, reason, reasonDetail: detail, ...route,
    status: 'open', createdAt: at, updatedAt: at, history: [], reverificationTransactionIds: [],
  };
  const withLink: AppState = { ...state, data: { ...state.data, verificationAttempts: state.data.verificationAttempts.map((x) => (x.id === a.id ? { ...x, exceptionId: e.id } : x)) } };
  const ev: ExceptionEvent = {
    id: `${e.id}-H1`, at, action: 'created', actorId: opts.referred ? a.verifierId : 'system', actorName: opts.referred ? a.verifierName : 'Activity policy',
    actorOrganizationId: a.organizationId, toStatus: 'open', comment: detail, transactionId: a.id,
  };
  return write(withLink, e, ev, `Exception ${e.id} was raised for transaction ${a.id} (${a.activityName}) and placed in the ${route.route === 'owner' ? 'activity owner’s review queue' : 'organization’s review queue'}.`,
    { organizationIds: [a.organizationId, route.reviewOrganizationId] });
}

/** Keeps exceptions in step with transactions: raises new ones and records reverification results. */
export function syncExceptions(state: AppState, attemptId: string, at: string): AppState {
  const a = state.data.verificationAttempts.find((x) => x.id === attemptId);
  if (!a) return state;
  if (a.reverificationOf) {
    const e = exceptionFor(state, a.reverificationOf);
    if (!e) return state;
    const started = e.history.some((h) => h.action === 'reverification-started' && h.transactionId === a.id);
    const completed = e.history.some((h) => h.action === 'reverification-completed' && h.transactionId === a.id);
    if (!started && a.status === 'in-progress') {
      const ev: ExceptionEvent = { id: eventId(e), at, action: 'reverification-started', actorId: a.verifierId, actorName: a.verifierName, actorOrganizationId: a.organizationId, transactionId: a.id, comment: `New transaction ${a.id} started.` };
      return write({ ...state }, { ...e, reverificationTransactionIds: [...e.reverificationTransactionIds, a.id] }, ev, `${a.verifierName} started reverification ${a.id} for exception ${e.id}.`, { organizationIds: [a.organizationId, e.reviewOrganizationId] });
    }
    if (!completed && a.status !== 'in-progress') {
      const to: ExceptionStatus = e.status === 'awaiting-information' ? 'in-review' : e.status;
      const ev: ExceptionEvent = {
        id: eventId(e), at, action: 'reverification-completed', actorId: 'system', actorName: 'Verification service', actorOrganizationId: a.organizationId,
        transactionId: a.id, fromStatus: e.status, toStatus: to, comment: `Reverification ${a.id}: ${a.decision ?? a.status}${a.decisionExplanation ? ` — ${a.decisionExplanation}` : ''}`,
      };
      return write(state, { ...e, status: to, reverificationRequested: undefined }, ev, `Reverification ${a.id} for exception ${e.id} finished (${a.decision ?? a.status}).`, { organizationIds: [a.organizationId, e.reviewOrganizationId] });
    }
    return state;
  }
  if (a.status === 'completed' && a.decision === 'pending-review' && !a.exceptionId) return raiseException(state, a.id, at);
  return state;
}

function actor(state: AppState, organizationId: string) {
  const rec = actorRecord(state, organizationId)!;
  return { actorId: rec.id, actorName: rec.name ?? rec.email, actorOrganizationId: organizationId };
}

/** Assigns (or claims) an exception. Only to an active reviewer in the reviewing organization. */
export function applyAssignException(state: AppState, input: { organizationId: string; exceptionId: string; reviewerId: string; at: string }): Result {
  const e = exceptionFor(state, input.exceptionId);
  const problem = reviewProblem(state, input.organizationId, e);
  if (problem || !e) return { ok: false, error: problem ?? 'Not found.' };
  if (!isUnresolved(e)) return { ok: false, error: 'A resolved or closed exception can’t be reassigned.' };
  const reviewer = reviewersFor(state, e).find((r) => r.id === input.reviewerId);
  if (!reviewer) return { ok: false, error: 'Only an active reviewer in the reviewing organization can be assigned.' };
  const to: ExceptionStatus = e.status === 'open' ? 'assigned' : e.status;
  const who = actor(state, input.organizationId);
  const name = reviewer.name ?? reviewer.email;
  const ev: ExceptionEvent = { id: eventId(e), at: input.at, action: 'assigned', ...who, fromStatus: e.status, toStatus: to, comment: who.actorId === reviewer.id ? `${name} claimed the exception.` : `Assigned to ${name}.` };
  const next = { ...e, status: to, assignedReviewerId: reviewer.id, assignedReviewerName: name };
  const s = write(state, next, ev, `${who.actorName} assigned exception ${e.id} to ${name}.`, {
    organizationIds: [e.reviewOrganizationId], changes: [{ field: 'Assigned reviewer', from: e.assignedReviewerName ?? 'Unassigned', to: name }, ...(to !== e.status ? [{ field: 'Exception status', from: EXCEPTION_STATUS_LABEL[e.status], to: EXCEPTION_STATUS_LABEL[to] }] : [])],
  });
  return { ok: true, state: s, exception: exceptionFor(s, e.id)! };
}

/** Starting the review: the assigned reviewer (assigning themselves if nobody is assigned). */
export function applyStartReview(state: AppState, input: { organizationId: string; exceptionId: string; at: string }): Result {
  const e = exceptionFor(state, input.exceptionId);
  const problem = reviewProblem(state, input.organizationId, e);
  if (problem || !e) return { ok: false, error: problem ?? 'Not found.' };
  if (e.status !== 'open' && e.status !== 'assigned' && e.status !== 'awaiting-information') return { ok: false, error: 'This exception can’t start review from its current status.' };
  const who = actor(state, input.organizationId);
  if (e.assignedReviewerId && e.assignedReviewerId !== who.actorId) return { ok: false, error: `It’s assigned to ${e.assignedReviewerName}.` };
  const ev: ExceptionEvent = { id: eventId(e), at: input.at, action: 'review-started', ...who, fromStatus: e.status, toStatus: 'in-review' };
  const s = write(state, { ...e, status: 'in-review', assignedReviewerId: who.actorId, assignedReviewerName: who.actorName }, ev, `${who.actorName} started reviewing exception ${e.id}.`, { organizationIds: [e.reviewOrganizationId] });
  return { ok: true, state: s, exception: exceptionFor(s, e.id)! };
}

/** A timestamped review note, optionally with supporting evidence references. Allowed until the exception is closed. */
export function applyExceptionNote(state: AppState, input: { organizationId: string; exceptionId: string; comment: string; evidenceRefs?: string[]; at: string }): Result {
  const e = exceptionFor(state, input.exceptionId);
  // The reviewing organization adds review notes; the performing organization of a shared activity answers information requests.
  const responding = !!e && e.reviewOrganizationId !== input.organizationId;
  const problem = responding ? informationProblem(state, input.organizationId, e) : reviewProblem(state, input.organizationId, e);
  if (problem || !e) return { ok: false, error: problem ?? 'Not found.' };
  if (e.status === 'closed') return { ok: false, error: 'A closed exception can’t be changed.' };
  const comment = input.comment.trim();
  if (!comment) return { ok: false, error: 'Enter a note.' };
  const refs = (input.evidenceRefs ?? []).map((r) => r.trim()).filter(Boolean).slice(0, 10);
  const who = actor(state, input.organizationId);
  const ev: ExceptionEvent = { id: eventId(e), at: input.at, action: 'note-added', ...who, comment: comment.slice(0, 2000), ...(refs.length ? { evidenceRefs: refs } : {}) };
  const s = write(state, e, ev, responding ? `${who.actorName} provided information for exception ${e.id}.` : `${who.actorName} added a review note to exception ${e.id}.`,
    { organizationIds: responding ? [e.reviewOrganizationId, e.organizationId] : [e.reviewOrganizationId] });
  return { ok: true, state: s, exception: exceptionFor(s, e.id)! };
}

/** Marks the exception Awaiting Information, recording what's needed. */
export function applyRequestInformation(state: AppState, input: { organizationId: string; exceptionId: string; comment: string; at: string }): Result {
  const e = exceptionFor(state, input.exceptionId);
  const problem = reviewProblem(state, input.organizationId, e);
  if (problem || !e) return { ok: false, error: problem ?? 'Not found.' };
  if (!isUnresolved(e)) return { ok: false, error: 'This exception is already resolved.' };
  if (!input.comment.trim()) return { ok: false, error: 'Say what information is needed.' };
  const who = actor(state, input.organizationId);
  const ev: ExceptionEvent = { id: eventId(e), at: input.at, action: 'information-requested', ...who, fromStatus: e.status, toStatus: 'awaiting-information', comment: input.comment.trim().slice(0, 2000) };
  const s = write(state, { ...e, status: 'awaiting-information' }, ev, `${who.actorName} requested information for exception ${e.id}.`, { organizationIds: [e.reviewOrganizationId, e.organizationId] });
  return { ok: true, state: s, exception: exceptionFor(s, e.id)! };
}

/** Why a resolution can't be recorded, or null. Confirmation needs identity evidence that supports it. */
export function resolutionProblem(state: AppState, e: VerificationException, outcome: ResolutionOutcome): string | null {
  if (!isUnresolved(e)) return 'This exception is already resolved.';
  if (e.status === 'awaiting-information' && e.reverificationRequested) return 'A reverification is outstanding. Wait for it to finish first.';
  if (outcome !== 'verification-confirmed') return null;
  const original = state.data.verificationAttempts.find((a) => a.id === e.transactionId);
  if (!original) return 'The original transaction isn’t available.';
  const reverifications = state.data.verificationAttempts.filter((a) => e.reverificationTransactionIds.includes(a.id));
  return confirmationProblem(original, reverifications);
}

/**
 * Records the reviewer's determination. The transaction's original decision and evidence are kept; its
 * current disposition is recorded separately. "Reverification Required" keeps the exception open.
 */
export function applyResolveException(state: AppState, input: { organizationId: string; exceptionId: string; outcome: ResolutionOutcome; reason: string; at: string }): Result {
  const e = exceptionFor(state, input.exceptionId);
  const problem = reviewProblem(state, input.organizationId, e);
  if (problem || !e) return { ok: false, error: problem ?? 'Not found.' };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: 'Give a reason for the resolution.' };
  const rp = resolutionProblem(state, e, input.outcome);
  if (rp) return { ok: false, error: rp };
  const who = actor(state, input.organizationId);
  const disposition = dispositionFor(input.outcome);
  const reverify = input.outcome === 'reverification-required';
  const to: ExceptionStatus = reverify ? 'awaiting-information' : 'resolved';
  const ev: ExceptionEvent = { id: eventId(e), at: input.at, action: 'resolution-recorded', ...who, fromStatus: e.status, toStatus: to, comment: `${RESOLUTION_LABEL[input.outcome]}: ${reason}` };
  const next: VerificationException = {
    ...e, status: to, resolution: { outcome: input.outcome, reason, disposition, at: input.at, by: who.actorName },
    ...(reverify ? { reverificationRequested: { at: input.at, by: who.actorName } } : { reverificationRequested: undefined }),
    assignedReviewerId: e.assignedReviewerId ?? who.actorId, assignedReviewerName: e.assignedReviewerName ?? who.actorName,
  };
  let s = write(state, next, ev, `${who.actorName} recorded “${RESOLUTION_LABEL[input.outcome]}” for exception ${e.id} (transaction ${e.transactionId}).`, {
    organizationIds: [e.reviewOrganizationId, e.organizationId],
    changes: [
      { field: 'Exception status', from: EXCEPTION_STATUS_LABEL[e.status], to: EXCEPTION_STATUS_LABEL[to] },
      ...(!reverify ? [{ field: 'Transaction disposition', from: 'Pending review', to: DECISION_WORDS[disposition] }] : []),
    ],
  });
  if (!reverify) {
    // The current disposition is recorded beside the original results, never in place of them.
    s = {
      ...s, data: {
        ...s.data, verificationAttempts: s.data.verificationAttempts.map((a) => (a.id === e.transactionId ? {
          ...a, stage: disposition === 'unable-to-decide' ? 'unable-to-complete' as const : 'completed' as const,
          review: undefined,
          reviewDisposition: { decision: disposition as Exclude<typeof disposition, 'pending-review'>, outcome: input.outcome, exceptionId: e.id, at: input.at, by: who.actorName },
        } : a)),
      },
    };
  }
  return { ok: true, state: s, exception: exceptionFor(s, e.id)! };
}

/** Closes a resolved exception. */
export function applyCloseException(state: AppState, input: { organizationId: string; exceptionId: string; comment?: string; at: string }): Result {
  const e = exceptionFor(state, input.exceptionId);
  const problem = reviewProblem(state, input.organizationId, e);
  if (problem || !e) return { ok: false, error: problem ?? 'Not found.' };
  if (e.status !== 'resolved') return { ok: false, error: 'Record a resolution before closing the exception.' };
  const who = actor(state, input.organizationId);
  const ev: ExceptionEvent = { id: eventId(e), at: input.at, action: 'closed', ...who, fromStatus: e.status, toStatus: 'closed', ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}) };
  const s = write(state, { ...e, status: 'closed' }, ev, `${who.actorName} closed exception ${e.id}.`, { organizationIds: [e.reviewOrganizationId, e.organizationId] });
  return { ok: true, state: s, exception: exceptionFor(s, e.id)! };
}

/** Whether a reverification may be started for an exception's activity now (by an authorized verifier). */
export function reverificationProblem(state: AppState, exceptionId: string, activityId: string): string | null {
  const e = exceptionFor(state, exceptionId);
  if (!e) return 'This exception wasn’t found.';
  if (e.activityId !== activityId) return 'Reverification must use the exception’s activity.';
  if (!e.reverificationRequested) return 'No reverification has been requested for this exception.';
  if (state.data.verificationAttempts.some((a) => a.reverificationOf === e.id && a.status === 'in-progress')) return 'A reverification is already in progress.';
  return null;
}

/** The transaction's current disposition: the review determination when one exists, else its own decision. */
export function currentDecision(a: Pick<VerificationAttempt, 'decision' | 'reviewDisposition'>, e?: Pick<VerificationException, 'status'>) {
  if (a.reviewDisposition) return a.reviewDisposition.decision;
  if (e && isUnresolved(e)) return 'pending-review' as const;
  return a.decision;
}

const DECISION_WORDS = { allow: 'Verified', deny: 'Not verified', 'pending-review': 'Pending review', 'unable-to-decide': 'Unable to verify' } as const;

/** Audit events for a transaction's lifecycle: started, completed (with its decision) and cancelled. No personal data. */
export function auditTransactionChange(prev: AppState, next: AppState, attemptId: string, at: string): AppState {
  const before = prev.data.verificationAttempts.find((a) => a.id === attemptId);
  const after = next.data.verificationAttempts.find((a) => a.id === attemptId);
  if (!after || before?.status === after.status) return next;
  const kind = !before && after.status === 'in-progress' ? 'started' : after.status === 'completed' ? 'completed' : after.status === 'cancelled' ? 'cancelled' : null;
  if (!kind) return next;
  const decision = after.decision ? DECISION_WORDS[after.decision] : after.outcome ?? '';
  return appendAudit(next, [{
    organizationId: after.organizationId, action: `verification.${kind}` as AuditEvent['action'], actor: after.verifierName, actorType: 'admin', actorId: after.verifierId,
    actorOrganizationId: after.organizationId, resourceType: 'verification-transaction', resourceId: after.id, subject: { id: after.id, name: `${after.id} · ${after.activityName}` },
    result: 'success', occurredAt: at, correlationId: after.id, href: `/verification-history/${after.id}`,
    summary: kind === 'started' ? `${after.verifierName} started verification ${after.id} for ${after.activityName}${after.retryOf ? ` (retry of ${after.retryOf})` : ''}${after.reverificationOf ? ` (reverification for ${after.reverificationOf})` : ''}.`
      : kind === 'completed' ? `Verification ${after.id} for ${after.activityName} completed: ${decision}.`
        : `${after.verifierName} cancelled verification ${after.id} for ${after.activityName}.`,
    ...(kind === 'completed' && after.decision ? { changes: [{ field: 'Activity decision', from: '—', to: decision }] } : {}),
  }]);
}

/**
 * Records a refused attempt to open a resource. Filed in the actor's organization, and in the owning
 * organization when the resource exists there, without revealing anything about it to the actor.
 */
export function applyAccessDenied(state: AppState, input: { organizationId: string; resourceType: 'verification-transaction' | 'exception'; resourceId: string; at: string }): AppState {
  const owner = input.resourceType === 'exception' ? exceptionFor(state, input.resourceId)?.organizationId : state.data.verificationAttempts.find((a) => a.id === input.resourceId)?.organizationId;
  if (owner === input.organizationId) return state;
  const rec = actorRecord(state, input.organizationId);
  const actorName = rec?.name ?? rec?.email ?? state.data.admin.name;
  const base = {
    action: 'access.denied' as const, actor: actorName, actorType: 'admin' as const, actorId: state.data.admin.id, actorOrganizationId: input.organizationId,
    resourceType: input.resourceType, resourceId: input.resourceId, result: 'denied' as const, occurredAt: input.at, correlationId: input.resourceId,
  };
  // Repeated renders of the same refusal aren't recorded twice within a minute.
  const recent = state.data.audit.find((x) => x.action === 'access.denied' && x.resourceId === input.resourceId && x.actorId === base.actorId && Math.abs(new Date(x.occurredAt).getTime() - new Date(input.at).getTime()) < 60_000);
  if (recent) return state;
  return appendAudit(state, [
    { ...base, organizationId: input.organizationId, summary: `${actorName} was refused access to ${input.resourceType === 'exception' ? 'an exception' : 'a verification transaction'} (${input.resourceId}) outside this organization’s scope.` },
    ...(owner ? [{ ...base, organizationId: owner, targetOrganizationId: owner, summary: `An administrator of another organization was refused access to ${input.resourceId}.` }] : []),
  ]);
}

/** Audit for a (simulated) Verification Status API request, filed with the calling client's organization. */
export function applyStatusRequestAudit(state: AppState, input: { clientId?: string; transactionId: string; at: string }): AppState {
  const orgId = input.clientId?.replace(/^client_/, '');
  const org = state.data.organizations.find((o) => o.id === orgId);
  if (!org) return state;
  const a = state.data.verificationAttempts.find((x) => x.id === input.transactionId.trim());
  // Its own transactions, or (shared activities it owns) those its participants performed.
  const ok = !!a && (a.organizationId === org.id || a.activityOwnerId === org.id);
  return appendAudit(state, [{
    organizationId: org.id, action: ok ? 'api.status-requested' : 'api.status-denied', actor: `${org.name} integration client (simulated)`, actorType: 'integration',
    actorId: input.clientId, actorOrganizationId: org.id, ...(ok && a!.organizationId !== org.id ? { targetOrganizationId: a!.organizationId } : {}),
    resourceType: 'status-api', resourceId: input.transactionId.trim().slice(0, 60), result: ok ? 'success' : 'denied', occurredAt: input.at, correlationId: input.transactionId.trim().slice(0, 60),
    summary: ok ? `Simulated status request for ${input.transactionId.trim()} was answered.` : `Simulated status request for ${input.transactionId.trim().slice(0, 60)} was refused (not available to this client).`,
  }]);
}
