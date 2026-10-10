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
| Verification | Verification Activities · Verification History | `/verification-activities` · `/verification-history` |
| Administration | Audit Log · Settings | `/audit` · `/settings` |

Previous paths (`/people`, `/transactions`, `/card-designs`, `/credential-types`, including detail pages and query strings) redirect to their new routes. The former Verification Events page is no longer in the navigation: `/activities` redirects to Verification Activities and `/activities/:id` to Verification History filtered to that event. Its sample records are kept and shown in Verification History.

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

**Roles.** Three protected **system roles** exist in every organization and can't be edited or deleted. Organizations add their own **custom roles** (Roles & Permissions → **Create Custom Role**), which exist only in the organization that created them (`data.customRoles`). An administrator's access is the union of their roles' permissions, resolved within their organization (`adminPermissions`, `orgRoles`).

| System role | Permissions |
| --- | --- |
| Organization Admin | Every permission below except `verification.execute` (including the protected `roles.assign` and `roles.manage`), in their own organization only |
| Verifier | `verification.execute` — performs verifications only for activities they're assigned to; a focused workspace (My Dashboard, My Verification Activities, My Verification History) |
| Viewer | `users.view`, `groups.view`, `credentials.view`, `verification.activities.view`, `verification.results.view`, `audit.view` — read-only; no administrators or settings |

The earlier built-in **Credential Manager** and **Verification Manager** are now each organization's own custom roles with the same IDs and equivalent permissions, so existing assignments keep their access (saved data is migrated on load).

**Permissions** (`src/domain/roles.ts`; checks always use permissions, never role names):

| Area | Permissions |
| --- | --- |
| Users | `users.view`, `users.create` (add individually), `users.import` (CSV import), `users.edit` (activate/deactivate, enrolment invitations) |
| Groups | `groups.view`, `groups.manage` (create, edit, remove), `groups.members` (add/remove members) |
| Credentials | `credentials.view`, `credentials.manage` (configurations), `credentials.issue` (sensitive) |
| Verification Activities | `verification.activities.view`, `.create`, `.edit` (details and participants), `.activate` (activate/deactivate), `verification.verifiers.assign` (assign verifiers in the editor), `verification.execute` (assigned activities only) |
| Verification History | `verification.results.view` (organization-wide history; verifiers see their own under My Verification History) |
| Administration | `administrators.view`, `administrators.invite` (sensitive), `administrators.manage` (deactivate/reactivate, sensitive), `roles.assign` (protected), `roles.manage` (protected), `settings.manage` (sensitive), `audit.view` |

There are no permissions for features that don't exist (credential revocation, reports).

**Rules:** custom roles can't include the protected Organization Admin privileges (`roles.assign`, `roles.manage`) or permissions the creator can't grant; role names are unique within the organization. Only an Organization Admin manages custom roles and assigns roles. You can only grant roles whose permissions you hold, and you can't act on an administrator who has permissions you lack. A custom role can't be deleted while anyone holds it (the dialog names them; give them other roles first). Editing a role applies immediately to everyone who holds it, including removed permissions. The organization always keeps at least one active Organization Admin; nobody can remove their own Organization Admin role or deactivate themselves. Regular users never become administrators by being created or imported. Duplicate, existing, deactivated and pending invitations are refused; an expired invitation can be replaced or resent.

**Permission-based workspace.** One application for every role: navigation items, pages, tabs and actions are shown from the effective permissions, and every route checks them too (direct links show *You don't have access to this page*). The dashboard is chosen from permissions as well: an organization overview (its sections per permission), the verifier dashboard for verifying-only roles, or a list of the role's areas otherwise — no custom role needs its own dashboard. Settings tabs follow `settings.manage` (Organization, Integrations, Demo data) and `administrators.view` (Administrators & Roles).

**Enforcement (prototype).** Every change is re-checked in the store against the real permissions from state: the reducer's permission table (`ACTION_PERMISSIONS`), the operation functions (`applySaveRole`, `applySetRoles`, `prepareCreateUser` …), and a central check that refuses any action naming an organization other than the one being worked in. This is client-side code standing in for a server: production needs the same checks in the API with server-side sessions.

**Verification governance (prepared, not built).** Rules have three layers — platform, governing authority, organization. `verification.activities.edit` only ever covers the organization layer (`editableRuleLayers`); no organization role can change platform rules. A Verifier's role authorizes performing verifications; which activities is decided by assignment (`authorizeVerifier`). The assignment workflow isn't built yet, so until assignments exist verifiers see a pending state.

**Audit.** Invitations (created, resent, revoked), joining, role assigned / removed / changed, deactivation / reactivation, and custom role created / updated (permissions added and removed) / deleted are written to the Audit Log with the actor, organization, affected administrator or role, previous and new values and outcome. Filter by **Administrators** or **Roles**.

**Role views (account menu → Switch role view).** An Organization Admin switches to another role's view from the account menu, a role card's **Preview**, or the banner's role picker; **Switch back** returns to full access. Navigation, pages, dashboards and direct URLs follow the view's *effective permissions* (custom roles included). A role whose permissions the administrator already holds entirely, such as **Verifier**, is a working view: actions are allowed within the intersection of that role's and the administrator's own permissions, so switching never adds a permission, and workspace-wide actions (demo reset, organization creation) are refused. In demo builds a role the administrator doesn't hold entirely can also be previewed, read-only. Stored roles and the sign-in never change. Navigation: the full admin view shows Dashboard, Users, Groups, Credentials, Verification Activities, Verification History, Audit Log, Settings; the Verifier view shows Dashboard (assigned activities, progress, recent verifications), My Verification Activities and My Verification History (`hiddenWith` hides the *My…* items whenever the organization-wide item is available). In the Verifier view the verification service also refuses other people's attempts.

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

Sample organizations include these activities: *Annual Staff Conference* (identity + eligibility, location and schedule, multiple entries not permitted), *Visitor Identity Check* (identity only), *Membership Verification* (credential + eligibility, on its second version), *Event Access Verification* (a draft with facial verification and a credential), an inactive credential activity and — in Northbridge University — **2026 Examination Clearance** (matric number → live face, 1:1 → eligibility, 24 individually selected students). None has verifier assignments: an administrator assigns them.

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
- **Demonstration providers** (Settings → Integrations, demo builds only, audited): labelled simulated stand-ins for wallet presentation and holder binding only (`src/verification/simulatedProviders.ts`, separate from real adapters); facial verification has no simulated stand-in. The verifier picks a labelled test scenario — so results are predictable, never random. Results that depend on them show "Simulated" and a "Demonstration result" banner, and the attempt is flagged `simulated`.
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
