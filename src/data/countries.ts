/** Countries offered in forms, with calling codes. Nigeria first as the default. */
export interface Country { code: string; name: string; dial: string; regions?: string[]; timezone?: string }

const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'Federal Capital Territory', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun',
  'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];
const GHANA_REGIONS = [
  'Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East', 'Northern', 'Oti', 'Savannah', 'Upper East',
  'Upper West', 'Volta', 'Western', 'Western North',
];
const KENYA_COUNTIES = ['Mombasa', 'Kisumu', 'Nairobi', 'Nakuru', 'Uasin Gishu', 'Kiambu', 'Machakos', 'Kakamega', 'Meru', 'Nyeri'];

export const COUNTRIES: Country[] = [
  { code: 'NG', name: 'Nigeria', dial: '+234', regions: NIGERIA_STATES, timezone: 'Africa/Lagos' },
  { code: 'GH', name: 'Ghana', dial: '+233', regions: GHANA_REGIONS, timezone: 'Africa/Accra' },
  { code: 'KE', name: 'Kenya', dial: '+254', regions: KENYA_COUNTIES, timezone: 'Africa/Nairobi' },
  { code: 'ZA', name: 'South Africa', dial: '+27', timezone: 'Africa/Johannesburg' },
  { code: 'EG', name: 'Egypt', dial: '+20' },
  { code: 'ET', name: 'Ethiopia', dial: '+251' },
  { code: 'TZ', name: 'Tanzania', dial: '+255' },
  { code: 'UG', name: 'Uganda', dial: '+256' },
  { code: 'RW', name: 'Rwanda', dial: '+250' },
  { code: 'CM', name: 'Cameroon', dial: '+237' },
  { code: 'CI', name: "Côte d'Ivoire", dial: '+225' },
  { code: 'SN', name: 'Senegal', dial: '+221' },
  { code: 'BJ', name: 'Benin', dial: '+229' },
  { code: 'TG', name: 'Togo', dial: '+228' },
  { code: 'SL', name: 'Sierra Leone', dial: '+232' },
  { code: 'LR', name: 'Liberia', dial: '+231' },
  { code: 'GM', name: 'Gambia', dial: '+220' },
  { code: 'MA', name: 'Morocco', dial: '+212' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', timezone: 'Europe/London' },
  { code: 'IE', name: 'Ireland', dial: '+353' },
  { code: 'US', name: 'United States', dial: '+1', timezone: 'America/New_York' },
  { code: 'CA', name: 'Canada', dial: '+1' },
  { code: 'DE', name: 'Germany', dial: '+49' },
  { code: 'FR', name: 'France', dial: '+33' },
  { code: 'NL', name: 'Netherlands', dial: '+31' },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966' },
  { code: 'IN', name: 'India', dial: '+91' },
  { code: 'CN', name: 'China', dial: '+86' },
  { code: 'AU', name: 'Australia', dial: '+61' },
];

export const DEFAULT_COUNTRY = 'NG';
export const countryByCode = (code: string | undefined) => COUNTRIES.find((c) => c.code === code);

/**
 * Normalizes a national number to E.164 (e.g. 0803 555 0101 with +234 → +2348035550101).
 * Returns null when the number can't be valid.
 */
export function toE164(dial: string, national: string): string | null {
  let digits = national.replace(/\D/g, '');
  const cc = dial.replace(/\D/g, '');
  if (national.trim().startsWith('+')) {
    if (!digits.startsWith(cc)) return null;
    digits = digits.slice(cc.length);
  }
  digits = digits.replace(/^0+/, '');
  if (digits.length < 6 || cc.length + digits.length > 15) return null;
  return `+${cc}${digits}`;
}
