/**
 * Custom identity integrations: organization-owned connections to external identity services, through one
 * standard FixID contract (Identity Record Lookup and Biometric Matching). Each integration belongs to one
 * organization; nothing here is shared across organizations or listed in a global catalogue.
 */

export type IntegrationCapability = 'lookup' | 'matching';
export type IntegrationStatus = 'draft' | 'testing' | 'active' | 'inactive' | 'error';
export type IntegrationAuthMethod = 'oauth2-client-credentials' | 'api-key' | 'mtls';
/**
 * Where requests go. `simulated` is the built-in Simulated Identity Service (fictional records, no real
 * matching). `external` is a real service: it would be called only through a secure FixID integration
 * backend, which this prototype doesn't have, so external requests are disabled.
 */
export type IntegrationTarget = 'simulated' | 'external';

export const CONTRACT_VERSION = '1.0';
export const SIMULATED_BASE_URL = 'simulated://identity-service';
export const TIMEOUT_RANGE = { min: 2, max: 30, default: 10 };

export const CAPABILITY_LABEL: Record<IntegrationCapability, string> = { lookup: 'Identity Record Lookup', matching: 'Biometric Matching' };
export const CAPABILITY_DESCRIPTION: Record<IntegrationCapability, string> = {
  lookup: 'Retrieve an identity record using an authorized external reference.',
  matching: 'Request biometric matching against a reference held by the external service.',
};
export const AUTH_METHOD_LABEL: Record<IntegrationAuthMethod, string> = {
  'oauth2-client-credentials': 'OAuth 2.0 Client Credentials', 'api-key': 'API Key', mtls: 'Mutual TLS',
};
export const STATUS_LABEL: Record<IntegrationStatus, string> = { draft: 'Draft', testing: 'Testing', active: 'Active', inactive: 'Inactive', error: 'Error' };

/**
 * Connection configuration. Secrets (client secret, API key, private keys) are never part of it: in
 * production they live in FixID's server-side secret manager and the configuration only records whether
 * one is held. The prototype has no secret manager, so it never collects them.
 */
export interface IntegrationConnection {
  target: IntegrationTarget;
  baseUrl: string;
  authMethod: IntegrationAuthMethod;
  oauth?: { tokenEndpoint: string; clientId: string; scope?: string };
  apiKey?: { headerName: string };
  mtls?: { certificateRef: string };
  /** Whether the credential is held by the secret manager (external) or simulated (simulated target). */
  credential: 'simulated' | 'stored' | 'missing';
  timeoutSeconds: number;
}

export interface IntegrationCheck { id: 'configuration' | 'authentication' | 'lookup' | 'matching' | 'schema' | 'errors'; label: string; outcome: 'passed' | 'failed' | 'skipped'; detail: string }

export interface IntegrationTestRun {
  id: string;
  at: string;
  by: string;
  configVersion: number;
  ok: boolean;
  /** One line, e.g. "Connection successful." or "Authentication failed." Never contains secrets. */
  summary: string;
  checks: IntegrationCheck[];
  /** Ran against the Simulated Identity Service (and which demo scenario, if one was chosen). */
  simulated: boolean;
  scenario?: string;
}

export interface CustomIntegration {
  id: string;
  /** The only organization that can see, use or manage it. */
  organizationId: string;
  name: string;
  description: string;
  capabilities: IntegrationCapability[];
  /** Label for the external identifier people present, e.g. "External Reference ID". Configuration data. */
  referenceLabel: string;
  /** Lookup attributes FixID may use for verification; anything else a provider returns is dropped. */
  permittedAttributes: string[];
  connection: IntegrationConnection;
  contractVersion: string;
  /** Increases with every security-sensitive change; a successful test only counts for the version tested. */
  configVersion: number;
  validatedConfigVersion?: number;
  status: IntegrationStatus;
  /** Status to return to when a test finishes (set while Testing). */
  statusBeforeTest?: IntegrationStatus;
  lastSuccessfulTestAt?: string;
  lastFailedTestAt?: string;
  /** Most recent first, at most 10. */
  tests: IntegrationTestRun[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/* ---------------- Form ---------------- */

export interface IntegrationFormValues {
  name: string;
  description: string;
  capabilities: IntegrationCapability[];
  referenceLabel: string;
  permittedAttributes: string[];
  target: IntegrationTarget;
  baseUrl: string;
  authMethod: IntegrationAuthMethod;
  tokenEndpoint: string;
  clientId: string;
  scope: string;
  headerName: string;
  certificateRef: string;
  timeoutSeconds: number;
}

export type IntegrationFormErrors = Partial<Record<keyof IntegrationFormValues, string>>;

export const DEFAULT_ATTRIBUTES = ['displayName', 'recordStatus'];

export function emptyIntegrationForm(): IntegrationFormValues {
  return {
    name: '', description: '', capabilities: ['lookup', 'matching'], referenceLabel: '', permittedAttributes: DEFAULT_ATTRIBUTES,
    target: 'simulated', baseUrl: SIMULATED_BASE_URL, authMethod: 'oauth2-client-credentials', tokenEndpoint: '', clientId: '', scope: '', headerName: 'X-API-Key',
    certificateRef: '', timeoutSeconds: TIMEOUT_RANGE.default,
  };
}

export function formFromIntegration(i: CustomIntegration): IntegrationFormValues {
  const c = i.connection;
  return {
    name: i.name, description: i.description, capabilities: i.capabilities, referenceLabel: i.referenceLabel, permittedAttributes: i.permittedAttributes,
    target: c.target, baseUrl: c.baseUrl, authMethod: c.authMethod, tokenEndpoint: c.oauth?.tokenEndpoint ?? '', clientId: c.oauth?.clientId ?? '', scope: c.oauth?.scope ?? '',
    headerName: c.apiKey?.headerName ?? 'X-API-Key', certificateRef: c.mtls?.certificateRef ?? '', timeoutSeconds: c.timeoutSeconds,
  };
}

const httpsUrl = (v: string) => { try { const u = new URL(v); return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password; } catch { return false; } };
/** Header names a configuration may never set: they carry authentication or routing FixID controls. */
const RESERVED_HEADERS = new Set(['authorization', 'cookie', 'host', 'proxy-authorization', 'x-forwarded-for', 'x-forwarded-host', 'forwarded', 'content-length', 'transfer-encoding']);

export function validateDetails(v: IntegrationFormValues): IntegrationFormErrors {
  const e: IntegrationFormErrors = {};
  if (!v.name.trim()) e.name = 'Enter an integration name.';
  else if (v.name.trim().length > 80) e.name = 'Use 80 characters or fewer.';
  if (v.description.length > 300) e.description = 'Use 300 characters or fewer.';
  if (!v.capabilities.length) e.capabilities = 'Choose at least one capability.';
  if (v.capabilities.includes('lookup') && !v.referenceLabel.trim()) e.referenceLabel = 'Enter the label people will see for the external reference.';
  else if (v.referenceLabel.length > 40) e.referenceLabel = 'Use 40 characters or fewer.';
  return e;
}

export function validateConnection(v: IntegrationFormValues): IntegrationFormErrors {
  const e: IntegrationFormErrors = {};
  if (v.target === 'external') {
    if (!v.baseUrl.trim()) e.baseUrl = 'Enter the base API URL.';
    else if (!httpsUrl(v.baseUrl.trim())) e.baseUrl = 'Enter a valid https:// URL (no credentials in the URL).';
    if (v.authMethod === 'oauth2-client-credentials') {
      if (!v.tokenEndpoint.trim()) e.tokenEndpoint = 'Enter the token endpoint.';
      else if (!httpsUrl(v.tokenEndpoint.trim())) e.tokenEndpoint = 'Enter a valid https:// URL.';
      if (!v.clientId.trim()) e.clientId = 'Enter the client ID.';
    }
    if (v.authMethod === 'mtls' && !v.certificateRef.trim()) e.certificateRef = 'Enter the managed certificate reference.';
  }
  if (v.authMethod === 'api-key') {
    if (!/^[A-Za-z][A-Za-z0-9-]{1,63}$/.test(v.headerName.trim())) e.headerName = 'Use letters, numbers and hyphens only.';
    else if (RESERVED_HEADERS.has(v.headerName.trim().toLowerCase())) e.headerName = 'This header is reserved and can’t be used for the API key.';
  }
  if (!Number.isInteger(v.timeoutSeconds) || v.timeoutSeconds < TIMEOUT_RANGE.min || v.timeoutSeconds > TIMEOUT_RANGE.max) e.timeoutSeconds = `Choose between ${TIMEOUT_RANGE.min} and ${TIMEOUT_RANGE.max} seconds.`;
  return e;
}

export function validateContract(v: IntegrationFormValues): IntegrationFormErrors {
  const e: IntegrationFormErrors = {};
  if (v.capabilities.includes('lookup')) {
    if (!v.permittedAttributes.length) e.permittedAttributes = 'Choose at least one attribute FixID may use.';
    else if (v.permittedAttributes.some((a) => !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(a))) e.permittedAttributes = 'Attribute names use letters, numbers and underscores.';
  }
  return e;
}

export const validateIntegrationForm = (v: IntegrationFormValues) => ({ ...validateDetails(v), ...validateConnection(v), ...validateContract(v) });

export function connectionFromForm(v: IntegrationFormValues): IntegrationConnection {
  const simulated = v.target === 'simulated';
  return {
    target: v.target, baseUrl: simulated ? SIMULATED_BASE_URL : v.baseUrl.trim(), authMethod: v.authMethod,
    ...(v.authMethod === 'oauth2-client-credentials' ? { oauth: { tokenEndpoint: simulated ? `${SIMULATED_BASE_URL}/oauth/token` : v.tokenEndpoint.trim(), clientId: simulated ? 'simulated-client' : v.clientId.trim(), ...(v.scope.trim() ? { scope: v.scope.trim() } : {}) } } : {}),
    ...(v.authMethod === 'api-key' ? { apiKey: { headerName: v.headerName.trim() } } : {}),
    ...(v.authMethod === 'mtls' ? { mtls: { certificateRef: simulated ? 'simulated-certificate' : v.certificateRef.trim() } } : {}),
    // No secret manager in this prototype: external credentials are never collected, so they're missing.
    credential: simulated ? 'simulated' : 'missing',
    timeoutSeconds: v.timeoutSeconds,
  };
}

/** Whether a change affects how FixID connects or what it validates: it invalidates earlier successful tests. */
export function isSecuritySensitiveChange(before: CustomIntegration, after: { capabilities: IntegrationCapability[]; connection: IntegrationConnection }): boolean {
  const caps = (x: IntegrationCapability[]) => [...x].sort().join();
  return caps(before.capabilities) !== caps(after.capabilities) || JSON.stringify(before.connection) !== JSON.stringify(after.connection);
}

/** Whether an integration can be activated now. */
export const canActivateIntegration = (i: CustomIntegration) =>
  i.validatedConfigVersion === i.configVersion && (i.status === 'draft' || i.status === 'inactive');

/* ---------------- Standard contract v1.0 (documentation shown during setup) ---------------- */

export const LOOKUP_OUTCOMES = ['FOUND', 'NOT_FOUND', 'MULTIPLE_MATCHES', 'UNAVAILABLE', 'ERROR'] as const;
export const MATCH_OUTCOMES = ['MATCH', 'NO_MATCH', 'INCONCLUSIVE', 'UNAVAILABLE', 'ERROR'] as const;
export type LookupOutcome = (typeof LOOKUP_OUTCOMES)[number];
export type MatchOutcome = (typeof MATCH_OUTCOMES)[number];

export const CONTRACT_EXAMPLES = {
  lookupRequest: { referenceType: 'EXTERNAL_ID', referenceValue: 'DEMO-10001', requestId: 'REQ-0001', purpose: 'IDENTITY_VERIFICATION' },
  lookupResponse: { requestId: 'REQ-0001', status: 'FOUND', record: { referenceId: 'REF-10001', displayName: 'Sample Person', attributes: { recordStatus: 'ACTIVE' } } },
  matchRequest: { requestId: 'REQ-0002', referenceId: 'REF-10001', modality: 'FACE', captureReference: 'TRANSIENT-CAPTURE-REFERENCE', livenessEvidenceReference: 'LIVENESS-REFERENCE' },
  matchResponse: { requestId: 'REQ-0002', status: 'MATCH', providerTransactionId: 'EXT-TXN-10001', result: { score: 0.96, scoreScale: '0_TO_1', threshold: 0.85 } },
};
