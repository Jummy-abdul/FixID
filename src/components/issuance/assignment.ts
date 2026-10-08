/**
 * Credential assignment context, carried in the URL of Credential Management (`/credentials/issue`)
 * so it survives navigation and refresh. Recipients are a list, so the same flow can later
 * assign one configuration to many users.
 */
export type AssignOrigin = 'new-user' | 'user';
export type AssignStep = 'select' | 'recipients' | 'review';

export interface AssignContext {
  recipientIds: string[];
  credentialTypeId?: string;
  from?: AssignOrigin;
  step?: AssignStep;
}

export const ASSIGN_PATH = '/credentials/issue';

export function assignUrl(ctx: AssignContext): string {
  const p = new URLSearchParams();
  if (ctx.recipientIds.length) p.set('recipients', ctx.recipientIds.join(','));
  if (ctx.credentialTypeId) p.set('credential', ctx.credentialTypeId);
  if (ctx.from) p.set('from', ctx.from);
  if (ctx.step && ctx.step !== 'select') p.set('step', ctx.step);
  const q = p.toString();
  return q ? `${ASSIGN_PATH}?${q}` : ASSIGN_PATH;
}

export function readList(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
