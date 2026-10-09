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
| User Management | Users · Groups | `/users` · `/groups` (planned shell) |
| Credential Management | Credentials · Templates | `/credentials` · `/templates` (card designs), `/templates/credential-types` |
| Verification | Activities · Verification History | `/activities` · `/verification-history` |
| Administration | Audit Log · Settings | `/audit` · `/settings` |

Previous paths (`/people`, `/transactions`, `/card-designs`, `/credential-types`, including detail pages and query strings) redirect to their new routes.

The top bar contains only the App Launcher and the profile menu (`/profile`). Applications are listed in `src/config/applications.ts`; external destinations are read from `VITE_FIXIAM_URL` and `VITE_ADMIN_URL` and shown as "Not configured" until set.

Deployed on Vercel from this repository. `vercel.json` rewrites all paths to `index.html` so deep links and refresh work; other hosts need the same fallback.

## Demo workspaces

The app opens in **Crestfield Academy**, a brand-new organization with no users, credentials or activities, so the first-time journey runs on real data. Northbridge University, Meridian Health Group and Lagos Tech Summit are established sample organizations. Switch under **Settings → Demo data**.

## Add user journey

`/users/new` (from the dashboard or Users) offers **Add manually**; **Select existing** and **Bulk upload** are marked Planned.

`/users/new/manual`:

1. **Select identifier**: pick a saved identifier, or set one up from a suggestion (Matric Number, Staff ID, Employee Number, Membership Number, Other) in the **identifier drawer**.
2. **User information**: name, email/phone, and the identifier value (manual) or a generated preview. No photo upload: facial enrollment is a separate, user-initiated live capture (planned), tracked as its own status (not enrolled, pending, enrolled, expired, failed). **Create user** runs a simulated ID Switch check: new or confidently matched people are created immediately; existing members, conflicts and name-only matches need attention first.
3. **Create user** saves the user, then a **User created successfully** modal shows the assigned identifier and asks whether to issue a digital ID: **Yes, issue ID** continues in Credential Management; **Not now** returns to Users.

## Users

`/users` shows four KPI cards (Total, Active, Inactive, Portrait Enrolled) and a table with selection, serial numbers, identifier (name and value), email, user status and portrait enrollment. Each row's ⋯ menu offers **View Details**, **Deactivate/Activate User** (confirmed, audited, credentials untouched) and **Send/Resend Enrollment Link** for active users who aren't enrolled. Enrollment links are simulated: no email is sent; the invitation is recorded (one open link per user, resend allowed after a minute) and enrollment becomes Pending.

`/users/:id` has a profile header (portrait or initials, name, status) and three tabs: **Profile Details** (with Record Information), **Credentials** (every issued credential, card preview, and Issue Credential), and **Recent Verifications**. The active tab is kept in the URL (`?tab=`).

The sample organization has one enrolled user set up to show a portrait. Put a licensed demo photo at `public/samples/portrait-sample.jpg` to display it; without the file, initials are shown. It's labelled as a sample image, not an enrollment capture.

## Credential Management

`/credentials/issue` is the one assignment flow: select a credential configuration (or **Create credential** in the credential drawer) → select recipients when none were carried in → review → issue. The recipient, credential and origin are carried in the URL (`?recipients=…&credential=…&from=new-user|user`), so the context survives navigation and refresh. Recipients are a list so one configuration can later be assigned to many users; selection is single for now.

Saving a credential configuration never issues it: a **Credential created successfully** modal offers **Assign now** or **I'll do this later**. The same applies from **Credentials → Create credential** and **Templates → Credential types**. A user's **Issue credential** action (and `/users/:id/issue`) opens this flow with that user preselected.

Identifiers and credentials are reusable, organization-level configurations, managed under **Templates → Identifiers** and **Templates → Credential types** with the same drawers. Generated identifiers come from a segment pattern (static text, separator, sequential number, random digits, random letters and numbers, date in the organization's time zone). Previews never consume a sequence number; the identifier is assigned once, when the user is created, and credentials display it without regenerating it.

Business rules live in `src/store/operations.ts` and `src/domain/identifierPattern.ts`. The draft is kept in `sessionStorage`.

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
