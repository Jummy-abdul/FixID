import { isUnresolved } from '@/domain/exceptions';
import type { VerificationAttempt } from '@/domain/types';
import { currentDecision, exceptionFor } from '@/store/exceptionOps';
import type { AppState } from '@/store/state';

/**
 * Verification Status API — SIMULATED demonstration of
 *   GET /api/verifications/{transactionId}/status
 * for an authorized integrating system. It runs in the browser against prototype data: there's no server,
 * no real client authentication and no network call. The client is a registered demonstration client
 * identity (no secret is involved), and every response is marked `simulated: true`.
 *
 * Authorization: the calling client must belong to the transaction's organization, or to the owner of the
* shared activity the transaction belongs to (owner access). Anything else gets 404, exactly like an unknown ID, so
 * a transaction ID alone reveals nothing. No personal information is returned.
 */

export interface StatusApiClient { id: string; name: string; organizationId: string }

/** One simulated integration client per organization. Identities only; no credentials exist. */
export function statusApiClients(state: AppState): StatusApiClient[] {
  return state.data.organizations.map((o) => ({ id: `client_${o.id}`, name: `${o.name} integration client (simulated)`, organizationId: o.id }));
}

export type TransactionStatusCode = 'IN_PROGRESS' | 'PENDING_REVIEW' | 'COMPLETED' | 'UNABLE_TO_COMPLETE' | 'INCOMPLETE' | 'FAILED' | 'CANCELLED';

export interface StatusResponseBody {
  transactionId: string;
  status: TransactionStatusCode;
  identityMatch: string;
  eligibility: string;
  /** The current disposition. Never ALLOW while a review is unresolved. */
  decision: 'ALLOW' | 'DENY' | 'PENDING_REVIEW' | 'UNABLE_TO_DECIDE' | 'NONE';
  /** The decision recorded when verification completed, when a review later changed the disposition. */
  originalDecision?: string;
  review?: { outcome: string; decidedAt: string };
  activityId: string;
  updatedAt: string;
  /** The response comes from the simulated API. */
  simulated: true;
  /** The verification itself used simulated services. */
  simulatedEvidence: boolean;
}

export type StatusApiResponse =
  | { httpStatus: 200; body: StatusResponseBody }
  | { httpStatus: 401 | 404; body: { error: 'UNAUTHENTICATED' | 'NOT_FOUND'; message: string; simulated: true } };

const upper = (v: string) => v.toUpperCase().replace(/-/g, '_');

function statusOf(a: VerificationAttempt, pending: boolean, decision?: string): TransactionStatusCode {
  if (a.status === 'in-progress') return 'IN_PROGRESS';
  if (a.status === 'cancelled') return 'CANCELLED';
  if (a.status === 'expired') return 'INCOMPLETE';
  if (a.status === 'error') return 'FAILED';
  if (pending) return 'PENDING_REVIEW';
  if (decision === 'unable-to-decide') return 'UNABLE_TO_COMPLETE';
  return 'COMPLETED';
}

/** Why a client may see a transaction's status: its own organization's, or one performed for a shared activity it owns. */
function authorized(_state: AppState, client: StatusApiClient, a: VerificationAttempt): boolean {
  return client.organizationId === a.organizationId || client.organizationId === a.activityOwnerId;
}

export function getVerificationStatus(state: AppState, req: { clientId?: string; transactionId: string }): StatusApiResponse {
  const client = statusApiClients(state).find((c) => c.id === req.clientId);
  if (!client) return { httpStatus: 401, body: { error: 'UNAUTHENTICATED', message: 'A registered client is required.', simulated: true } };
  const a = state.data.verificationAttempts.find((x) => x.id === req.transactionId.trim());
  if (!a || !authorized(state, client, a)) return { httpStatus: 404, body: { error: 'NOT_FOUND', message: 'No verification with this ID is available to this client.', simulated: true } };
  const e = a.exceptionId ? exceptionFor(state, a.exceptionId) : undefined;
  const pending = a.status === 'completed' && !a.reviewDisposition && ((!!e && isUnresolved(e)) || a.decision === 'pending-review');
  const current = currentDecision(a, e);
  const status = statusOf(a, pending, current);
  const legacyMatch = a.verificationResult === 'verified' ? 'MATCH' : a.verificationResult === 'not-verified' ? 'NO_MATCH' : a.verificationResult ? 'NOT_EVALUATED' : 'NOT_EVALUATED';
  const updatedAt = [a.completedAt ?? a.startedAt, a.reviewDisposition?.at, e?.updatedAt].filter(Boolean).sort().pop()!;
  return {
    httpStatus: 200,
    body: {
      transactionId: a.id, status,
      identityMatch: a.match ? upper(a.match.status) : legacyMatch,
      eligibility: a.eligibilityStatus ? upper(a.eligibilityStatus) : 'NOT_EVALUATED',
      decision: status === 'PENDING_REVIEW' || status === 'IN_PROGRESS' ? (status === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'NONE') : current ? upper(current) as StatusResponseBody['decision'] : 'NONE',
      ...(a.reviewDisposition ? { originalDecision: upper(a.decision ?? 'none'), review: { outcome: upper(a.reviewDisposition.outcome), decidedAt: a.reviewDisposition.at } } : {}),
      activityId: a.activityId, updatedAt, simulated: true, simulatedEvidence: a.simulated,
    },
  };
}
