import type { CanonicalIdentity } from '@/domain/types';
import { createRng } from './random';

const GIVEN = [
  'Adaeze', 'Tunde', 'Chiamaka', 'Ibrahim', 'Funmilayo', 'Emeka', 'Zainab', 'Oluwaseun', 'Ngozi', 'Kelechi',
  'Aisha', 'Babajide', 'Temitope', 'Uchenna', 'Halima', 'Chukwudi', 'Folake', 'Musa', 'Ifeoma', 'Segun',
  'Amara', 'Daniel', 'Grace', 'Samuel', 'Esther', 'David', 'Ruth', 'Michael', 'Kemi', 'Yusuf',
  'Nkechi', 'Olamide', 'Bisi', 'Kunle', 'Hauwa', 'Obinna', 'Tolu', 'Sade', 'Femi', 'Efe',
];
const FAMILY = [
  'Okafor', 'Adeyemi', 'Bello', 'Eze', 'Ogunleye', 'Nwosu', 'Abubakar', 'Okonkwo', 'Balogun', 'Ibekwe',
  'Lawal', 'Onyeka', 'Adebayo', 'Mohammed', 'Obi', 'Akinola', 'Usman', 'Chukwu', 'Afolabi', 'Danjuma',
  'Oyelaran', 'Mensah', 'Asante', 'Okoro', 'Fashola', 'Iheanacho', 'Garba', 'Olatunji', 'Ekwueme', 'Salami',
];

export const REGISTRY_SIZE = 140;

/**
 * Simulated ID Switch canonical identity registry.
 * Deterministic so the same idSwitchId always resolves to the same person.
 */
export function buildIdSwitchRegistry(): CanonicalIdentity[] {
  const rng = createRng(20260101);
  const used = new Set<string>();
  const out: CanonicalIdentity[] = [];
  while (out.length < REGISTRY_SIZE) {
    const givenName = rng.pick(GIVEN);
    const familyName = rng.pick(FAMILY);
    const key = `${givenName} ${familyName}`;
    if (used.has(key)) continue;
    used.add(key);
    const n = out.length + 1;
    const year = rng.int(1968, 2006);
    const month = String(rng.int(1, 12)).padStart(2, '0');
    const day = String(rng.int(1, 28)).padStart(2, '0');
    out.push({
      idSwitchId: `IDS-${(482100 + n * 37).toString().padStart(7, '0')}`,
      givenName,
      familyName,
      email: `${givenName}.${familyName}${n % 7 === 0 ? n : ''}@mail.example`.toLowerCase(),
      phone: `+234 80${rng.int(1, 9)} ${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
      dateOfBirth: `${year}-${month}-${day}`,
      nationality: rng.chance(0.9) ? 'Nigeria' : rng.pick(['Ghana', 'Kenya', 'United Kingdom']),
      verificationLevel: rng.chance(0.15) ? 'basic' : rng.chance(0.3) ? 'high-assurance' : 'verified',
      linkedProducts: rng.chance(0.25) ? ['Fixiam'] : [],
    });
  }
  return out;
}
