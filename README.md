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
| Verification | Activities · Verification History | `/activities` · `/verification-history` |
| Administration | Audit Log · Settings | `/audit` · `/settings` |

Previous paths (`/people`, `/transactions`, `/card-designs`, `/credential-types`, including detail pages and query strings) redirect to their new routes.

The top bar contains only the App Launcher and the profile menu (`/profile`). Applications are listed in `src/config/applications.ts`; external destinations are read from `VITE_FIXIAM_URL` and `VITE_ADMIN_URL` and shown as "Not configured" until set.

Deployed on Vercel from this repository. `vercel.json` rewrites all paths to `index.html` so deep links and refresh work; other hosts need the same fallback.

## Demo workspaces

The app opens in **Crestfield Academy**, a brand-new organization with no users, credentials or activities, so the first-time journey runs on real data. Northbridge University, Meridian Health Group and Lagos Tech Summit are established sample organizations. Switch under **Settings → Demo data**.

## Sign in, sign up and onboarding

- **Demo account:** `demo@fixid.app` / `FixIDDemo2026!` (demo mode only). Opens the existing sample organizations; Settings → Demo data and the dashboard preview are available to this account only.
- **Sign up:** `/signup` (email) → `/verify-email` (6-digit code) → `/create-password` → `/onboarding/personal` → `/onboarding/organization` → first-time dashboard of a new, empty organization.
- **Development verification code:** `123456`. No email provider is connected, so no message is actually sent; the code is accepted only in demo mode, expires after 10 minutes and allows 5 attempts. Resend restarts the timer and attempts.
- **Forgot password** (`/forgot-password`) records nothing and sends nothing; it shows the same confirmation for any address. Reset links aren't implemented.
- **Routes:** signed-out visitors are sent to `/signin`; signed-in administrators who haven't finished onboarding resume it; Sign out is in the account menu.

**This is prototype authentication, not a security boundary.** Accounts live in local storage (`fixid.auth.v1`) with passwords salted and hashed (PBKDF2-SHA256), and the sign-up session in session storage (never the code itself). Route checks are client-side only. Production needs a backend identity provider for accounts, email delivery of verification and reset codes, password storage, sessions and authorization. Demo mode is on unless the build sets `VITE_DEMO_AUTH=off`, which disables the demo account and the development code.

Each signed-up organization has its own records (`ownerAccountId` on the organization). The signed-in administrator can only act in their own organization; resetting demo data keeps organizations created through sign-up.

## Administrators & Roles

Settings → **Administrators & Roles** (`/settings?tab=admins`, `&view=roles` for the role catalogue). Administrators are organization-scoped records (`data.administrators`), separate from the users an organization manages; one person can be both, but administrative access is always granted explicitly.

**Current account.** The demo account (in every sample organization) and the owner of an organization created through sign-up are active **Organization Admins** of that organization only. Saved data where that assignment has drifted is repaired on load and sign-in; no other administrator is changed. Nobody can remove their own Organization Admin role or deactivate themselves.

| Role | Permissions | Portal |
| --- | --- | --- |
| Organization Admin | Every organization permission below except `verification.execute` | Yes |
| Credential Manager | `users.view`, `groups.view`, `credentials.view`, `credentials.manage`, `credentials.issue` | Yes |
| Verification Manager | `groups.view`, `verification.activities.view/create/manage`, `verification.rules.manage`, `verification.verifiers.assign`, `verification.results.view`, `verification.exceptions.review` | Yes |
| Verifier | `verification.execute`, `verification.results.view` — assigned activities only | **No** |
| Viewer / Auditor | `administrators.view`, `roles.view`, `users.view`, `groups.view`, `credentials.view`, `verification.activities.view`, `verification.results.view`, `audit.view` | Yes |

Other permissions: `administrators.invite` (invite, resend, revoke), `administrators.manage` (deactivate, reactivate), `roles.assign`, `users.manage`, `groups.manage`, `settings.manage`. Checks always use permissions, never role names (`src/domain/roles.ts`), so custom roles can be added later.

**Rules:** you can only grant roles whose permissions you hold (Verifier can be granted by anyone who can assign verifiers); you can't act on an administrator who has permissions you lack; the organization always keeps at least one active Organization Admin. Duplicate, existing, deactivated and pending invitations are refused; an expired invitation can be replaced or resent.

**Verification governance (prepared, not built).** Rules have three layers — platform, governing authority, organization. `verification.rules.manage` only ever covers the organization layer (`editableRuleLayers`); no organization role can change platform rules, and governing-authority permissions will be added as their own permissions rather than by widening organization roles. `canPerformVerification(admin, activityId)` is the activity-level check the verifier interface will use; verifiers are assigned by someone with `verification.verifiers.assign`, never by themselves.

**Audit.** Invitations (created, resent, revoked), joining, role assigned / removed / changed, and deactivation / reactivation are written to the existing Audit Log with the actor, affected administrator, previous and new values and outcome — e.g. "Tobyson TE changed Kwame Mensah's role from Verification Manager to Credential Manager." Refused changes record nothing. Filter by **Administrators** and open **Details** to see an event.

**Role Preview (demo builds only).** An Organization Admin can choose **Preview as role** in the account menu, or **Preview** on a role card. Navigation, page sections, actions and direct URLs then follow that role (Verifier shows the no-portal screen), with a banner to switch role or **Exit preview**. Preview only ever narrows the real permissions, makes the workspace read-only (every change is refused in the store), and doesn't change stored roles or the sign-in. It is off when `VITE_DEMO_AUTH=off` or `VITE_ROLE_PREVIEW=off`.

**Invitations are simulated.** No email provider is connected and no email is sent. The invited person joins by signing up with the invited email address (code `123456`) within 7 days, and lands directly in the inviting organization with the invited roles.

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
- **Permissions:** viewing needs `groups.view` (Organization Admin, Credential Manager, Verification Manager, Viewer / Auditor); every change needs `groups.manage` (Organization Admin). Role Preview reflects this and stays read-only.
- **Audit:** group created, updated (with previous and new values), removed, and members added or removed — with the affected group and users — e.g. "Tobyson TE added 3 users to the Project Alpha group."

**Data model:** `Group` {id, organizationId, name, description, createdAt/By, updatedAt/By} and `GroupMembership` {organizationId, groupId, memberId, addedAt, addedBy} in the prototype store. `src/domain/groups.ts` is the single read path; `isGroupMember(data, organizationId, groupId, memberId)` is the check a future verification eligibility rule can use (by stable ID, within the organization, against current membership). Sample organizations include a few groups; saved data from before Groups is upgraded on load.

## Verification Activities

Verification → **Verification Activities** (`/verification-activities`), listed before the existing Verification Events and Verification History pages, which are unchanged. An activity is configuration only: what to verify, which checks to run, how results become an outcome, and who may perform it. Nothing is executed in this phase.

- **List:** name, verification type, number of checks, assigned verifiers, status (Draft / Active / Inactive), last updated; search, type and status filters; View, Edit, Activate, Deactivate, Duplicate, Remove Draft.
- **Guided flow** (`/verification-activities/new`, `/:id/edit`): Activity Details → Verification Type (Identity, Credential, Identity and Credential) → Checks & Rules → Outcomes → Assign Verifiers → Review & Activate. Save as Draft from any step; steps keep what was entered.
- **Check catalog** (`src/domain/verification.ts`): identity (record lookup, attribute matching, facial matching, liveness), credential (authenticity, issuer trust, validity, status, holder binding) and eligibility (group membership, attribute condition, external eligibility, previous verification). Each check is Required, Optional, or one of a single group of Approved alternatives (at least one must pass). Only relevant settings are shown per check.
- **Sources and providers:** a trusted identity source (holds the record or reference) is chosen separately from the verification provider (runs the check). Status comes from Settings → Integrations: the identity service and Fixiam reflect their connection; FixID's own credential service and organization records are built in; facial matching, presentation proof, external registries and external eligibility are **Not configured** — nothing pretends to work. Such checks can be explored in a draft but block activation.
- **Validation:** dependencies (e.g. facial matching needs a lookup for the reference and liveness; group membership needs a resolved person; status/validity/holder binding need authenticity; a required check can't depend on an optional one), provider availability, settings, alternatives, at least one required identity or credential check, and at least one assigned verifier. Activation is refused with the reasons listed.
- **Policies:** platform policies are locked — credential activities must require Credential Authenticity, facial matching needs liveness, and a failed or inconclusive required check can never produce Verified. Checks carry a `policySource` (platform / governing-authority / organization) so future mandatory governing-authority checks can be added the same way; no governing-authority relationships are shown.
- **Outcomes:** Verified, Not Verified, Unable to Verify, Pending Review. Organizations choose whether failures and inconclusive checks go to review; rules are shown in plain language. The review workflow itself isn't built yet.
- **Versions:** each activity has stable ID and numbered versions. Draft activities edit their draft; changes to an active or inactive activity go into a new draft version while the active one stays in use, and activating it supersedes (never edits) the old one. `executionPlan()` returns the active version for a future verifier application, so results can record the version they used.
- **Verifiers:** administrators with the Verifier role in the organization can be assigned. Assignment grants only the ability to perform that activity. `authorizeVerifier()` is the check an external verifier app would call: active administrator, Verifier permission, active assignment, active activity — Organization Admins aren't verifiers unless assigned with that role.
- **Details** (`/verification-activities/:id`): header with status, type, version in use and actions; tabs Overview (summary, rules, versions), Checks & Rules (switch between in-use and draft versions), Verifiers (assign, remove, "can perform now"), Activity History (this activity's Audit Log entries).
- **Permissions:** view `verification.activities.view`; create/duplicate `.create`; details, activate, deactivate, remove `.manage`; checks and outcomes `verification.rules.manage`; verifiers `verification.verifiers.assign`. Organization Admin and Verification Manager have them all; Viewer / Auditor can view; Credential Manager and Verifier can't open the module. Role Preview reflects this and stays read-only.
- **Audit:** created, details updated, checks added/removed, rules changed, providers/sources changed, verifier assigned/removed, activated (with version), deactivated, duplicated, draft removed, draft changes discarded — with previous and new values.
- **Groups:** a group used by an activity's group membership check can't be removed.

Sample organizations include four activities: an active identity check, an active credential check on its second version, a draft that needs services that aren't configured, and an inactive one.

## Verification execution and the Verifier Interface

**Verifier Interface** at `/verify` (account menu → Verifier Interface, or Verification Activities → Open Verifier Interface). A separate, focused shell using the same sign-in; administrators with the Verifier role and no portal access land here from the portal's "no portal access" screen.

- **Who can verify:** an active administrator of the organization with `verification.execute` (the Verifier role) who is assigned to an active activity. The home screen lists only those activities; draft and inactive ones never appear. Direct links to other activities are refused and the refusal is written to the Audit Log (`verification.denied`). An Organization Admin isn't a verifier by default — in demo builds, **Set up demo verifier access** explicitly adds the Verifier role and assignments through the normal, audited operations.
- **Flow:** Start Verification → the steps adapt to the activity's checks (identifier, credential presentation, stated details, demonstration capture scenarios) → Run verification → live check progress → result with outcome, summary (activity, type, time, reference, privacy-safe subject label, verifier, organization), each check's status and explanation, and Finish / Start New Verification / View Verification Details / Refer for Review (when the activity's policy allows review; the original outcome is kept).
- **Execution service** (`src/verification/engine.ts`, independent of the UI): `listAuthorizedActivities`, `startAttempt`, `requiredSteps`, `submitInputs`, `getAttempt`, `cancelAttempt`, `referForReview`. It authorizes the individual verifier and the calling application (`WEB_CLIENT`; other apps must be approved), loads the version in use when the attempt started, runs checks in dependency order with timeouts, and records results. The store recomputes the outcome from check results with the Phase 3 rules (`evaluateOutcome`) and refuses results that don't match the attempt's version.
- **Check statuses:** Pending, In Progress, Passed, Failed, Inconclusive, Error, Skipped. Provider errors and timeouts are Error (operational), never a failed match; skipped is never passed (a check skipped because its prerequisite failed counts as failed). Outcomes: Verified, Not Verified, Unable to Verify, Pending Review, per the activity's rules and review policy.
- **Genuinely evaluated against FixID data:** identity record lookup (organization records, confirmed with the identity service — an identity service outage gives Unable to Verify), identity attribute matching against the identity service record, issuer trust, credential validity dates, credential status (FixID is the status authority for credentials it issued), group membership (current membership, by group ID, only for a securely identified person), attribute conditions, previous-verification rules.
- **Not available without a provider:** credential authenticity needs a secure presentation — a credential number or lookup reference is only ever *Inconclusive*, never proof; QR scanning isn't implemented; facial matching, liveness, holder binding and external eligibility have no connected service, so they are Inconclusive.
- **Demonstration providers** (Settings → Integrations, demo builds only, audited): labelled simulated stand-ins for wallet presentation, holder binding, liveness and facial matching (`src/verification/simulatedProviders.ts`, separate from real adapters). The verifier picks a labelled test scenario — match, no match, poor quality, timeout, unavailable — so results are predictable, never random. Results that depend on them show "Simulated" and a "Demonstration result" banner, and the attempt is flagged `simulated`.
- **Attempts** (`verificationAttempts`): every started attempt is recorded — completed, cancelled, interrupted (expired after 15 minutes), or system error — with activity, version ID and number, verifier, application, subject reference (FixID user ID and masked label only), what kinds of input were given (not the values), each check's result with provider and evidence references, reasons, review state and timestamps. Duplicate submissions return the recorded result; a finished attempt can't be completed again. Verification attempts are separate from the Audit Log.

## Add user journey

`/users/new` (from the dashboard or Users) offers **Add manually**; **Select existing** and **Bulk upload** are marked Planned.

`/users/new/manual`:

1. **Select identifier**: pick a saved identifier, or set one up from a suggestion (Matric Number, Staff ID, Employee Number, Membership Number, Other) in the **identifier drawer**.
2. **User information**: name, email/phone, and the identifier value (manual) or a generated preview. No photo upload: facial enrollment is a separate, user-initiated live capture (planned), tracked as its own status (not enrolled, pending, enrolled, expired, failed). **Create user** runs a simulated ID Switch check: new or confidently matched people are created immediately; existing members, conflicts and name-only matches need attention first.
3. **Create user** saves the user, then a **User created successfully** modal shows the assigned identifier and asks whether to issue a digital ID: **Yes, issue ID** continues in Credential Management; **Not now** returns to Users.

## Users

`/users` shows four KPI cards (Total, Active, Inactive, Portrait Enrolled) and a table with selection, serial numbers, identifier (name and value), email, user status and portrait enrollment. Each row's ⋯ menu offers **View Details**, **Deactivate/Activate User** (confirmed, audited, credentials untouched) and **Send/Resend Enrollment Link** for active users who aren't enrolled. Selecting rows shows a bulk toolbar (**Send Enrollment Link**, **Activate Users**, **Deactivate Users**) that only offers actions some selected users qualify for; the confirmation lists how many will be affected and why others are skipped.

**Developer note:** enrollment links are simulated in this prototype. No email is sent; the invitation is recorded (one open link per user, resend allowed after a minute) and enrollment becomes Pending. The UI uses production wording on purpose. Identity lookups and Seamfix Wallet delivery are also simulated (`src/services/mock*.ts`); the administrator UI doesn't describe these internals. Settings → Demo data has a switch to make the identity service unavailable for testing.

`/users/:id` has a profile header (portrait or initials, name, status) and three tabs: **Profile Details** (with Record Information), **Credentials** (every issued credential, card preview, and Issue Credential), and **Recent Verifications**. The active tab is kept in the URL (`?tab=`).

The sample organization has one enrolled user set up to show a portrait. Put a licensed demo photo at `public/samples/portrait-sample.jpg` to display it; without the file, initials are shown. It's labelled as a sample image, not an enrollment capture.

## Credential Management

- **`/credentials`**: a single empty state ("No credentials configured yet" → Create credential) until the first configuration exists; then a table of configurations (SN, name, identifier, issued count, date created, ⋯ View Details / Edit).
- **Create / Edit** use one drawer with two steps: **Choose template** (four starter templates: Classic/Modern × Landscape/Portrait, each with a front and back) → **Configure credential** (name, identifier, effective date, expiration, renewable) with a live preview of the chosen template. Saving never issues anything; after creating, *Assign now* or *I'll do this later*. Edits apply to future issuance only: each issued credential keeps a snapshot of the name, template and identifier label it was issued with.
- **`/credentials/configurations/:id`**: Configuration tab (rules + template front/back) and Issued To tab (individual recipients, Issue credential).
- **`/credentials/issue`**: the one assignment flow: select a configuration (or create one) → select a recipient when none was carried in → review (collects effective/expiry dates when the rule asks for them) → issue. Context is carried in the URL (`?recipients=…&credential=…&from=new-user|user|config`).
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
