import { buildIdSwitchRegistry } from '@/data/idSwitchRegistry';
import type { Member } from '@/domain/types';

const registry = buildIdSwitchRegistry();

/** The details a person would state at verification: their name and date of birth on their identity record. */
export function statedDetails(m: Pick<Member, 'idSwitchId'>): Record<'Full name' | 'Date of birth', string> {
  const r = registry.find((x) => x.idSwitchId === m.idSwitchId);
  if (!r) throw new Error(`No identity record for ${m.idSwitchId}`);
  return { 'Full name': `${r.givenName} ${r.familyName}`, 'Date of birth': r.dateOfBirth.slice(0, 10) };
}
