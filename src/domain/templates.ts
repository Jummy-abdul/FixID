import type { CardDesign, CredentialType, TemplateId, ValidityRule } from './types';

export interface StarterTemplate {
  id: TemplateId;
  name: string;
  orientation: 'landscape' | 'portrait';
  description: string;
}

/** Reusable starter designs. Each has a front and a back with defined placeholders. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  { id: 'classic-landscape', name: 'Classic Landscape', orientation: 'landscape', description: 'Formal institutional card with a QR code on the back.' },
  { id: 'modern-landscape', name: 'Modern Landscape', orientation: 'landscape', description: 'Minimal and contemporary, with return instructions on the back.' },
  { id: 'classic-portrait', name: 'Classic Portrait', orientation: 'portrait', description: 'Vertical badge with a large portrait and a QR code on the back.' },
  { id: 'modern-portrait', name: 'Modern Portrait', orientation: 'portrait', description: 'Bold vertical layout with instructions on the back.' },
];

export const DEFAULT_TEMPLATE_ID: TemplateId = 'classic-landscape';

export const templateById = (id: TemplateId | string | undefined) =>
  STARTER_TEMPLATES.find((t) => t.id === id) ?? STARTER_TEMPLATES[0];

/** Illustrative expiry for previews of a rule, as if issued today. */
export function sampleExpiry(v: ValidityRule, now = new Date()): string | null {
  if (v.kind === 'no-expiry') return null;
  if (v.kind === 'fixed-date') return v.date || null;
  const d = new Date(now);
  if (v.kind === 'duration') d.setMonth(d.getMonth() + (Number.isFinite(v.months) ? v.months : 0));
  else d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}

/** Starter template that best matches an older card design. */
export function templateForDesign(design: Pick<CardDesign, 'layout'> | undefined): TemplateId {
  return design?.layout === 'vertical' ? 'classic-portrait' : 'classic-landscape';
}

/** The template, name, identifier label and logo an issued credential was issued with. */
export function issuedLook(
  credential: { snapshot?: { credentialName: string; templateId: TemplateId; identifierLabel: string; logoAssetId?: string } },
  type: Pick<CredentialType, 'name' | 'templateId' | 'identifier' | 'logoAssetId'> | undefined,
  identifierLabel?: string,
): { credentialName: string; templateId: TemplateId; identifierLabel: string; logoAssetId?: string } {
  return credential.snapshot ?? {
    credentialName: type?.name ?? 'Digital ID',
    templateId: type?.templateId ?? DEFAULT_TEMPLATE_ID,
    identifierLabel: identifierLabel ?? type?.identifier.label ?? 'ID number',
    logoAssetId: type?.logoAssetId,
  };
}
