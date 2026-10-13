# FixID — Organization Portal Prototype

Interactive prototype of **FixID**, Seamfix's reusable identity and credential platform, from an organization administrator's perspective.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration tests (Vitest, Testing Library)
npm run typecheck
npm run build
```

Demo data is generated on first load and persisted in `localStorage` (`fixid.prototype.state`). Reset it from **Settings → Demo data**.

## Product boundaries modelled

| Owner | Owns | In this prototype |
|---|---|---|
| **ID Switch** | Canonical identity (name, email, phone, DOB) | `services/mockIdSwitch.ts`. Never copied into FixID state; FixID stores only `idSwitchId`. |
| **FixID** | Org context, credential types, issuance, verification activities, transactions, audit | App store (`store/`) |
| **Seamfix Wallet** | Holder experience | `services/mockWallet.ts`. FixID tracks delivery status only. |
| **Fixiam** | Workforce IAM (optional) | Shown as an optional integration and attribute source. |

## Architecture

```
src/
  domain/            types, labels, trust rules (assurance/fallback), metrics
  data/              deterministic seed + simulated ID Switch registry
  store/             reducer, org-scoped selectors, localStorage persistence
  services/          service interfaces + mock adapters (ID Switch, issuance, wallet)
  components/ui      shared design system (Button, Card, Table, Modal, Toast, Form…)
  components/domain  FixID components (DigitalIdCard, PolicyFlow, StatusBadges…)
  layout/            shell: sidebar, org switcher, global search, admin menu
  pages/             route destinations
```

- **One connected store.** Every page reads from `useOrgData()`, which scopes all entities to the current organization. Nothing is hardcoded per page.
- **Services behind interfaces.** `ServicesProvider` takes a `Services` object, so mock adapters can be swapped for real ones without UI changes.
- **Filters live in the URL**, so dashboard tiles deep-link to filtered lists.
- **Planned features** open an explicitly labelled dialog (`components/domain/PlannedFeature.tsx`) and never simulate success.

## Navigation

| Section | Item | Route |
|---|---|---|
| — | Dashboard | `/` |
| User Management | Users · Groups | `/users` · `/groups`, `/groups/:id` |
| Credential Management | Credentials · Templates | `/credentials` · `/templates` (card designs), `/templates/credential-types` |
| Verification | Verification Activities (own and shared) · Verification History · Exceptions · Reports | `/verification-activities` · `/verification-history` · `/exceptions` · `/reports` |
| Administration | Audit Log · Settings | `/audit` · `/settings` |

Previous paths (`/people`, `/transactions`, `/card-designs`, `/credential-types`, including detail pages and query strings) redirect to their new routes. The former Verification Events page is no longer in the navigation: `/activities` redirects to Verification Activities and `/activities/:id` to Verification History filtered to that event. Its sample records are kept and shown in Verification History.

The top bar contains only the App Launcher and the profile menu (`/profile`). Applications are listed in `src/config/applications.ts`; external destinations are read from `VITE_FIXIAM_URL` and `VITE_ADMIN_URL` and shown as "Not configured" until set.

Deployed on Vercel from this repository. `vercel.json` rewrites all paths to `index.html` so deep links and refresh work; other hosts need the same fallback.

## Demo workspaces

The app opens in **Crestfield Organization**, a brand-new organization with no users, credentials or activities, so the first-time journey runs on real data. Northbridge Group, Meridian Group (with two sub-organizations) and Brightwater Tech Summit are established sample organizations; all names, places and identifiers in sample data are fictional. Switch under **Settings → Demo data**, or sign in with a demonstration account (see Organizations, workspaces and demo accounts).

## Sign in, sign up and onboarding

- **Demo account:** `demo@fixid.app` / `FixIDDemo2026!` (demo mode only). Opens the existing sample organizations; Settings → Demo data and the dashboard preview are available to this account only.
- **Sign up:** `/signup` (email) → `/verify-email` (6-digit code) → `/create-password` → `/onboarding/personal` → `/onboarding/organization` → first-time dashboard of a new, empty organization.
- **Development verification code:** `123456`. No email provider is connected, so no message is actually sent; the code is accepted only in demo mode, expires after 10 minutes and allows 5 attempts. Resend restarts the timer and attempts.
- **Forgot password:** see *Password reset* under Authentication, SSO and access control.
- **Routes:** signed-out visitors are sent to `/signin`; signed-in administrators who haven't finished onboarding resume it; Sign out is in the account menu.

**This is prototype authentication, not a security boundary.** Accounts live in local storage (`fixid.auth.v1`) with passwords salted and hashed (PBKDF2-SHA256), and the sign-up session in session storage (never the code itself). Route checks are client-side only. Production needs a backend identity provider for accounts, email delivery of verification and reset codes, password storage, sessions and authorization. Demo mode is on unless the build sets `VITE_DEMO_AUTH=off`, which disables the demo account and the development code.

Each signed-up organization has its own records (`ownerAccountId` on the organization). The signed-in administrator can only act in their own organization; resetting demo data keeps organizations created through sign-up.


**Organization registration (Epic 01).** Self-service: account email (verified) and password → first and last name → organization name, country and optional state/region → **Create organization**. The person registering becomes the organization's first, active Organization Administrator, and the organization gets its own workspace (Organization Email defaults to their email; Short Name is derived from the name; Industry, Default Person Label and Time Zone get defaults that can be changed later). Registration only completes when the organization and its administrator record both exist; otherwise the form shows an error and nothing is marked ready. The workspace then opens with a one-time **Your organization is registered** confirmation (Organization ID, role, the email to sign in with, and a link to the profile). No address, staff invitations or approval steps are part of registration. Gap noted: the approved onboarding requirements don't specify further registration fields (e.g. organization phone or industry at sign-up), so none were added.
## Authentication, SSO and access control (Epic 03)

**Settings → Security → Single Sign-On (SSO)** (`/settings?tab=security`, needs the new **Manage SSO configuration** permission (`sso.manage`), which Organization Admin has by default and custom roles may include). One OIDC connection per organization (R1), stored with that organization only (`data.ssoConnections`).

- **Statuses:** *Not Configured* (nothing saved), *Not Activated* (saved, not enabled), *Active* (tested and activated). A failed test shows an error and changes no status.
- **Configure (Story 01):** provider **Fixiam** or **Custom OIDC**; Issuer URL (https, no query or fragment), Client ID, Client secret (required for Fixiam; optional for Custom OIDC public clients). The read-only **FixID Redirect URI** (`<origin>/sso/callback`) has a Copy action. Saving never activates SSO. The client secret is never shown again and **isn't kept in the browser**: only “Saved (hidden)” is recorded; production sends it to the FixID backend for encrypted storage.
- **Test and activate (Story 02):** **Test Connection** runs an OIDC authorization round trip (state, nonce, single-use callback). **Activate SSO** is enabled only after a successful test of exactly the saved version; filling in the form never counts as a test. Every saved change is a new version that needs its own test.
- **Update, discard, disable (Story 05):** edits to an active connection are saved as **pending**; the active configuration keeps working until the pending one is tested and activated (**Activate Changes**), or the changes are **discarded**. **Disable SSO** (with confirmation) stops new SSO sign-ins, keeps the configuration and needs a new test before reactivation; existing sessions aren't ended. Email and password sign-in is never affected. All of this is audited (Audit Log → *Single sign-on*).
- **Sign in with SSO (Story 03):** Sign in → **Sign in with SSO** → **Organization ID** (Settings → Organization) → **Sign in with {provider}** → identity provider → `/sso/callback`. Organization discovery uses the Organization ID, never the email domain (a domain proves nothing and may be shared); unknown IDs and organizations without active SSO get the same answer. The response is validated against the pending request (state, nonce, issuer, client, active version) and gives a session only to an identity **linked** to an **active** administrator of that organization. Cancelled, unavailable and invalid responses each get a clear message, with a way back to email and password.
- **Linking (Story 04):** an administrator signed in with email and password links their own identity from **My Profile → Sign-in methods → Link SSO identity**. FixID stores the provider's issuer and stable subject ID (`ssoIdentity`), never matches by email, keeps role, status and organization, and refuses an identity already linked to another administrator or from an untrusted issuer or client. SSO never creates administrators or assigns roles; unlinked identities get no access. Changing the issuer means administrators link again.
- **Demonstration mode (no OIDC backend in this prototype):** tests, links and SSO sign-ins go to a **demonstration identity provider** (`/sso/demo-provider`), labelled as simulated on every screen: it contacts no provider, checks no password and issues no tokens; you choose the identity to simulate (the same identity always gets the same subject ID), or simulate cancel, provider unavailable or an invalid response. Results are marked *demonstration* (test results, links: “Demonstration link”). Setting `VITE_SSO_BACKEND_URL` switches to the live adapter (`src/services/sso.ts`), which only talks to a FixID backend: `GET /sso/authorize` (discovery, PKCE, redirect) and `POST /sso/callback` (code exchange and ID-token validation server-side, returning issuer, subject and audience). That backend doesn't exist yet.

**Sessions (Story 06).** Every sign-in (password or SSO) creates the same FixID session. **Provisional** defaults pending product and security confirmation: 30 minutes without activity, 8 hours maximum (`SESSION_POLICY`; `VITE_SESSION_IDLE_MINUTES`, `VITE_SESSION_MAX_HOURS`). Expired, idle and revoked sessions are rejected on load, every 30 seconds and when the tab becomes visible, and Sign in explains why. Deactivation and role or permission changes apply immediately to open sessions (permissions are derived from the stored role on every render). **Sign out** ends the FixID session and returns to Sign in; after an SSO session it says the person may still be signed in to their identity provider (FixID doesn't claim to sign them out there).

**Email and password (Stories 10, 11).** Always available, including when SSO is active, disabled or failing, so an Organization Admin can always reach Security to fix or disable SSO. Wrong credentials get one generic message. **Inactive** administrators are refused at sign-in. Invited administrators have no account until they accept. **Provisional protective control:** 5 failed attempts for an email within 15 minutes pause sign-in for that email for 15 minutes (unknown emails behave the same; `SIGN_IN_LOCKOUT`). Failed sign-ins never create a session.

**Password reset (Story 12).** Sign in → **Forgot password?** → email → the same confirmation whether or not an account exists. Eligible accounts (with a FixID password) get a single-use link (`/reset-password?token=…`, 256-bit random token; only its SHA-256 hash is stored) valid for **30 minutes (provisional**, `VITE_RESET_LINK_MINUTES`); a new request replaces an older unused link. The reset page checks the link (invalid, used or expired are refused), validates the password rules and confirmation, then **revokes every existing session of the account** (`sessionsValidAfter`) and returns to Sign in. The page notes that SSO passwords are reset with the identity provider. **No email is sent:** in demo builds the message appears in the **demonstration mailbox** (`/demo-mailbox`), labelled as simulated delivery and not part of FixID.

**Access control (Stories 07–09).** Navigation, pages, actions, direct URLs and store operations follow the Roles and Permissions Matrix (Organization Admin, Verifier, Auditor and created custom roles); `sso.manage` is the only new permission. The Auditor stays read-only and never sees raw biometric captures or templates (FixID never stores them: live captures are held in memory for one comparison only). Every change is refused for another organization in the reducer, whichever way the administrator signed in; records are looked up within the current organization only. Verifiers act only on activities they're assigned to, and removing an assignment removes access immediately (`authorizeVerifier`).

**Prototype limits.** All of this runs in the browser: route checks, permissions, lockout, session expiry and token checks can be bypassed by someone editing local storage. Production needs a FixID backend for OIDC (secret storage, discovery, PKCE, ID-token validation), server-side sessions and revocation, rate limiting, email delivery, and server-side authorization and tenant isolation for every request.

## Custom identity integrations (Phase 2)

**Settings → Integrations** (`/settings?tab=integrations`; reuses the formerly hidden Integrations tab). Two areas:
- **Built-in Verification:** *FixID Local Verification*, the existing local model (people and enrollments managed in Users). Always available; nothing to configure.
- **Custom Identity Services:** the organization's own external services (Integration Name, Capabilities, Status, Last Tested, Last Updated, Actions), with **Add Custom Integration** and the empty state *No custom identity services have been configured.*

**Permissions:** `integrations.manage` (Organization Admin) creates, edits, tests, activates and deactivates. `integrations.view` (Organization Admin, Auditor) shows read-only metadata; connection details are shown only to managers, and secrets never exist in the browser. Verifiers have neither; their verification activities will use integrations indirectly in a later phase. Every operation is checked in the owning organization only. A parent and its sub-organizations never see each other's integrations, other IDs show *Integration not available*, and there's no global catalogue. Platform Administrators see status and test summaries on `/platform`, not configuration.

**Add Custom Integration wizard (4 steps):**
1. Integration Name, Description, Capabilities (Identity Record Lookup, Biometric Matching, or both), Reference Identifier Label.
2. Service (*Simulated Identity Service*, or *External identity service*), Base API URL (https, no credentials in the URL), Authentication Method (OAuth 2.0 Client Credentials: token endpoint, client ID, scope; API Key: header name, with reserved headers refused; Mutual TLS: managed certificate reference), Timeout (2–30 s). No custom headers.
3. API contract 1.0 (request and response examples, outcomes, score and capture notes) and the **permitted lookup attributes**.
4. Review.

Saving creates a **Draft** and never activates.

**No secrets are collected.** Production keeps client secrets, API keys and private keys in FixID's server-side secret manager, and the configuration only records whether one is held (`credential`). This prototype has no secret manager: the simulated service uses a simulated credential, and external configurations are saved without one.

**Lifecycle:** Draft → Testing → Active ⇄ Inactive; Error when a test fails.
- **Activate** needs a successful test of the current configuration version, covering only the enabled capabilities: lookup-only doesn't need matching.
- **Security-sensitive changes** (connection, authentication, capabilities) increase the configuration version, invalidate the earlier test and return an Active integration to Draft. A name or description change doesn't.
- **Deactivate** (with confirmation) blocks new use (`usableIntegration`), keeps configuration, tests and audit records, and warns about the programmes and activities that use it (`integrationUsage`).
- **Audit:** every change and test is audited (Audit Log → *Integrations*).

**Connection test** (`runConnectionTest`) runs the contract against the configured service and validates every response: configuration, authentication, lookup compatibility (FOUND and NOT_FOUND test references), matching compatibility (when enabled), schema validity and error handling. It reports *Connection successful.*, *Authentication failed.*, *Lookup / Matching contract validation failed.*, *Service unavailable.* or *Request timed out.*, with a timestamp and per-check details. The last 10 tests are kept, never with secrets.

**FixID external identity verification contract 1.0** (`src/services/integrations/contract.ts`):
- **Identity Record Lookup:** `{referenceType, referenceValue, requestId, purpose}` → `{requestId, status: FOUND | NOT_FOUND | MULTIPLE_MATCHES | UNAVAILABLE | ERROR, record?}`.
- **Biometric Matching:** `{requestId, referenceId, modality: FACE, captureReference, livenessEvidenceReference?}` → `{requestId, status: MATCH | NO_MATCH | INCONCLUSIVE | UNAVAILABLE | ERROR, providerTransactionId?, result?: {score, scoreScale, threshold}}`.
- **Responses are validated** before use; anything non-conforming is an ERROR.
- **Lookup results are minimized** to the permitted attributes.
- **Scores keep the provider's own scale and threshold.** They aren't normalized or treated as comparable across engines.
- **Capture and liveness references are conceptual.** A real integration must also define a secure transfer of the capture.
- **Other APIs need a compatible adapter.** Field mapping isn't configurable.

**Integration service** (`src/services/integrations/integrationService.ts`): `lookupIdentity` and `matchBiometric` return validated, minimized results and never write anything: no Person records, no enrollment, no stored lookup attributes or biometrics (Model B, externally referenced identity). The local model (Model A) is unchanged. Transports are separate: the Simulated Identity Service, or an external service that would only be called through a secure FixID backend (secret manager, destination allow-listing, SSRF and private-network protection, no redirects). That backend doesn't exist, so **real external requests are disabled** (the browser never calls customer URLs) and external configurations fail their test at Authentication.

**Simulated Identity Service** (`src/services/integrations/simulatedIdentityService.ts`): fictional records, deterministic outcomes, every response marked `simulated`, and no real biometric comparison.
- **Lookup references:** `DEMO-10001` (found), `DEMO-10002` (found, suspended), `DEMO-20001` (not found), `DEMO-30001` (multiple), `DEMO-50001` (unavailable), `DEMO-40001` (invalid request).
- **Matching fixtures** (with `REF-10001`): `SIM-CAPTURE-MATCH`, `SIM-CAPTURE-NO-MATCH`, `SIM-CAPTURE-INCONCLUSIVE`, `SIM-CAPTURE-UNAVAILABLE`, `SIM-CAPTURE-UNSUPPORTED`.
- **Dev-only test scenarios** (Test Connection → *Demo tools — simulation only*, demo builds only): healthy, authentication fails, lookup or matching response breaks the contract, unavailable, timeout.

**Demonstration data:**
- **Organization A** (Northbridge): none; local verification only.
- **Organization B** (Meridian): *Group Identity Service*, lookup and matching, tested and **Active**.
- **Organization C** (Brightwater Tech Summit): *Attendee Records Service*, lookup only, **Draft**; and *Brightwater Identity Service*, simulated lookup and matching, **Active** (used by programme scenarios C and D).
- **Organization D** (sub-organization B1, Harbourside): *Hospital Identity Service*, an external configuration whose test failed (**Error**), so it can't be activated.

## Exceptions, programme oversight, audit and reporting (Phase 5)

**Verification Exceptions** (`src/domain/exceptions.ts`, `src/store/exceptionOps.ts`; *Exceptions* in the Verification menu, `/exceptions`, `/exceptions/:id`).
- **Creation:** a transaction whose decision is Pending Review under its activity or programme policy gets a linked exception automatically. A verifier's *Submit for Review* creates a *Disputed verification* exception.
- **Not every failure:** definitive failures (Deny) and outages that end as Unable to Decide (when the policy doesn't send them to review) stay completed transactions with no exception.
- **Reasons:** identity mismatch, inconclusive, failed mandatory liveness, record ambiguity, disputed, eligibility uncertainty, eligibility not met, missing evidence, service failure.
- **Routing:** when the programme escalates exceptions, they go to the programme owner's reviewers. Otherwise they stay with the transaction's own organization. The participant can view a programme-routed exception read-only.
- **Statuses:** Open, Assigned, In Review, Awaiting Information, Resolved, Closed. These are separate from the transaction's match result and decision.
- **Actions** (`exceptions.review`, only in the reviewing organization): Assign Reviewer or Assign to me, Start Review, Add Review Note (with evidence references), Request Information, Record Resolution, Close Exception.
  - Each action is recorded in the exception's history (actor, organization, previous and new status, comment) and in the Audit Log.
- **Resolutions:** Verification Confirmed, Verification Not Confirmed, Reverification Required, Unable to Resolve.
  - **Original evidence is never changed:** the result is stored as the transaction's `reviewDisposition`, beside the original identity match, liveness, eligibility and decision.
  - **Confirming a failed identity check:** *Verification Confirmed* is refused while the identity result isn't a match, or mandatory liveness didn't pass, unless a linked reverification succeeded. An eligibility question with a matched identity can be confirmed.
- **Reverification:**
  - *Reverification Required* sets the exception to Awaiting Information.
  - An assigned verifier in the transaction's organization uses *Start Reverification*, on the exception or on their result screen.
  - This creates a new transaction (`reverificationOf`) under the activity's current mandatory requirements; the original is unchanged.
  - When it finishes, the exception returns to In Review with the result recorded.

**Permissions** (added to the matrix):
- `exceptions.view`: read-only; Auditor.
- `exceptions.review`: assign, review, resolve; Organization Admin.
- `reports.view`: Organization Admin and Auditor.

Verifiers can submit for review but can't resolve. Custom roles honour whichever of these they're given.

**Programme oversight** (programme owner, on the programme page, plus `/programmes/:id/organizations/:orgId`):
- **Metrics:** participating organizations, active activities, total attempts, completed, pending reviews, unable to complete, outcomes by status, and programme exceptions.
- **Per-organization table:** participation status, active activities, attempts, completed, pending review, last activity and **Programme Configuration Status**.
  - Values are Meets Requirements, Action Required or Not Evaluated.
  - Checks: required identity source, required method, mandatory liveness, integration available, activity active.
  - It's explicitly not a legal or regulatory compliance claim.
- **Drill-down:** programme-linked activities with their configuration checks, aggregate outcomes, programme exceptions, and transaction summaries without people, references or attributes.
- **Never shown:** participants' other activities, people, private integrations or sibling records. Non-owners get *Not available*.

**Dashboards:**
- **Organization Admins and Auditors:** a *Verification operations* section (last 7 / 30 days / all time).
  - **Figures:** active activities, attempts, successful and unsuccessful outcomes, pending reviews, unable to complete.
  - **Lists:** recent transactions, recent exceptions, activity status and identity service status.
  - **Programme owners:** also *Programmes you oversee*.
- **Verifiers:** the dashboard now shows each recent transaction's current decision.
- **Platform Administrators:** see transaction and open-exception counts per organization only.

**Verification History:**
- **New filters:** programme, identity match, eligibility, transaction status and simulation, alongside date range, activity, identity source and decision.
- **Decision column:** shows the current disposition, marked *Reviewed* when a review changed it.
- **Transaction details:** link to the exception and show the reviewed disposition separately.

**Audit trail:**
- **New events:**
  - Exception lifecycle: `exception.*`.
  - Verification transactions: `verification.started`, `verification.completed`, `verification.cancelled`.
  - Access refusals: `access.denied`, recorded when someone opens another organization's transaction or exception, filed in both organizations without revealing details.
  - Status API requests: `api.status-requested` and `api.status-denied`.
- **New fields:** `actorId`, `actorOrganizationId`, `targetOrganizationId`, `correlationId`, and the `denied` result.
- **No edits:** there is no edit or delete path for audit entries. The log lives in browser storage, so it is illustrative, not tamper-resistant evidence; the Audit Log page says so.

**Reports** (`/reports`):
- **Organization verification report:** attempts, identity match outcomes, eligibility outcomes, decisions, pending reviews, unable to complete, activity breakdown.
- **Programme report:** owners only; participating organizations, volume, outcomes, exceptions, unresolved exceptions, activity breakdown.
- **Exception report:** totals, open, resolved, by reason, by activity, by organization. Median resolution time appears only when resolutions exist; otherwise *Not calculable*.
- **Reporting period:** 7, 30 or 90 days, or all time.
- **Export CSV:** aggregate figures only; never people, references, attributes or biometric data.

**Verification Status API — simulated** (`src/services/statusApi/statusApi.ts`; development page `/developer/status-api`, linked from Verification History in demo builds only):
- **Endpoint:** illustrates `GET /api/verifications/{transactionId}/status`.
- **Response fields:** `transactionId`, `status`, `identityMatch`, `eligibility`, `decision`, `programmeId` when permitted, `activityId`, `updatedAt`, `simulated: true`, `simulatedEvidence`, and `originalDecision` with `review` after a review.
- **Statuses:** IN_PROGRESS, PENDING_REVIEW, COMPLETED, UNABLE_TO_COMPLETE, INCOMPLETE, FAILED, CANCELLED. INCOMPLETE is an attempt interrupted before a result and timed out; it isn't a verification outcome. While an exception is unresolved the decision is PENDING_REVIEW, never ALLOW.
- **Authorization:**
  - The calling client must belong to the transaction's organization, or to the owner of its programme.
  - Unknown and unauthorized IDs both return 404; no client returns 401.
  - No personal information is returned.
- **Simulated:** runs in the browser with no network call, no real authentication and no secrets.

**Demonstration data:** `createInitialState` replays nine fictional transactions through the reducer's own verification steps (`src/store/demoTransactions.ts`), so the history, exceptions and audit events are ones the application itself produced.

| # | Scenario | How to see it |
|---|---|---|
| A | Successful verification | Brightwater (`demo@fixid.app`, switch workspace): Visitor Check-in `…-D06` → Allow; history, dashboard; Status API → COMPLETED / ALLOW |
| B | Mismatch requiring review | Victor Hale (`victor.hale@meridian.example`) → Exceptions → the Harbourside *Identity mismatch* (programme queue, Open) |
| C | Reverification required | Tobyson → Exceptions → Restricted Lounge mismatch → Reverification Required → Start Reverification → `DEMO-10001`, Passed + Match → back on the exception, Verification Confirmed |
| D | External service unavailable | Eastgate `…-D05` (lookup unavailable) and Brightwater `…-D09` (matching unavailable): Unable to Complete; no exception; Status API never ALLOW |
| E | Parent programme oversight | Victor Hale → Verification Programmes → Group Staff Verification: overview, per-organization drill-down |
| F | Auditor review | Adaora Nwosu (Northbridge Auditor), or any Auditor: Exceptions, history and Audit Log read-only, no actions |
| G | Unauthorized access | Esther Lawal opens `/verification-history/<a Brightwater transaction>` → not shown; `access.denied` recorded in both audit logs |
| H | Status API update | `/developer/status-api`: request `…-D08` (PENDING_REVIEW), resolve its exception, request again (COMPLETED, originalDecision kept, identityMatch still NO_MATCH) |

Also seeded: an eligibility exception already In Review by Victor Hale, with a note.

**Limitations:**
- **Not a security boundary:** authorization, audit and the status API run in the browser.
- **Simulated services:** all identity services are simulated.
- **Programme oversight:** limited to aggregates and programme exceptions. There's no cross-organization reviewer delegation beyond the programme owner.
- **Organization filter:** Verification History has none, because it always shows the active workspace; switch workspace to see another.
- **Saved browser data:** use Settings → Demo data → Reset to load Phase 5 data.

## Verification journeys and transactions (Phase 4)

Both identity models run through the same Verification Activity framework. The activity's configuration (and, for a programme-linked activity, the programme's authoritative requirements) decides the journey; the verifier never chooses the identity source, the matching service or whether liveness applies.

**Verification Transaction** (the existing `VerificationAttempt`, extended in `src/domain/types.ts`; logic in `src/domain/transactions.ts` and `src/store/transactionOps.ts`). Every attempt gets a transaction reference when it starts, including cancelled, failed and incomplete ones. New fields:
- **Context:** `identitySource` (local / external), `integrationId` and `serviceName`, and `programmeId`.
- **Lookup:** the entered reference, the referenceId, only the permitted attributes, the requestId and the number of lookups.
- **Identity checks:** `liveness`, and `match` (with the provider transaction ID, and score, scale and threshold only when the service supplied them).
- **Results:** `eligibilityStatus`, `decision` with `decisionExplanation`, and `failureReason`.
- **Links:** `reusedFrom` and `retryOf`.
- **Diagnostics:** protected technical messages, shown only to roles with audit access.

Stages: Initiated → Capture pending / Lookup completed → Pending Review, Completed, Failed, Cancelled or Unable to complete (`stageOf` also covers older records). Raw captures and biometric templates are never stored, and no local Person record or enrollment is ever created for an external identity.

**Journey A — local** (existing flow, refined). The steps are Identify Person, Capture / Verify and View Result:
- **Identify Person:** the organization's identifier. The lookup shows eligibility and the enrollment status (Enrolled / Not Enrolled / Enrollment Incomplete / Enrollment Unavailable), with a link to the user record for administrators who can edit users. Verification never enrolls anyone.
- **Capture / Verify:** the existing camera capture, then 1:1 face matching and liveness through the facial verification provider.
- **Eligibility:** the existing eligible population.
- **Simulated provider:** when no real provider is configured, an organization with demonstration biometrics (`integrations.simulatedBiometrics`, seeded for Brightwater) uses a labelled *Simulated facial verification*. The verifier picks the outcomes, no image is sent, and results say "Simulated … No faces were compared."
- **Other organizations:** without a provider or the demonstration setting, the behaviour is unchanged: no match is possible.

**Journey B — external** (`src/pages/verifier/ExternalAttempt.tsx`):
- **Identify Person:** "Enter the reference provided for this verification." The field uses the integration's reference label (default *External Reference ID*). Find Identity calls the activity's integration through the Prompt 2 integration service, with a unique requestId and purpose; credentials never reach the browser.
- **Lookup results:**
  - FOUND shows only the permitted attributes, then Continue Verification.
  - NOT_FOUND lets the verifier correct the reference or end the attempt.
  - MULTIPLE_MATCHES is never auto-selected: the transaction goes to Pending Review.
  - UNAVAILABLE and ERROR offer Retry or End Verification, and never fall back to another source.
- **Capture Face:** camera capture, Retake and Cancel (with confirmation). A clearly labelled *Use simulated capture* is available when the service is simulated.
- **Liveness:** required liveness must pass before matching runs.
- **Matching:** against the reference the external service holds. The simulated service receives only a fixture reference, never an image. A real service would need a secure capture transfer, which this prototype doesn't have.
- **Eligibility:**
  - Reference list: the entered reference or the confirmed referenceId is on the list.
  - External source: a configured permitted attribute and its eligible values, default `recordStatus` = `ACTIVE`, editable in the activity editor.
  - No predefined population: Not Required, never Eligible.

**Decision evaluator** (`evaluateDecision`): identity match, liveness, eligibility and the effective policy give **Allow / Deny / Pending Review / Unable to Decide**, with an explanation.
- A failed mandatory check, an unavailable service or an inconclusive result never gives Allow, and a match alone never allows.
- No match or ineligible gives Deny only when the policy marks failures unsuccessful; otherwise Pending Review.
- Unknown eligibility gives Pending Review; missing evidence or an unavailable service gives Unable to Decide.
- Local transactions get the same fields, alongside the existing outcome, access and entry results.

**Result screen** (both journeys):
- **Verification Outcome** with the explanation and a *Simulated Result* indicator.
- **Separate results:** Identity Verification, Liveness and Eligibility.
- **Context:** Activity (and programme), Verification Source, Transaction Reference, Date and Time, and Status.
- **Colour:** green only for Allow; Pending Review is violet; Unable to Decide is amber.
- **Actions:**
  - Complete and Verify Next Participant.
  - Retry Verification when undecided or inconclusive: a new transaction linked with `retryOf`; the earlier result is kept.
  - Submit for Review where the policy allows it.
  - View Verification Details.

**Duplicate protection:**
- One request at a time per transaction.
- requestIds for each lookup and match.
- Idempotent completion by submissionId.
- Finished transactions refuse further steps.
- Refreshing the result screen only reads the record.

**Reuse** (reverification "reuse within N days"): an earlier result can be reused only if it was a completed Allow with a real match, for the same organization, activity, integration and referenceId. It must also have satisfied the liveness check required now, fall within the validity period, and not itself be a reuse. Eligibility is re-checked now. The transaction records `reusedFrom`, and the screen says no new biometric match was performed.

**History and details:**
- **Columns:** Verification History adds Reference, Organization, Identity source, Identity match, Eligibility, Decision, Status and a View link, with Decision and Identity source filters. Earlier records still show their own results.
- **Transaction details:** the transaction, permitted reference, steps, decision explanation, failure reason, provider transaction, simulation status and links, plus protected diagnostics for audit roles.
- **Programme owners:** the programme detail page shows counts per participating organization only.

**Access:**
- **Verifiers:** perform only assigned activities in their own organization, and see only their own transactions.
- **Direct URLs:** another organization's activity or transaction reveals nothing.
- **Administrators and Auditors:** view history read-only according to the existing permissions.

**Demonstration scenarios** (simulated; reset demo data first; sign in with the demonstration accounts):

| # | Scenario | Who / where | Steps |
|---|---|---|---|
| 1 | Successful local verification | Tobyson (`demo@fixid.app`), switch to Brightwater → *Badge Collection* | Ticket number `PN-100001` → Use simulated capture → Liveness Passed, Match |
| 2 | Local match, not eligible | same | `PN-100002`, Passed + Match → Deny (activity marks failures unsuccessful) |
| — | Enrollment required | same | `PN-100003`: Not Enrolled; can't be matched |
| 3, 9 | Successful external verification without local enrollment | Brightwater → *Visitor Check-in* | `DEMO-10001` → Continue → simulated capture → Passed + Match → Allow; no user record created |
| 4 | Not found | same | `DEMO-20001` → message → End Verification |
| 5 | Biometric mismatch → review | Tomi Okon (`tomi.okon@harbourside.example`) → *Harbourside Staff Entry* | `DEMO-10001` → Passed + No match → Pending Review (programme policy) |
| 6 | Service unavailable | Visitor Check-in | `DEMO-50001` (lookup) or matching *Service unavailable* → Unable to Decide |
| 7 | Match, ineligible | Visitor Check-in / Harbourside | `DEMO-10002` (record SUSPENDED) → Deny / Pending Review |
| 8 | Mandatory liveness failure | Harbourside Staff Entry | Liveness Failed → no matching, Pending Review |
| 10 | Programme enforcement | Harbourside Staff Entry | Service and liveness are locked; requirements come from *Group Staff Verification* |
| 11 | Repeat verification | Visitor Check-in | After scenario 3, verify `DEMO-10001` again → *Use previous verification* |
| 12 | Cross-organization access | Tomi Okon | Open `/verify/activities/org_lts_va_visitor_checkin` → refused |

**Limitations:**
- **Simulated services:** the matching, liveness and lookup services are simulated (deterministic fixtures). No real face is compared, no presentation-attack detection happens, and no assurance is claimed.
- **External services:** real external services stay disabled (no secure backend).
- **Not built:**
  - QR or barcode reference scanning (the integration contract doesn't declare it yet).
  - Reuse for local verification.
  - The exception management dashboard, programme oversight dashboard, external status API and scenario switcher (later prompts).
- **Security:** access checks run in the browser prototype and aren't a security boundary.
- **Saved browser data:** load the new scenarios with Settings → Demo data → Reset.

## Verification Activities: one concept, for your organization or shared

Verification Programmes were merged into Verification Activities. There is one concept, **Verification Activities** (`/verification-activities`). When an activity is created, the first decision is who it's for:

- **For my organization:** your staff verify people for your own purposes.
- **For other organizations (shared activity):** one activity record, owned and configured by your organization. The organizations you choose get an invitation in their **own existing FixID workspace**. Nobody registers again, and nobody copies the activity. They accept, assign their **own** staff, and run the same activity.

**Creating an activity** starts with one question, *What do you want to do?* (`ActivityEditorPage`):

- **For other organizations:** activity details (name, optional description), identity source and participating organizations, then a short review and **Create Activity**. The checks come from the identity source: face match and liveness when the source can match faces; problems go to review. Nothing else is asked, and participating organizations assign their own verifiers.
- **For my organization:** two steps and a review.
  - *Step 1 of 2* asks for the name and an optional description.
  - *Step 2 of 2* is one screen with three sections:
    - **Identity source:** FixID records or a connected service, preselected when there's only one. The checks (face match, liveness, and whether a failed check is *Not verified* or *Pending review*) and an optional *Limit who can be verified* also sit here.
    - **Who can verify?**
    - **Location check:** off by default; its fields appear only when it's on.
  - *Review* summarises everything before **Create Activity**. **Back** keeps what was entered, and the review also offers *Save as draft*.
  - Editing an activity later, including adding or removing verifiers, uses the single-page form.

Only sources available to the organization are offered, and a single suitable one is preselected. `?type=shared|own` skips the first question.

When editing, *More options* holds the optional extras: limiting who can be verified (FixID records only) and the location check. Eligibility isn't configured any more. A connected source's record status decides it behind the scenes; with FixID records anyone registered can be checked unless the activity limits it. A valid-looking identifier only lets the person be checked; it never marks them as verified.

**Shared activities and permissions** (`src/store/sharingOps.ts`):
- **Participation:** Invited → Participating (accepted) or Declined; the owner can Suspend, Resume or Remove. Only an invited organization can accept, in its own workspace (`verification.activities.edit`). Every change is audited in both organizations.
- **Participants' rights:** they assign their own active staff (`sharing/assignVerifiers`); another organization's staff can't be assigned. They see the requirements read-only (*Set by …*) and can't edit the activity; the store refuses any change (`applySaveActivity` only finds the owner's activities).
- **Where transactions live:** in the performing organization's workspace, linked to the owner (`activityOwnerId`). They use the owner's identity source and requirements.
- **What the owner sees:** this activity's results by organization (*Participating Organizations* tab, dashboard, *Shared activity report*, Verification History with a *Performed by* filter). It reviews the activity's exceptions (route `owner`). The simulated status API answers the owner's client for these transactions only. It never sees participants' other activities, people, records or exceptions.
- **Independence:** participating doesn't change an organization's workspace. It keeps managing its own administrators, users and settings, and creates its own activities.

**Navigation:** one *Verification Activities* item, with two tabs:
- **My Activities:** activities your organization created.
- **Invited Activities:** activities shared with you, with Invited, Accepted or Declined status, Accept and Decline, and *Assign verifiers*.

Old `/programmes` links redirect there.

**Outcomes:** *Verified*, *Not verified* (including an identifier with no record), *Pending review*, and *Unable to verify* (the source is unavailable, a technical issue rather than a mismatch). Review decisions are *Approve*, *Reject*, *Return for a new check* and *Unable to resolve*. The original result is kept beside the decision.

**Owner's activity page** (all figures come from stored transactions):
- **Overview:** cards for participating organizations, total attempts, verified, not verified, pending review and unable to verify, plus results by organization. Each card and each row opens the matching transactions.
- **Organizations, Verifications and Exceptions** tabs.

**Participating organization's page:** accept the invitation, assign verifiers, and see its own results and transactions.

**Data:** stored browser data from before this change (state version 9) is reseeded once (version 10). Demo scenario B is now the shared activity *Group Staff Entry*:
- It is owned by Meridian Group and uses *Group Identity Service*.
- Meridian Harbourside takes part (Tomi Okon assigned), and so does Meridian Eastgate (Mira Santos assigned).
- Brightwater Collective has a pending invitation (Jordan Blake can accept it).

**Try it:**
1. Sign in as Jordan Blake. In Verification Activities, *Accept* Group Staff Entry, then *Manage staff* and choose Halima Bello.
2. Sign in as Halima Bello and verify `DEMO-10001` (Match / No match) or `DEMO-20001` (not found) or `DEMO-50001` (unavailable).
3. Sign in as Victor Hale and open Group Staff Entry → *Participating Organizations*, then Exceptions.

**Limitations:**
- Any active organization on FixID can be invited (names only); there's no invitation by email or approval flow beyond Accept/Decline.
- The owner can't delegate review to a participant.
- Access rules are enforced in the browser prototype only, not as production-grade security.
- Earlier sections below mention programmes; read "programme" there as "shared activity" and "programme owner" as "activity owner".

### Shared-activity rules

- **Invitations:** an authorized owner can invite any active organization registered on FixID. No parent-child relationship is needed. Invitations stay in FixID; there are no email invitations.
- **Exception decisions:** only the activity owner records decisions on a shared activity's exceptions. The organization that ran the verification can see the exception and its decision. It can also answer the owner's *Request Information* (the "Provide information" card, shown while the exception is Awaiting Information). It can't assign, request information or decide.
- **Incomplete attempts:** an attempt is recorded when the verifier starts it.
  - If it isn't finished within 15 minutes, it becomes **Incomplete**.
  - An Incomplete attempt counts in Total attempts but never as Verified, Not verified, Pending review or Unable to verify. In the status API it appears as `INCOMPLETE`.
  - Starting again while the verifier's last attempt is still untouched resumes that attempt instead of creating a second one.
  - Repeated submissions with the same submission ID are idempotent.
  - In this prototype, the timeout is applied in the browser: on load, every minute, and when a verifier starts or opens an attempt. Production needs a server-side job.

### Bulk organization upload

**Organizations → Bulk upload** adds many organizations from a CSV file.
- **Template:** two columns, `Organization name` and `Administrator email`, with one sample row. These are the only two fields "Add organization" requires. The member label (Member) and time zone (yours) use defaults and can be changed later.
- **Same rules as "Add organization":** each organization gets its own workspace, a relationship to yours, and a single-use invitation for its administrator. You get no access to its data.
- **Preview first:** nothing is created until you confirm. The preview shows which rows are ready, already in FixID (matched by name, ignoring case and spacing, and skipped) or need attention, with a reason for each.
- **Checks:** missing values, invalid emails, duplicate names or administrator emails within the file, and administrator emails already in use. Wrong file type, empty files, files without data rows, unknown columns and unreadable files are rejected with a message.
- **Import:** rows are checked again when imported, so a duplicate created since the preview is skipped, not created twice. The summary lists created, skipped and failed rows by row number, and you can download it as CSV. One audit event records the counts.
- **Invitations stay separate:** uploading never invites anyone to an activity. Invite through the shared activity's **Participating organizations** list; when there are more than 8 organizations it has a search and **Select all shown**.
- **Who can upload:** administrators with *Manage organizations*, in an organization that isn't itself a sub-organization.
- **Prototype limits:** files are read in the browser and data stays in the browser's local storage, like the rest of the prototype. Duplicate detection by name isn't a substitute for server-side uniqueness checks.

## Production gaps (prototype vs. production)

What works here is the product flow, end to end, in one browser. These are not production capabilities:

- **Storage:** all data lives in the browser's local storage, per device. There's no server, database, backup or retention enforcement.
- **Access control:** checks run in the application code in the browser. They keep normal use and direct URLs inside each organization's scope, but anyone with access to the browser can change the stored data. Production needs server-side authorization on every request.
- **Identity sources:** sources are simulated, with fixed demo references. Real services, credentials and secure server-side calls aren't implemented.
- **Face and liveness:** results are chosen in a simulation and marked *Simulated*. No faces are compared.
- **Accounts:** demonstration accounts share a published password, and invitations go only to organizations already on FixID (no email delivery).
- **Audit log:** append-only by convention in the app, not tamper-evident.

## Organizations, workspaces and demo accounts (Phase 1)

**Organization model.** Every organization registers the same way (no organization-type choice). An organization becomes a parent only by creating sub-organizations. Relationships are separate records (`data.organizationRelationships`: parent, child, type `sub-organization`, origin, status, initial administrator), so later phases can add other origins, such as inviting an existing organization (`pending` until accepted), without changing organizations. Phase 1 rules, enforced in the store (`src/store/orgOps.ts`): one level only (a sub-organization can't create sub-organizations), one parent per organization, and an existing organization is never reassigned.

**Organizations** (navigation → Organizations, `/organizations`; `organizations.view` to see, `organizations.manage` to create and resend; Organization Admin has both, Auditor has view only):
- **Create Organization:** Organization Name (required), Short Name, Industry, Organization Email, Organization Phone Number (optional), Initial Administrator Email (required), Default Person Label and Time Zone (default from the parent). The Organization ID is generated; the country is inherited. Creating it adds a separate workspace (status *Awaiting administrator*), the parent relationship, and a 72-hour single-use invitation for its Organization Admin through the existing invitation flow (simulated delivery shows the link). It becomes *Active* when they accept. The creator gets no membership or access in it.
- **List:** Organization Name, Organization ID, Administrator (with invitation state), Status, Date Created and Actions (View details, Resend invitation), with search and an empty state.
- **Details** (`/organizations/:id`): organization information, relationship, initial administrator and invitation status, and the count of active administrators. Nothing else: the sub-organization's people, biometric data, credentials, activities, administrators' details and settings stay private, and any other ID shows "Organization not available".
- **In a sub-organization**, the page shows its parent relationship and what the parent can see.

**Isolation.** Each organization's data stays in its own workspace. Every change is refused in the reducer unless it targets the organization being worked in, with the actor's permissions there (`ACTION_PERMISSIONS`, `targetOrganization`). Pages only read records of the current organization, so changing an ID in a URL shows "not found" or "no access". A parent's administrators aren't members of its sub-organizations, and siblings can't see each other. This is a client-side demonstration model; production needs the same scoping on the server for every request.

**Workspace context.** The header shows the current organization, your role, and "Sub-organization of …" where relevant. A switcher appears only for accounts with explicit memberships in several organizations (administrator records); relationships never add workspaces. Switching returns to the dashboard of the new workspace. Memberships come from administrator records (`AuthProvider`). The repair of the demo account's role (`ensurePrimaryAdmins`) never creates memberships.

**Platform Administrator** (`/platform`): a separate platform context, not an organization role (it can't be assigned or created in Roles & Permissions). It shows registered organizations, statuses, relationships and counts, and **no** people, identity records, biometric data, credentials or secrets. Platform controls that need a backend (suspension, support access) aren't part of the prototype and aren't shown.

**Demonstration data** (fictional; `src/data/demoPersonas.ts`): **Organization A** = Northbridge Group (independent). **Organization B** = Meridian Group, with sub-organizations **B1** = Meridian Harbourside and **B2** = Meridian Eastgate, each with its own administrators, people and activities. B2 has one custom role, *Records Officer*, created by its administrator for the custom-role demonstration account: an intentional, documented exception to "no prepopulated custom roles". New organizations still start with none. Sample data no longer uses real place or regulator names.

**Demo accounts** (demo builds only; Sign in → *Demonstration accounts (prototype only)* → Use; they sign in through the normal password check, all with `FixIDDemo2026!`; the list and credentials don't exist when `VITE_DEMO_AUTH=off`):

| Account | Workspace and role |
| --- | --- |
| platform.admin@fixid.example | Platform Administrator (`/platform`) |
| esther.lawal@northbridge.example | Organization A — Organization Admin (independent) |
| victor.hale@meridian.example | Organization B — Organization Admin (with sub-organizations) |
| lina.ford@harbourside.example | B1 — Organization Admin (sub-organization) |
| tomi.okon@harbourside.example | B1 — Verifier (assigned to two activities) |
| adaora.nwosu@northbridge.example | Organization A — Auditor |
| joel.park@eastgate.example | B2 — custom role *Records Officer* |
| mira.santos@eastgate.example | B2 — Organization Admin |
| demo@fixid.app | Multi-workspace Organization Admin (Crestfield, A, B, Brightwater; no sub-organizations) |

## Administrators & Roles

Settings → **Administrators & Roles** (`/settings?tab=admins`, `&view=roles` for the role catalogue). Administrators are organization-scoped records (`data.administrators`), separate from the users an organization manages; one person can be both, but administrative access is always granted explicitly.

**Current account.** The demo account (in every sample organization) and the owner of an organization created through sign-up are active **Organization Admins** of that organization only. Saved data where that assignment has drifted is repaired on load and sign-in; no other administrator is changed. Nobody can remove their own Organization Admin role or deactivate themselves.

**Roles.** Three protected **system roles** exist in every organization and can't be edited or deleted. Organizations add their own **custom roles** (Roles & Permissions → **Create Custom Role**), which exist only in the organization that created them (`data.customRoles`). Each administrator holds **exactly one role** (system or custom), resolved within their organization (`adminPermissions`, `orgRoles`). Roles and permissions follow the R1 *Roles and Permissions Matrix v1.1* (Epic 02).

| System role | Permissions |
| --- | --- |
| Organization Admin | Every permission below, including `verification.execute` (assigned activities only), in their own organization only |
| Verifier | `verification.execute` — performs verifications only for activities they're assigned to; a focused workspace (My Dashboard, My Verification Activities, My Verification History) |
| Auditor | `users.view`, `groups.view`, `credentials.view`, `verification.activities.view`, `verification.results.view`, `administrators.view`, `organization.view`, `audit.view` — read-only: sees administrators, roles and the organization profile, can't change, verify or issue anything, and gets no raw biometric data |

**No default custom roles.** Every organization, new or sample, starts with only the three system roles. Custom roles appear (under Roles & Permissions → **Custom roles**, and in the Invite and Change Role pickers) only after an administrator creates one; until then the section shows *No custom roles yet* with **Create Custom Role**. Viewer became **Auditor** (saved assignments move to it on load). The former example roles Credential Manager and Verification Manager are gone from default data: in saved data, untouched copies are removed and the sample administrators who held them move to Auditor (Adaora Nwosu) and Verifier (Kwame Mensah). A copy an administrator edited or assigned to anyone else is kept as that organization's own role. No permission type was removed.

**Permissions** (`src/domain/roles.ts`; checks always use permissions, never role names):

| Area | Permissions |
| --- | --- |
| Users | `users.view`, `users.create` (add individually), `users.import` (CSV import), `users.edit` (activate/deactivate, enrolment invitations) |
| Groups | `groups.view`, `groups.manage` (create, edit, remove), `groups.members` (add/remove members) |
| Credentials | `credentials.view`, `credentials.manage` (configurations), `credentials.issue` (sensitive) |
| Verification Activities | `verification.activities.view`, `.create`, `.edit` (details and participants), `.activate` (activate/deactivate), `verification.verifiers.assign` (assign verifiers in the editor), `verification.execute` (assigned activities only) |
| Verification History | `verification.results.view` (organization-wide history; verifiers see their own under My Verification History) |
| Administration | `administrators.view` (administrators, roles and permissions), `administrators.invite` (sensitive), `administrators.manage` (deactivate/reactivate, sensitive), `roles.assign` (change roles, sensitive), `roles.manage` (custom roles, sensitive), `organization.view` (organization profile), `settings.manage` (update the profile, sensitive), `audit.view` |

There are no permissions for features that don't exist (credential revocation, reports).

**Rules:** every catalogue permission is selectable for custom roles (per the matrix), but nobody can grant a permission they don't hold; role names are unique within the organization. You can only assign roles whose permissions you hold, and you can't act on an administrator who has permissions you lack. A custom role can't be deleted while anyone holds it (the dialog names them; change their role first). Editing a role applies immediately to everyone who holds it, including removed permissions. The organization always keeps at least one active Organization Admin: the last one can't be given another role or deactivated, and nobody can remove their own Organization Admin role or deactivate themselves. Regular users never become administrators by being created or imported. Administrators aren't deleted: deactivation keeps name, email, role and history.

**Administrators tab (Epic 02).** Columns **Full Name**, **Email**, **Role**, **Status** (**Invited**, **Active**, **Inactive**; an invited account also shows *Pending* or *Expired*, not a fourth status) and **Actions**: **View Details** (account, role, status, invitation, permissions and recent history), **Change Role** (shows the current role, pick one replacement, Save / Cancel), **Resend** / **Revoke Invitation**, and **Deactivate** (with confirmation) / **Reactivate**. The first Organization Admin is listed like everyone else. Permissions follow the stored role live, so a role change or deactivation takes effect in open sessions straight away.

**Invitations (Epic 02).** **Invite Administrator** asks for Full Name, Email and one Role (system or custom). The invitation belongs to the current organization, is listed as Invited, and has a single-use link (`/invite/:token`, a random 48-character token) that expires **72 hours** after it's sent. Opening the link shows the organization and role; the person enters their name and a password, the account is created and activated, and they enter the workspace with that role. An expired, revoked, already-used or replaced link is refused. **Resend** (for pending or expired invitations) issues a new 72-hour link and invalidates the old one. Duplicates are refused: an email that's already an administrator, inactive, or invited (pending or expired: resend instead), or that has an account or pending invitation in another organization, since each administrator account belongs to one organization. An existing FixID account for the email is asked to sign in rather than creating a second one.

**Permission-based workspace.** One application for every role: navigation items, pages, tabs and actions are shown from the effective permissions, and every route checks them too (direct links show *You don't have access to this page*). The dashboard is chosen from permissions as well: an organization overview (its sections per permission), the verifier dashboard for verifying-only roles, or a list of the role's areas otherwise — no custom role needs its own dashboard. Settings tabs follow `organization.view` / `settings.manage` (Organization; Edit needs `settings.manage`) and `administrators.view` (Administrators & Roles).

**Enforcement (prototype).** Every change is re-checked in the store against the real permissions from state: the reducer's permission table (`ACTION_PERMISSIONS`), the operation functions (`applySaveRole`, `applySetRoles`, `prepareCreateUser` …), and a central check that refuses any action naming an organization other than the one being worked in. This is client-side code standing in for a server: production needs the same checks in the API with server-side sessions.

**Verification governance (prepared, not built).** Rules have three layers — platform, governing authority, organization. `verification.activities.edit` only ever covers the organization layer (`editableRuleLayers`); no organization role can change platform rules. A Verifier's role authorizes performing verifications; which activities is decided by assignment (`authorizeVerifier`). The assignment workflow isn't built yet, so until assignments exist verifiers see a pending state.

**Audit.** Invitations (created, resent, revoked, simulated expiry), joining, role changed, deactivation / reactivation, and custom role created / updated (permissions added and removed) / deleted are written to the Audit Log with the actor, organization, affected administrator or role, previous and new values and outcome. Filter by **Administrators** or **Roles**.

**Role views (account menu → Switch role view).** An Organization Admin switches to another role's view from the account menu, a role card's **Preview**, or the banner's role picker; **Switch back** returns to full access. Navigation, pages, dashboards and direct URLs follow the view's *effective permissions* (custom roles included). A role whose permissions the administrator already holds entirely, such as **Verifier**, is a working view: actions are allowed within the intersection of that role's and the administrator's own permissions, so switching never adds a permission, and workspace-wide actions (demo reset, organization creation) are refused. In demo builds a role the administrator doesn't hold entirely can also be previewed, read-only. Stored roles and the sign-in never change. Navigation: the full admin view shows Dashboard, Users, Groups, Credentials, Verification Activities, Verification History, Audit Log, Settings; the Verifier view shows Dashboard (assigned activities, progress, recent verifications), My Verification Activities and My Verification History (`hiddenWith` hides the *My…* items whenever the organization-wide item is available). In the Verifier view the verification service also refuses other people's attempts.

**Invitation delivery and expiry are simulated.** No email provider is connected and no email is sent. After inviting or resending, a dialog headed *Simulated delivery: no email was sent* shows the invitation link to copy and share; a pending invitation's details show it again. A **Simulate expiry (prototype)** action in the details makes a pending invitation expire now, to show the expired state without waiting 72 hours; production expiry is a server-side time check. The invited person can also join by signing up with the invited email address (code `123456`) before it expires. Tokens, expiry and single use are enforced in the browser only; production must issue, store and check them on the server.

**Enforcement is client-side only.** Permissions are checked in three places — hidden actions, route guards and the store reducer — but all run in the browser and can be bypassed. Production must enforce the same rules on the server for every request.

## Groups

User Management → **Groups** (`/groups`, details at `/groups/:id`). Groups are reusable, organization-scoped collections of users — departments, teams, locations, cohorts. They organize managed users only: membership never grants administrative access, issues credentials or proves identity.

- **Overview:** search by name or description, member counts, dates, and View / Edit / Manage Members / Remove Group. Groups can exist with no members.
- **Create and edit:** name required and unique in the organization (case-insensitive, 2–80 characters); description optional (up to 300). Editing keeps the group ID and its members.
- **Details:** a header that stays visible (name, description, members, created, last updated, Edit / Remove Group) and three tabs:
  - **Members** (default, `groups.view`): user name, the organization's configured identifier, email, status, date added; search, status filter, add, remove and bulk remove, links to user profiles.
  - **Credentials** (`credentials.view`; issuing needs `credentials.issue`): issuance runs started from this group — credential, recipients, issued, failed / skipped, date, status, and per-recipient details with links to the credentials created. Credentials members got some other way aren't listed here.
  - **Activity** (`audit.view`): this group's entries from the Audit Log — details changes, membership changes and issuance runs — with search, type and date filters.
  A tab a role can't use is hidden, and a direct link to it falls back to Members.
- **Issue Credentials:** choose an existing active credential configuration (none are created here) → all current members or selected ones → eligibility check (user status, the identifier the credential uses, whether they already hold it; portrait enrollment isn't assumed) shown as Eligible / Needs attention / Not eligible with reasons → review with counts, any required dates and an explicit confirmation → results (issued, failed, skipped with reasons). Every recipient goes through the same issuance operation as the rest of Credentials; each credential belongs to its holder and records the run (`issuanceBatchId`). Runs are stored as `IssuanceBatch` records referencing the group by ID and are reported as completed, partially completed or nothing issued. Membership never issues or revokes credentials. Wallet delivery remains simulated.
- **Add members:** pick existing users of the organization, one or many. People already in the group aren't offered; duplicates and users from other organizations are refused in the store too. No user records are created.
- **Remove members / Remove Group:** confirmed; only the membership relationships go. Users and their credentials are untouched. A group used by a verification activity (`eligibility.groupIds`) can't be removed until it's no longer used.
- **User profiles:** a **Groups** section lists the user's groups, and administrators who can manage groups can add or remove memberships there. Both screens read the same membership records, so they always agree.
- **Permissions:** viewing needs `groups.view` (Organization Admin, Auditor, and custom roles that include it); every change needs `groups.manage` (Organization Admin). Role Preview reflects this and stays read-only.
- **Audit:** group created, updated (with previous and new values), removed, and members added or removed — with the affected group and users — e.g. "Tobyson TE added 3 users to the Project Alpha group."

**Data model:** `Group` {id, organizationId, name, description, createdAt/By, updatedAt/By} and `GroupMembership` {organizationId, groupId, memberId, addedAt, addedBy} in the prototype store. `src/domain/groups.ts` is the single read path; `isGroupMember(data, organizationId, groupId, memberId)` is the check a future verification eligibility rule can use (by stable ID, within the organization, against current membership). Sample organizations include a few groups; saved data from before Groups is upgraded on load.

## Verification Activities

Verification → **Verification Activities** (`/verification-activities`). An activity is something people are verified for — an event, a site entry, a membership check. Administrators describe it in plain language; FixID turns that into the underlying checks and rules.

- **List:** Activity Name, Requirements (Identity · Credential · Eligibility), Eligible Participants (unique count), Status, Last Updated, Actions; search and status filter; View, Edit, Activate, Deactivate, Duplicate, Remove Draft.
- **Drafts are kept automatically.** A new activity (or a draft) is saved as one draft record when moving between steps, before **Invite Administrator**, and when leaving the page; the editor then works on that draft at its own address and reopens on the last step (`editorStep`). Drafts appear on the list with **Continue Editing** and never become active until activated. A save never overwrites a draft that changed after the editor loaded it (the editor says so), and a failed save says so with **Try again**. Drafts live in the prototype's workspace storage (browser local storage); production needs server-side persistence.
- **Verifiers:** the administrator creating a new activity is preselected as its verifier (when they can verify); others with `verification.execute` can be added, and anyone can be removed (the review then shows *No verifier assigned — Assign at least one verifier to allow verification for this activity.*). **Invite Administrator** saves the draft and opens Settings → Administrators & Roles with the invitation open and a **Back to activity** link.
- **Biometric verification** is a platform capability: administrators see no provider warnings or configuration. If it's unavailable when someone is verified, the result is *Unable to verify* (never a simulated match).
- **Create / edit in three stages** (`/verification-activities/new`, `/:id/edit`, `?step=details|people|review`). There is no Verification Requirements step:
  1. **Activity Details**: Activity Name (required), Description (optional) and **Enable Location Check** (off by default; see *Location check* below).
  2. **Participants & Verifiers**: **Eligible Participants** are existing groups (with member counts) and specific users (search, multi-select), with a live count of unique eligible people; nobody is counted twice. **Assigned Verifiers** is a searchable list of administrators who hold `verification.execute`; nobody else can be chosen. It needs `verification.verifiers.assign` (read-only otherwise).
  3. **Review & Activate**: name, description, groups and users, assigned verifiers, location check status and area, *How people are verified* in plain language, and anything blocking activation. **Save as Draft** works from every step; **Create & Activate** activates when nothing blocks it. If no verifiers are assigned, a warning is shown.
- **Location check** (optional, per activity, `locationCheck: {enabled, lat, lng, radiusM, label?}`): *When enabled, the verifier's device location is checked during verification and the result is included in the verification report. Location does not automatically block verification or entry.*
  - **Off:** no location fields are shown, the verifier's device is never asked for its location, and attempts record *Not required*.
  - **On:** search for an address, click the map to drop the pin, drag it to adjust, and choose a circular radius (presets 50 m – 1 km, or 25 – 5,000 m typed in). Coordinates can also be entered directly. The centre and radius are stored; activation is blocked until a valid location is chosen.
  - Circles only: no polygons, and no continuous tracking. The location is read once, when the verifier runs the verification.
  - **Map provider:** the map and address search sit behind `MapsService` (`src/services/location.ts`). The prototype uses Leaflet with OpenStreetMap tiles and Nominatim search, which are subject to the OSM tile and Nominatim usage policies and aren't suitable for production traffic. Production needs a contracted map and geocoding provider. With `VITE_MAP_PROVIDER=none` (also used by the tests), the editor says plainly that map search isn't connected and asks for coordinates. No placeholder map and no invented coordinates are shown. If search can't be reached, the editor says so and coordinates or the map still work.
- **How people are verified is FixID's job, not a wizard choice.** A new activity finds the person from their identifier, verifies a live capture of their face **1:1** against their enrolled portrait (with liveness), then checks eligibility (`standardRequirementsFor`, `buildChecks`). A record lookup alone never verifies anyone. Without a facial verification provider (see *Verifier Workspace*), an activity can still be activated — with a warning — so the journey can be tried, but every verification records *Unable to Verify*. Existing activities keep their configuration (e.g. stated-detail matching of name and date of birth), and services other than facial verification that aren't connected still block activation.
- **Existing activities keep their configuration.** Editing uses the same simplified editor; details and participants are saved with `keepConfiguration`, so checks, credential requirements, outcome rules, versions, the multiple-entry rule and verifier restrictions are carried over unchanged (no new version is created). Activities whose identity check is only a record lookup (saved before detail matching became required) show a warning. An activity without a participant list can have one added, which updates only its eligibility requirement (as a new draft version when it's live).
- **Credentials:** activities saved with a credential requirement keep validating presented credentials (authenticity, issuer trust, validity, revocation). New activities don't ask for one; a credential is never treated as proof of who is presenting it.
- **Multiple entries:** a recorded entry is never duplicated through the normal flow: once someone has been granted entry for an activity, later verifications are *Not Permitted* (or *Review Required* under the legacy "flag" rule) and Allow Entry is refused. Exceptional re-entry isn't supported; it's a future workflow decision.
- **Eligibility:** participants (`participants: {groupIds, memberIds}`) live on the activity, not the version, and are evaluated at verification time against *current* group membership — adding someone to a selected group makes them eligible from their next verification. Being eligible never proves identity, and eligibility is only checked for a securely identified person.
- **Who can verify:** administrators with the Verifier role (`verification.execute`) who are assigned to the activity. The role authorizes the operation; the assignment decides the activity, so the role alone opens nothing. Verifiers are assigned in *Participants & Verifiers*; activating an activity without assigned verifiers shows a warning. Enforced in `authorizeVerifier()` (service layer), along with the optional enforced schedule.
- **Details** (`/verification-activities/:id`): header with name, description, status, eligible count, Edit, Activate / Deactivate and more actions; tabs **Overview** (an operational summary: eligible / verified participants and entries granted from actual records; selected groups and users, assigned verifiers, location check and area map, last updated; only actionable warnings such as *No verifier assigned*), **Participants** and **Verification History**. Checks, providers and configuration versions are no longer shown to administrators; they still apply and are recorded with every verification.
- **Validation, policies, outcomes and versions** are unchanged from Phase 3: dependency and provider checks, locked platform policies, Verified / Not Verified / Unable to Verify / Pending Review, and requirement changes to an active activity go into a new draft version while the active one stays in use. Details, location, schedule, entry policy and participants apply straight away.
- **Permissions:** view `verification.activities.view`; create/duplicate `.create`; details, participants, activate, deactivate, remove `.manage`; requirements and outcomes `verification.rules.manage`; restricted verifier lists `verification.verifiers.assign`. Role Preview stays read-only.
- **Audit:** created, details updated (including the location check, schedule, multiple-entry rule and who can verify), requirement/check/rule/provider changes, participants changed, verifier assigned/removed, activated (with version), deactivated, duplicated, draft removed, draft changes discarded — with previous and new values.
- **Groups:** a group used by an activity's participants or group check can't be removed.

Sample organizations include these activities: *Annual Staff Conference* (identity + eligibility, location and schedule, multiple entries not permitted), *Visitor Identity Check* (identity only), *Membership Verification* (credential + eligibility, on its second version), *Event Access Verification* (a draft with facial verification and a credential), an inactive credential activity and — in Northbridge Group — **2026 Restricted Session Clearance** (matric number → live face, 1:1 → eligibility, 24 individually selected students). None has verifier assignments: an administrator assigns them.

## Physical access verification

Officer-led: the verifier (officer) identifies the person in front of them with the activity's methods; the attendee doesn't scan anything. There are no event QR codes or tickets, and a QR code or credential number is never proof on its own. The FixID web verifier is a demonstration client of the same execution service; other approved verifier applications can use it the same way.

Each completed attempt records these separately:

- **Verification outcome** — Verified / Not Verified / Unable to Verify / Pending Review, as before — split into an **identity and credential result** and an **eligibility result** (Eligible, Not eligible, Unable to confirm, Not required).
- **Access decision** — *Permitted* (the activity's conditions are met), *Not Permitted* (a required condition failed, or the person already entered and multiple entries aren't allowed) or *Review Required* (couldn't be confirmed, or a second entry under the "flag" rule).
- **Location check result** (only when the activity enables it): *Within configured area*, *Outside configured area*, *Location unavailable* (permission denied, no fix, timeout, or no geolocation API; the reason is stored), *Location inconclusive* (the reported accuracy overlaps the radius edge) or *Not required*. Within means distance + accuracy ≤ radius; outside means distance − accuracy > radius; anything in between is inconclusive, so a coarse reading never claims certainty. The store computes it from the reported coordinates (`evaluateLocation`) and keeps the device coordinates, accuracy, distance and the configured area used. It never changes the identity, eligibility or access result, and it never decides entry.
- **Entry decision**: never automatic. After a completed verification the officer chooses **Allow Entry** (only when access is Permitted) or **Deny Entry** (always available, with an optional reason). Only one decision is recorded per attempt, and it needs `verification.execute`. It's written to the attempt and to the Audit Log (`verification.entry-recorded` / `verification.entry-denied`), together with the outcome and location result.
- **Duplicate entries** are detected from *recorded entries* for the same person and activity — a successful verification alone is not an entry.

The decision is computed by the store when the attempt completes (`applyCompleteAttempt`), not by the screen.

**Verification History** (`/verification-history`) shows engine attempts and the earlier sample event records together through a read adapter (nothing is copied): date and time, activity, subject, verifier, identity result, eligibility result, outcome, access decision, location result and entry decision, with time, activity, outcome and entry filters. An attempt's detail page shows the outcome, the access decision, the location check details and the entry decision (with **Allow Entry** / **Deny Entry** for verifiers), the checks with providers and evidence references, and the configuration version. Earlier records keep their own detail view.

## Verifier Workspace

The officer's end-to-end journey, mobile-first, inside the same app and sign-in (no separate login).

- **Who:** administrators with `verification.execute` **and** an active assignment to the activity. The Organization Admin role includes `verification.execute`, but an assignment is still required; they verify through the **Verifier view** (no separate workspace shortcuts).
- **My Verification Activities** (`/verify`): active, assigned activities only, each with description, status, location, progress (*x of y verified · z entered*), **View Details** and **Start Verification**. Unassigned: *No verification activities assigned to you.*
- **Activity Details** (`/verify/activities/:id`): description, status, configured location, eligible / verified / pending participants, entry granted / denied counts, *How people are verified*, your recent verifications, and **Start Verification** (active activities only). Direct links to unassigned, inactive or other organizations' activities are refused by the service.
- **Start Verification** (`/verify/attempts/:id`), three steps:
  1. **Find Participant** — the identifier field is labelled with the activity's configured identifier (e.g. *Matric number*; otherwise the identifier its participants share). **Find Participant** (`lookupParticipant`) searches this organization only, confirms the identity record with the identity service, and shows name, identifier, role/unit, **eligibility**, whether an **enrolled portrait** exists, and earlier results (already verified, already granted entry, previously denied). Handled: not found, wrong kind of identifier, not eligible (*Record as not eligible*), no enrolled portrait (*Record as unable to verify*), lookup service unavailable. Finding someone records nothing and proves nothing.
  2. **Verify Identity** — **Capture Selfie** opens the device camera (`getUserMedia`; front camera by default, *Switch camera* when there are several, works with laptop webcams), with preview, **Capture**, **Retake**, and clear permission-denied / no-camera / unsupported-or-insecure states. Only a live camera frame can be captured (no upload). The JPEG capture (≤960 px) is held in memory, sent once with the submission, and discarded; it's never stored.
  3. **Result** — participant, then **Identity verification** (Verified / Failed / Unable to verify, with the reason), **Activity eligibility** (Eligible / Not eligible / Unable to determine) and **Location check** (or *Not required*), never merged into one success indicator. Below: access decision, location details (an outside-area warning that doesn't deny entry), and the officer's **Allow Entry** / **Deny Entry** decision. **Verify Next Participant** starts a fresh attempt with nothing carried over.
- **Facial verification boundary** (`src/services/faceVerification.ts`, `Services.faceVerification`): 1:1 only — FixID sends the person's identity reference (never their portrait) and the live capture; the provider holds the enrolled template, compares, checks liveness, and returns `match` / `no-match` / `inconclusive` plus a liveness result and a comparison reference (stored as evidence). **No provider is integrated in this prototype**: by default the service is unavailable, the screens say *Biometric Verification Unavailable: integration required*, and identity is recorded as *Unable to Verify* — never a fabricated score or match, and no manual visual comparison instead. Setting `VITE_FACE_VERIFICATION_URL` points it at a backend endpoint implementing the documented JSON contract (`createHttpFaceVerification`; `VITE_FACE_VERIFICATION_LIVENESS=off` if the provider has no liveness, in which case liveness — a required check — stays inconclusive). Malformed responses, HTTP errors and network failures are errors, never matches. A test double lives in `src/test/helpers` only. The earlier simulated facial matching and liveness scenarios were removed.
- **Participant status** (admin Activity Details → Participants): every eligible participant with **Verification** (Verified / Failed / Unable to verify / Not verified) and **Entry** (Granted / Denied / Not granted / Pending / Not recorded), searchable and filterable, from persisted attempts only (`participantStatuses`).
- **Authorization** is enforced in the verification service on every call (start, lookup, submit, entry decisions), re-checked after slow service calls, so revoking an assignment or deactivating the activity mid-verification stops it. In this prototype the service runs in the browser; production must enforce the same rules on the server.

## Verification execution and the Verifier Interface

**My Verification Activities** at `/verify` (and **My Verification History** at `/verify/history`), shown in the navigation to roles with `verification.execute`. They're part of the same workspace as everything else; a Verifier-only role sees just these and **My Dashboard**.

- **Who can verify:** an active administrator of the organization with `verification.execute` (the Verifier role, or the Organization Admin role) **and** an active assignment to the activity. The list shows only active activities they're assigned to; without assignments it says *No verification activities assigned to you.* Direct links to other activities are refused and the refusal is written to the Audit Log (`verification.denied`).
- **Flow:** Start Verification → the steps adapt to the activity's checks (identifier, credential presentation, stated details, demonstration capture scenarios) → Run verification (if the activity has a location check, the browser's geolocation is read once at this point and the browser may ask for permission) → live check progress → result with outcome, access decision, location check and entry decision (**Allow Entry** / **Deny Entry**), identity and eligibility results, summary (activity, type, time, reference, privacy-safe subject label, verifier, organization), each check's status and explanation, and Finish / Start New Verification / View Verification Details / Refer for Review (when the activity's policy allows review; the original outcome is kept).
- **Execution service** (`src/verification/engine.ts`, independent of the UI): `listAuthorizedActivities`, `startAttempt`, `requiredSteps`, `submitInputs`, `lookupParticipant`, `getAttempt`, `recordEntry`, `denyEntry`, `cancelAttempt`, `referForReview`. It authorizes the individual verifier and the calling application (`WEB_CLIENT`; other apps must be approved), loads the version in use when the attempt started, runs checks in dependency order with timeouts, and records results. The store recomputes the outcome from check results with the Phase 3 rules (`evaluateOutcome`) and refuses results that don't match the attempt's version.
- **Check statuses:** Pending, In Progress, Passed, Failed, Inconclusive, Error, Skipped. Provider errors and timeouts are Error (operational), never a failed match; skipped is never passed (a check skipped because its prerequisite failed counts as failed). Outcomes: Verified, Not Verified, Unable to Verify, Pending Review, per the activity's rules and review policy.
- **Genuinely evaluated against FixID data:** identity record lookup (organization records, confirmed with the identity service — an identity service outage gives Unable to Verify), identity attribute matching against the identity service record, issuer trust, credential validity dates, credential status (FixID is the status authority for credentials it issued), group membership (current membership, by group ID, only for a securely identified person), attribute conditions, previous-verification rules.
- **Not available without a provider:** credential authenticity needs a secure presentation — a credential number or lookup reference is only ever *Inconclusive*, never proof; QR scanning isn't implemented; facial verification and liveness go through the facial verification boundary (unavailable by default, see *Verifier Workspace*); holder binding and external eligibility have no connected service, so they are Inconclusive.
- **Demonstration providers** (demo builds only, audited; their settings screen, Settings → Integrations, is hidden from the MVP administrator interface, and the existing setting is kept as is): labelled simulated stand-ins for wallet presentation and holder binding only (`src/verification/simulatedProviders.ts`, separate from real adapters); facial verification has no simulated stand-in. The verifier picks a labelled test scenario — so results are predictable, never random. Results that depend on them show "Simulated" and a "Demonstration result" banner, and the attempt is flagged `simulated`.
- **Attempts** (`verificationAttempts`): every started attempt is recorded — completed, cancelled, interrupted (expired after 15 minutes), or system error — with activity, version ID and number, verifier, application, subject reference (FixID user ID and masked label only), what kinds of input were given (not the values), each check's result with provider and evidence references, reasons, review state and timestamps. Duplicate submissions return the recorded result; a finished attempt can't be completed again. Verification attempts are separate from the Audit Log.

## Add user journey

`/users/new` (from the dashboard or Users) offers **Add manually**; **Select existing** and **Bulk upload** are marked Planned.

`/users/new/manual`:

1. **Select identifier**: pick a saved identifier, or set one up from a suggestion (Matric Number, Staff ID, Employee Number, Membership Number, Other) in the **identifier drawer**.
2. **User information**: name, email/phone, and the identifier value (manual) or a generated preview. No photo upload: facial enrollment is a separate, user-initiated live capture (planned), tracked as its own status (not enrolled, pending, enrolled, expired, failed). **Create user** runs a simulated ID Switch check: new or confidently matched people are created immediately; existing members, conflicts and name-only matches need attention first.
3. **Create user** saves the user, then a **User created successfully** modal shows the assigned identifier and asks whether to issue a digital ID: **Yes, issue ID** continues in Credential Management; **Not now** returns to Users.

## Bulk user import (CSV)

Users → **Import Users** (also *Add users → Import users*), route `/users/import`, for administrators with `users.manage`. One page, four sections: select identifier → download template → upload → review and import, then a results page.

- **Identifier:** the same identifier configurations as the individual flow. Whether a value is supplied or generated comes from the configuration's existing mode (*Manual* / *Generated*); there's no extra choice. New identifiers can be set up from the page with the existing identifier drawer. Changing the identifier removes an uploaded file.
- **Template:** a real `.csv` download (UTF-8 with BOM, CRLF), headings only. Manual identifiers are a required first column; generated identifiers are left out. Other columns match the Create User form: First Name, Last Name, Email Address (required), Phone Number, Country, Region/State, Gender.
- **Upload checks:** `.csv` only, up to 1 MB and 1,000 users; empty files, missing or duplicate headings, unknown columns, a template for a different identifier, a generated identifier's column, unbalanced quotes and rows with extra values are explained. `Row` and `Errors` columns from a downloaded error report are ignored, so corrected reports can be uploaded again.
- **Validation:** each row uses the shared Create User rules (`src/domain/userValidation.ts`, also used by the individual flow), plus duplicates within the file (identifier, email, phone) and identifiers already in use. The identity check used by the individual flow runs read-only for every valid row: people already in the organization, details that belong to someone else, and same-name possible matches (which need an individual confirmation) aren't imported. Countries accept names or codes, regions are matched to the country, and a phone number whose `+` a spreadsheet removed is restored. Nothing is created during upload or preview.
- **Import:** only after confirmation. Valid rows go through the same `createUser` operation as the individual flow, in file order; invalid rows are skipped. Generated identifiers come from the existing generator, which advances the sequence per created user. Each row has a stable request ID, so a repeated submission or a retry never creates a user twice; an identity created for a row is reused on retry. If the identity service becomes unavailable mid-import, the remaining rows are marked *Not processed* and **Retry remaining** continues.
- **Results:** totals (processed, created, failed, skipped), a row table with reasons, **Download Results** (every row with its status and the identifier assigned) and **Download Error Report** (rows not created, in template columns plus the reason). Each created user is audited as `user.created`, and the import is summarized as `user.imported`.
- **Boundaries:** creates regular users only, in the organization being worked in (enforced in `prepareCreateUser` / `applyCreateUser`); never issues credentials, assigns roles, or updates existing users.
- **Prototype limits:** processing runs in the browser against the simulated store and the mock identity service; a production version needs a server-side import job (with persisted progress and per-row idempotency), server-side file parsing and limits, and the live identity service.

## Users

`/users` shows four KPI cards (Total, Active, Inactive, Portrait Enrolled) and a table with selection, serial numbers, identifier (name and value), email, user status and portrait enrollment. Each row's ⋯ menu offers **View Details**, **Deactivate/Activate User** (confirmed, audited, credentials untouched) and **Send/Resend Enrollment Link** for active users who aren't enrolled. Selecting rows shows a bulk toolbar (**Send Enrollment Link**, **Activate Users**, **Deactivate Users**) that only offers actions some selected users qualify for; the confirmation lists how many will be affected and why others are skipped.

**Developer note:** enrollment links are simulated in this prototype. No email is sent; the invitation is recorded (one open link per user, resend allowed after a minute) and enrollment becomes Pending. The UI uses production wording on purpose. Identity lookups and Seamfix Wallet delivery are also simulated (`src/services/mock*.ts`); the administrator UI doesn't describe these internals. Settings → Demo data has a switch to make the identity service unavailable for testing.

`/users/:id` has a profile header (portrait or initials, name, status) and three tabs: **Profile Details** (with Record Information), **Credentials** (every issued credential, card preview, and Issue Credential), and **Recent Verifications**. The active tab is kept in the URL (`?tab=`).

The sample organization has one enrolled user set up to show a portrait. Put a licensed demo photo at `public/samples/portrait-sample.jpg` to display it; without the file, initials are shown. It's labelled as a sample image, not an enrollment capture.

**Settings** shows only **Organization** and **Administrators & Roles**. Integrations and Demo data are hidden from the navigation; their panels, data and services are unchanged. `?tab=integrations` opens Organization; the demo account can still open its internal demo tools (sample organization switcher, reset) at `/settings?tab=demo`, which falls back to Organization for anyone else.

**Organization Profile (Epic 01, Settings → Organization).** Read-only by default: Organization Name, Short Name, Industry, Default Person Label, Organization Email, Organization Phone Number and Organization Address (each “Not provided” until added), Country (and region, from registration), Time Zone, Organization ID, Organization Status (Active / Inactive) and Date Registered. Administrators who manage settings select **Edit**, then **Save** or **Cancel** (which discards changes). Country, ID, status and registration date are read-only and can't be changed through the edit form or the store (`organization/updateProfile` applies only the editable fields, and only when valid — `src/domain/organization.ts`). Validation is field by field; a failed save shows no success and changes nothing; saved changes appear immediately and are audited. Administrators (including the first one) are managed in Administrators & Roles, personal details in My Profile, and branding isn't part of the profile.

## Credential Management

- **`/credentials`**: a single empty state ("No credentials configured yet" → Create credential) until the first configuration exists; then a table of configurations (SN, name, identifier, issued count, date created, ⋯ View Details / Edit).
- **Create / Edit** use one drawer with two steps: **Choose template** (four starter templates: Classic/Modern × Landscape/Portrait, each with a front and back, and each card with its own Front/Back control) → **Configure credential** (name, identifier, optional **credential logo**, effective date, expiration, renewable) with a live preview of the chosen template. Saving never issues anything; after creating, *Assign now* or *I'll do this later*. Edits apply to future issuance only: each issued credential keeps a snapshot of the name, template, identifier label and logo it was issued with.
- **Credential logo** (optional): keep the organization's initials, pick a saved logo, or upload one (PNG, JPEG or WebP, up to 512 KB, 16–4096 px). The logo is fitted, aspect ratio kept, inside the existing initials box; nothing else on the template moves. Files are validated by their actual bytes (format signature and dimensions), in the browser and again in the store. Uploads become reusable assets of that organization only (`logoAssets`), and configurations store a `logoAssetId`. **Storage dependency:** in this prototype logos are kept as data URLs in the browser's local storage with the rest of the workspace, so they don't reach other browsers or devices, and an upload is refused if the browser can't store it. Production needs organization-scoped file storage (object storage + an asset service).
- **`/credentials/configurations/:id`**: Configuration tab (rules + template front/back) and Issued To tab (individual recipients, Issue credential).
- **`/credentials/issue`**: the one assignment flow: select a configuration (or create one) → select a recipient when none was carried in → review (collects effective/expiry dates when the rule asks for them) → **Issue Credential**, which issues directly and then shows a *Credential issued successfully* modal; **Close** returns to Credentials. Failures stay on Review and Issue with the entered data; repeated clicks and retries reuse one idempotency key per recipient, so nothing is issued twice. Context is carried in the URL (`?recipients=…&credential=…&from=new-user|user|config`).
- **`/credentials/:credentialId`**: the one Issued Credential Details page (card front/back, issuance information, activity history), opened from Issued To and from a user's Credentials tab. `?from=user:<id>` or `?from=config:<id>` decides where Back goes.
- **`/credentials/issued`**: every issued credential with lifecycle filters (used by dashboard shortcuts).

Templates are rendered by one component (`src/components/credentials/CredentialCard.tsx`) everywhere a card appears.

## Data model

- `Organization` → `CredentialType` (identifier configuration, effective date, validity, renewal, lifecycle) → `CardDesign` (one default per org)
- `IdentifierConfig` (stable id, name, manual or generated pattern, persisted sequence)
- `Member` (FixID context, references `idSwitchId`, holds one organizational identifier) → `Credential` (Member × CredentialType, with wallet delivery status)
- `VerificationActivity` (purpose, eligibility, primary + fallback methods, assurance, outcome, schedule) → `Transaction` (result, decision, assurance achieved, fallback used, reason)
- `AuditEvent` (actor, action, resource, result)

## Milestones

- **M1: Product foundation** (current). Layout, navigation, dashboard, all route destinations, component system, connected data model, persistence, simulated organization context.
- M2: Guided "Add person & issue" journey (ID Switch resolution → link → minimal context → credential), issue additional credential, credential type editor.
- Later: credential lifecycle actions, card design editor, verification activity builder, verifier simulator, exports.
