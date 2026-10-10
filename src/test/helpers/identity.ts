import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import type { Member } from '@/domain/types';

const registry = buildIdSwitchRegistry();

/** The details a person would state at verification: their name and date of birth on their identity record. */
export function statedDetails(m: Pick<Member, 'idSwitchId'>): Record<'Full name' | 'Date of birth', string> {
  const r = registry.find((x) => x.idSwitchId === m.idSwitchId);
  if (!r) throw new Error(`No identity record for ${m.idSwitchId}`);
  return { 'Full name': `${r.givenName} ${r.familyName}`, 'Date of birth': r.dateOfBirth.slice(0, 10) };
}

import type { AppState } from '@/store/state';

/** Gives an administrator active assignments to activities, as the (separate) assignment workflow will. */
export function assign(s: AppState, administratorId: string, activityIds: string[]): AppState {
  const org = s.data.administrators.find((a) => a.id === administratorId)!.organizationId;
  const at = new Date().toISOString();
  const fresh = activityIds.filter((id) => !s.data.verifierAssignments.some((v) => v.activityId === id && v.administratorId === administratorId && v.status === 'active'));
  return { ...s, data: { ...s.data, verifierAssignments: [...s.data.verifierAssignments, ...fresh.map((activityId) => ({ organizationId: org, activityId, administratorId, status: 'active' as const, assignedAt: at, assignedBy: 'Test' }))] } };
}
