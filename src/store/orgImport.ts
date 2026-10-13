import { parseCsv } from '@/lib/csv';
import type { AuditEvent } from '@/domain/types';
import { actorPermissions } from './adminOps';
import { applyCreateSubOrganization, canHaveSubOrganizations, subOrganizationProblems, type SubOrganizationValues } from './orgOps';
import type { AppState } from './state';

/**
 * Bulk organization upload: many organizations from one CSV file, each created exactly as "Add organization"
 * creates one (its own workspace, a relationship to the uploading organization, and an invitation for its
 * administrator). Rows are checked before anything is created and again when they're created. Uploading
 * never invites an organization to a verification activity.
 */

export const ORG_IMPORT_COLUMNS = ['Organization name', 'Administrator email'] as const;
export const ORG_TEMPLATE_ROWS = [[...ORG_IMPORT_COLUMNS], ['Example University', 'admin@example-university.example']];
export const ORG_TEMPLATE_FILE = 'fixid-organizations-template.csv';
export const MAX_ORG_ROWS = 500;
export const MAX_ORG_FILE_BYTES = 512 * 1024;

export type OrgRowStatus = 'ready' | 'exists' | 'invalid';
export interface OrgImportRow { row: number; name: string; adminEmail: string; status: OrgRowStatus; problems: string[] }
export type OrgFileCheck = { ok: true; rows: OrgImportRow[] } | { ok: false; error: string };

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

/** The values "Add organization" would use for a row: only name and administrator are asked; the rest are defaults. */
export function rowValues(state: AppState, parentId: string, name: string, adminEmail: string): SubOrganizationValues {
  const parent = state.data.organizations.find((o) => o.id === parentId);
  return { name, adminEmail, shortName: '', industry: '', contactEmail: '', phone: '', memberLabel: 'Member', timezone: parent?.timezone ?? '' };
}

type Seen = { names: Map<string, number>; emails: Map<string, number> };

/** One row's status: already in FixID (skipped), needs attention (with reasons), or ready. */
function checkRow(state: AppState, parentId: string, row: number, rawName: string, rawEmail: string, seen: Seen, now: Date): OrgImportRow {
  const name = rawName.trim().replace(/\s+/g, ' ');
  const adminEmail = rawEmail.trim();
  const problems: string[] = [];
  const nameKey = norm(name);
  const emailKey = norm(adminEmail);
  const firstName = nameKey ? seen.names.get(nameKey) : undefined;
  const firstEmail = emailKey ? seen.emails.get(emailKey) : undefined;
  if (nameKey && firstName === undefined) seen.names.set(nameKey, row);
  if (emailKey && firstEmail === undefined) seen.emails.set(emailKey, row);
  // An organization with this name already exists in FixID: skipped, never created twice.
  if (nameKey && state.data.organizations.some((o) => norm(o.name) === nameKey)) {
    return { row, name, adminEmail, status: 'exists', problems: ['Already in FixID.'] };
  }
  if (firstName !== undefined) problems.push(`Same organization as row ${firstName}.`);
  const errors = subOrganizationProblems(state, parentId, rowValues(state, parentId, name, adminEmail), now);
  if (!name) problems.push('Organization name is missing.');
  else if (errors.name && firstName === undefined) problems.push(errors.name);
  if (!adminEmail) problems.push('Administrator email is missing.');
  else if (firstEmail !== undefined) problems.push(`Same administrator email as row ${firstEmail}.`);
  else if (errors.adminEmail) problems.push(errors.adminEmail);
  return { row, name, adminEmail, status: problems.length ? 'invalid' : 'ready', problems };
}

/** Reads and checks an uploaded file. Nothing is created. */
export function checkOrganizationFile(state: AppState, parentId: string, file: { name: string; size?: number; text: string }, now = new Date()): OrgFileCheck {
  if (!/\.csv$/i.test(file.name)) return { ok: false, error: 'Upload a CSV file (.csv). Download the template to start.' };
  if ((file.size ?? file.text.length) > MAX_ORG_FILE_BYTES) return { ok: false, error: 'The file is too large. Split it into smaller files.' };
  if (!file.text.replace(/^﻿/, '').trim()) return { ok: false, error: 'The file is empty.' };
  // eslint-disable-next-line no-control-regex
  if (/\u0000/.test(file.text)) return { ok: false, error: 'This file can’t be read as CSV. Save it as CSV and upload it again.' };
  const parsed = parseCsv(file.text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const lines = parsed.rows.map((cells, i) => ({ cells, row: i + 1 })).filter((l) => l.cells.some((c) => c.trim()));
  const [header, ...data] = lines;
  const cols = header.cells.map(norm);
  const nameAt = cols.indexOf(norm(ORG_IMPORT_COLUMNS[0]));
  const emailAt = cols.indexOf(norm(ORG_IMPORT_COLUMNS[1]));
  if (nameAt < 0 || emailAt < 0) return { ok: false, error: `The first row must have the template headings: ${ORG_IMPORT_COLUMNS.join(', ')}.` };
  const unknown = header.cells.find((c, i) => c.trim() && i !== nameAt && i !== emailAt);
  if (unknown) return { ok: false, error: `Unknown column “${unknown.trim()}”. Use the template’s columns only.` };
  if (!data.length) return { ok: false, error: 'The file has no organizations. Add one per row below the headings.' };
  if (data.length > MAX_ORG_ROWS) return { ok: false, error: `The file has ${data.length} organizations. Upload at most ${MAX_ORG_ROWS} at a time.` };
  const seen: Seen = { names: new Map(), emails: new Map() };
  return { ok: true, rows: data.map((l) => checkRow(state, parentId, l.row, l.cells[nameAt] ?? '', l.cells[emailAt] ?? '', seen, now)) };
}

export type OrgImportOutcome = 'created' | 'exists' | 'failed';
export interface OrgImportResult { row: number; name: string; adminEmail: string; outcome: OrgImportOutcome; reason?: string; organizationId?: string }
export interface BulkCreateInput {
  parentOrganizationId: string;
  rows: { row: number; name: string; adminEmail: string; ids: { organizationId: string; administratorId: string; relationshipId: string }; token: string }[];
  at: string;
}

/**
 * Creates the ready rows, re-checking each against the current data (so a row that became a duplicate since
 * the preview is skipped, not created twice). Rows that aren't ready are reported, never created.
 */
export function applyBulkCreateOrganizations(state: AppState, input: BulkCreateInput): { ok: true; state: AppState; results: OrgImportResult[] } | { ok: false; error: string } {
  const parent = state.data.organizations.find((o) => o.id === input.parentOrganizationId);
  if (!parent) return { ok: false, error: 'This organization doesn’t exist.' };
  if (!actorPermissions(state, parent.id).has('organizations.manage')) return { ok: false, error: "You don't have permission to create organizations." };
  if (!canHaveSubOrganizations(state, parent.id)) return { ok: false, error: 'A sub-organization can’t create organizations of its own.' };
  if (!input.rows.length) return { ok: false, error: 'There are no organizations to import.' };
  let s = state;
  const seen: Seen = { names: new Map(), emails: new Map() };
  const results: OrgImportResult[] = input.rows.map((r) => {
    const check = checkRow(s, parent.id, r.row, r.name, r.adminEmail, seen, new Date(input.at));
    const base = { row: r.row, name: check.name, adminEmail: check.adminEmail };
    if (check.status === 'exists') return { ...base, outcome: 'exists', reason: 'Already in FixID.' };
    if (check.status === 'invalid') return { ...base, outcome: 'failed', reason: check.problems.join(' ') };
    const created = applyCreateSubOrganization(s, { parentOrganizationId: parent.id, ids: r.ids, token: r.token, values: rowValues(s, parent.id, check.name, check.adminEmail), at: input.at });
    if (!created.ok) return { ...base, outcome: 'failed', reason: created.error };
    s = created.state;
    return { ...base, outcome: 'created', organizationId: r.ids.organizationId };
  });
  const count = (o: OrgImportOutcome) => results.filter((r) => r.outcome === o).length;
  const actor = state.data.admin.name;
  const max = s.data.audit.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0);
  const summary: AuditEvent = {
    id: `AUD-${String(max + 1).padStart(5, '0')}`, organizationId: parent.id, action: 'organization.bulk-imported', actor, actorType: 'admin', result: count('created') ? 'success' : 'failure',
    occurredAt: input.at, resourceType: 'organization', resourceId: parent.id,
    summary: `${actor} uploaded ${results.length} organizations: ${count('created')} created, ${count('exists')} already in FixID, ${count('failed')} failed.`, href: '/organizations',
  };
  return { ok: true, state: { ...s, data: { ...s.data, audit: [summary, ...s.data.audit] } }, results };
}
