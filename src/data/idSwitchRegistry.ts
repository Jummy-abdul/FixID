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

const FEMALE = new Set(['Adaeze', 'Chiamaka', 'Funmilayo', 'Zainab', 'Ngozi', 'Aisha', 'Halima', 'Folake', 'Ifeoma', 'Amara', 'Grace', 'Esther', 'Ruth', 'Kemi', 'Nkechi', 'Bisi', 'Hauwa', 'Sade']);
const MALE = new Set(['Tunde', 'Ibrahim', 'Emeka', 'Babajide', 'Chukwudi', 'Musa', 'Segun', 'Daniel', 'Samuel', 'David', 'Michael', 'Yusuf', 'Kunle', 'Obinna', 'Femi']);
const LOCATIONS = ['Lagos', 'Abuja', 'Ibadan', 'Port Harcourt', 'Enugu', 'Kano', 'Benin City', 'Abeokuta', 'Owerri', 'Kaduna', 'Jos', 'Ilorin'];

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
      // Derived without extra random draws so existing sample data stays stable. Unisex names stay unknown.
      gender: FEMALE.has(givenName) ? 'Female' : MALE.has(givenName) ? 'Male' : undefined,
      location: n % 9 === 4 ? undefined : LOCATIONS[(n * 7) % LOCATIONS.length],
      nationality: rng.chance(0.9) ? 'Nigeria' : rng.pick(['Ghana', 'Kenya', 'United Kingdom']),
      verificationLevel: rng.chance(0.15) ? 'basic' : rng.chance(0.3) ? 'high-assurance' : 'verified',
      linkedProducts: rng.chance(0.25) ? ['Fixiam'] : [],
    });
  }
  return out;
}
