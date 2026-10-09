import { findGroup, membershipsOfGroup } from '@/domain/groups';
import type { AuditEvent, IssuanceBatch, IssuanceBatchResult } from '@/domain/types';
import { actorPermissions } from './adminOps';
import { applyIssuance, issuanceEligibility } from './operations';
import type { AppState } from './state';

/**
 * Issue one existing credential configuration to selected members of a group. Each recipient goes
 * through the ordinary issuance operation (same rules, same credential records, one per person);
 * people who aren't eligible are skipped with the reason. The run is recorded once, with a reference
 * to the group, and nothing about the group or its membership changes.
 */

export interface GroupIssuanceInput {
  organizationId: string;
  groupId: string;
  batchId: string;
  credentialTypeId: string;
  memberIds: string[];
  at: string;
  effectiveDate?: string;
  expiresAt?: string;
}

type Result = { ok: true; state: AppState; batch: IssuanceBatch } | { ok: false; error: string };

export function applyGroupIssuance(state: AppState, input: GroupIssuanceInput): Result {
  const prior = state.data.issuanceBatches.find((b) => b.id === input.batchId);
  if (prior) return { ok: true, state, batch: prior };
  const perms = actorPermissions(state, input.organizationId);
  if (!perms.has('credentials.issue') || !perms.has('groups.view')) return { ok: false, error: "You don't have permission to issue credentials." };
  const group = findGroup(state.data, input.organizationId, input.groupId);
  if (!group) return { ok: false, error: 'This group no longer exists.' };
  const type = state.data.credentialTypes.find((t) => t.id === input.credentialTypeId && t.organizationId === input.organizationId);
  if (!type) return { ok: false, error: 'This credential configuration is no longer available.' };
  if (type.status !== 'active') return { ok: false, error: `${type.name} is not active.` };
  const ids = [...new Set(input.memberIds)];
  if (ids.length === 0) return { ok: false, error: 'Select at least one recipient.' };

  const inGroup = new Set(membershipsOfGroup(state.data, input.organizationId, group.id).map((m) => m.memberId));
  const actor = state.data.admin.name;
  let next = state;
  const results: IssuanceBatchResult[] = [];
  for (const id of ids) {
    const member = state.data.members.find((m) => m.id === id && m.organizationId === input.organizationId);
    const name = member?.displayName ?? 'Unknown user';
    if (!member) { results.push({ memberId: id, memberName: name, outcome: 'skipped', reason: 'User not found.' }); continue; }
    if (!inGroup.has(id)) { results.push({ memberId: id, memberName: name, outcome: 'skipped', reason: 'No longer a member of this group.' }); continue; }
    const eligibility = issuanceEligibility(next, id, type);
    if (eligibility.status !== 'eligible') { results.push({ memberId: id, memberName: name, outcome: 'skipped', reason: eligibility.reason }); continue; }
    const r = applyIssuance(next, {
      requestId: `${input.batchId}:${id}`, organizationId: input.organizationId, at: input.at, memberId: id, credentialTypeId: type.id,
      effectiveDate: input.effectiveDate, expiresAt: input.expiresAt, credentialId: `${input.batchId}_${id}`, batchId: input.batchId,
    });
    if (!r.ok) { results.push({ memberId: id, memberName: name, outcome: 'failed', reason: Object.values(r.errors)[0] ?? 'Could not be issued.' }); continue; }
    next = r.state;
    results.push({ memberId: id, memberName: name, outcome: 'issued', credentialId: r.credentialId });
  }

  const issued = results.filter((r) => r.outcome === 'issued').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  const status: IssuanceBatch['status'] = issued === 0 ? 'failed' : issued === results.length ? 'completed' : 'partial';
  const batch: IssuanceBatch = {
    id: input.batchId, organizationId: input.organizationId, groupId: group.id, groupName: group.name, credentialTypeId: type.id, credentialName: type.name,
    initiatedAt: input.at, initiatedBy: actor, completedAt: input.at, status, results,
  };

  const max = next.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const base = {
    organizationId: input.organizationId, actor, actorType: 'admin' as const, resourceType: 'group' as const, resourceId: group.id,
    subject: { id: group.id, name: group.name }, occurredAt: input.at, href: `/groups/${group.id}?tab=credentials&batch=${batch.id}`,
  };
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [`${n(issued, 'credential', 'credentials')} issued successfully`, ...(failed ? [`${n(failed, 'recipient', 'recipients')} failed`] : []), ...(skipped ? [`${n(skipped, 'recipient', 'recipients')} skipped`] : [])];
  const started: AuditEvent = {
    ...base, id: `AUD-${String(max + 1).padStart(5, '0')}`, action: 'issuance.batch-started', result: 'success',
    summary: `${actor} started issuing ${type.name} to ${n(ids.length, 'member', 'members')} of the ${group.name} group.`,
  };
  const completed: AuditEvent = {
    ...base, id: `AUD-${String(max + 2).padStart(5, '0')}`, action: 'issuance.batch-completed',
    result: status === 'completed' ? 'success' : status === 'partial' ? 'partial' : 'failure',
    summary: `${type.name}: ${parts.join('; ')}.`,
    changes: [{ field: 'Issued', from: '0', to: String(issued) }, { field: 'Failed', from: '0', to: String(failed) }, { field: 'Skipped', from: '0', to: String(skipped) }],
  };
  return {
    ok: true, batch,
    state: { ...next, data: { ...next.data, issuanceBatches: [batch, ...next.data.issuanceBatches], audit: [completed, started, ...next.data.audit] } },
  };
}
