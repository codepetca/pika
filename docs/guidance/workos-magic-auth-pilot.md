# WorkOS Magic Auth pilot

## Goal

Prove that Pika can keep its existing `/login` and `/signup` surfaces while
WorkOS becomes the credential authority for a school-board-compatible email and
six-digit passcode flow.

## Boundaries

- WorkOS creates and verifies the one-time passcode and owns the external user
  and encrypted WorkOS session.
- Pika keeps `public.users.id` as its domain identity. A verified WorkOS user is
  linked through `public.users.workos_user_id`; WorkOS IDs never replace Pika
  ownership IDs.
- Pika's existing `pika_session` remains a temporary compatibility session so
  the rest of the application can continue to use `requireAuth()` during the
  pilot. When the pilot is enabled, every Pika authorization check also
  requires a verified WorkOS session with the same normalized email and exact
  WorkOS user id; the Pika cookie is a 180-day internal UUID/role mapping, not
  an independent credential.
- The pilot is disabled by default and does not change the password flow unless
  `WORKOS_MAGIC_AUTH_PILOT=true`.
- This slice does not configure Pika/Bara attendance integration, SSO, or a
  production rollout.

## UI change brief

- Surface: existing Pika login and signup cards at `/login` and `/signup`.
- Reference: the current Pika unauthenticated form pattern.
- Affected roles: unauthenticated teachers and students.
- Required viewports: desktop and mobile.
- Required themes: light and dark.
- Key states: email entry, sending, code entry, verifying, resend, invalid or
  expired code, success, and change-email.
- Primary signal: the existing primary action button and one focused form field.
- Must not add: a WorkOS-hosted redirect, a new auth URL, social-login chrome,
  role selection, or duplicate account-creation steps.
- Composite widget accessibility review: no; the code input remains a labelled
  native text input with one-time-code autocomplete.

## Acceptance gates

1. With the flag off, existing password login and signup behavior is unchanged.
2. With the flag on, both existing URLs send a WorkOS-generated passcode and
   verify it without leaving Pika.
3. Provider secrets, returned passcodes, Magic Auth IDs, and provider error
   details never reach the browser or logs.
4. A verified WorkOS identity maps idempotently to one Pika user, and conflicting
   links fail closed.
5. Successful verification stores both the encrypted WorkOS session and the
   temporary Pika compatibility session, then returns only a safe Pika path.
6. A legacy or mismatched Pika-only cookie fails closed while the pilot is on,
   preventing a cross-app attendance request from causing a second login.
7. Automated API, identity, and component tests pass before dashboard changes.
8. A real school-board account receives and submits the code in a local or
   preview smoke test before the pilot is considered viable.

## Remembered-session contract

Pika's remembered-login contract is 180 days (`15,552,000` seconds). The Pika
and WorkOS cookies must use the same browser lifetime; WorkOS Dashboard maximum
and inactivity session lifetimes must not expire the credential earlier.

The two cookies have different authority:

- The encrypted WorkOS cookie is the credential and refresh authority.
- `pika_session` contains only Pika's internal UUID, role, normalized email,
  exact WorkOS user ID, and session-format version.
- Every protected request fails closed unless the two identities match while
  the pilot is enabled.
- If an older or missing Pika cookie accompanies a valid WorkOS session,
  `/login` silently recreates the Pika mapping from the existing exact
  `public.users.workos_user_id` link. Restoration never creates or relinks an
  account and falls back to code entry on any mismatch.
- Server and client reauthentication redirects preserve only a validated
  same-origin path. Middleware replaces any inbound path-header spoof before a
  protected server route builds its `/login?next=...` destination.
- Browser logout destroys the Pika session, clears pending Magic Auth state,
  and uses AuthKit logout to invalidate the WorkOS session. Configure the
  WorkOS application's default Logout URI to Pika's `/login` URL.

### Preview and Production verification

For each environment, verify all of the following before promotion:

1. Set `WORKOS_COOKIE_MAX_AGE=15552000` and confirm the Dashboard session
   lifetime settings do not shorten the 180-day contract.
2. Confirm `pika_session` and the configured WorkOS cookie are secure,
   HTTP-only, same-site cookies whose `Max-Age` is `15552000` seconds.
3. Sign in, remove only `pika_session`, and open a protected deep link with a
   query string. The login surface must restore the mapping without sending a
   code and return to that exact safe path.
4. Repeat with an older unbound Pika cookie and a valid WorkOS cookie; the
   compatibility session must upgrade automatically from the exact WorkOS
   subject link.
5. Remove or alter the WorkOS cookie; a Pika cookie alone must never authorize
   the request.
6. Log out, revisit a protected path, and confirm the prior WorkOS session
   cannot silently restore authentication.
7. Exercise one teacher and one student path, including a fresh code login, a
   restored session, a protected deep link, and logout.

If any gate fails, disable `WORKOS_MAGIC_AUTH_PILOT` in that environment and
redeploy. Do not weaken the exact-subject check or restore by email.

## Brevo delivery staging slice

### Decision

Keep WorkOS as the credential authority and use Pika's existing Brevo channel
only as the transport:

1. Pika's server requests a Magic Auth challenge from WorkOS.
2. WorkOS returns a six-digit, ten-minute code to the server.
3. Pika sends that exact code through Brevo using the existing verified
   `notify.codepet.ca` sender.
4. The browser receives only the expiry and generic success state; it never
   receives the code or Magic Auth ID.
5. Pika sends the student's entered code back to WorkOS for authentication.
6. WorkOS still owns code generation, expiry, verification, the external user,
   and the encrypted session. Brevo never becomes an identity provider.

### Rollout controls

- `WORKOS_MAGIC_AUTH_EMAIL_DELIVERY` defaults to `workos`.
- Selecting `brevo` also requires
  `WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED=true`; otherwise authentication
  fails closed before WorkOS creates a code.
- The second variable is an explicit deployment acknowledgement. It does not
  change WorkOS Dashboard configuration itself.
- Brevo mode calls the transport directly and never uses Pika's mock-email
  logger, so a WorkOS code is not written to application logs.
- A Brevo failure returns a generic `503`, saves no pending challenge cookie,
  and exposes neither provider details nor the code.
- WorkOS's default Magic Auth email must be disabled before selecting Brevo or
  users will receive a fast Brevo message followed by a confusing duplicate
  WorkOS message.

### Staging gate

1. Keep Production's WorkOS email configuration and Pika deployment unchanged.
2. Confirm the Pika Staging WorkOS client and an expiring Pika-scoped API key.
3. Confirm Brevo credentials and the verified `notify.codepet.ca` sender in the
   local or preview runtime without printing secrets.
4. Disable WorkOS's default Magic Auth email only in Codepet Platform Staging.
5. Set the two delivery variables to `brevo` and `true` only in the isolated
   Staging canary runtime.
6. Request a board-account code from Pika's existing `/login` screen.
7. Require visible inbox arrival within the ten-minute WorkOS expiry, successful
   WorkOS verification, both sessions, and exactly one linked Pika UUID.
8. Restore the Staging WorkOS email setting if the test is unsuccessful. Do not
   promote the two delivery variables to Production during this slice.

Because WorkOS email configuration is environment-wide, a later Production
rollout must account for Bara Hosted UI Magic Auth. If more Codepet applications
need email codes, route `magic_auth.created` events by `context.client_id`
through a small platform-owned mail bridge rather than importing Pika code into
other repositories.

### Staging Brevo result — passed 2026-08-16

- The first canary failed closed because the configured Preview Brevo API key
  is disabled. Pika returned a generic `503`, exposed no provider detail or
  passcode, and saved no pending challenge.
- A second isolated local canary used the existing active Brevo credential
  without persisting or printing it. The board-account message arrived almost
  immediately through the verified Codepet sender.
- The user entered the six-digit code on Pika's existing login surface. WorkOS
  verified the code, Pika saved the WorkOS and compatibility sessions, and the
  browser reached `/classrooms` successfully.
- Local identity evidence showed exactly one linked Pika user, one distinct
  WorkOS identity, and no duplicate WorkOS links.
- The canary process was stopped, temporary environment files were deleted, and
  WorkOS Staging's default Magic Auth email was restored to Enabled so Bara is
  not affected before a shared delivery design is deployed.
- No Pika, Bara, Vercel, Supabase, or WorkOS Production deployment/configuration
  was changed by this Brevo canary.

This proves the board-compatible delivery and authentication mechanism. It does
not authorize Production rollout. Before enabling Brevo in a hosted Preview,
replace or re-enable its disabled Preview API key. Before Production, choose an
environment-wide delivery design that preserves Bara's Hosted UI flow as well
as Pika's self-hosted flow.

### Local setup recurrence — fixed 2026-08-17

- Symptom: `/api/auth/workos/magic/start` returned the intentionally generic
  `503 Authentication is temporarily unavailable` even though WorkOS created
  the Magic Auth challenge.
- First cause: the shared local Pika environment did not contain the existing
  `BREVO_API_KEY`, template, and sender variables.
- Second cause: the old staging files did contain those variables, but their
  Brevo API key had been disabled. Copying it reproduced the same generic 503;
  the server-only Brevo response was `API Key is not enabled`.
- Fix: refresh the four Brevo variables from Pika's currently deployed,
  verified configuration, restart Next.js so it reloads `.env.local`, and
  retry the request. Do not create a new credential merely for this local test.
- Prevention: `pnpm attendance:local:configure` now preserves an existing
  working local Brevo configuration and verifies the selected Brevo key with a
  read-only account request before writing either Pika or Bara environment
  file. An explicitly supplied replacement requires `--refresh-brevo`.
- Security: the configurator and verification output report only readiness;
  they never print the API key, passcode, or recipient email.

## Bara attendance identity boundary

The cross-application browser handoff was retired. Pika and Bara remain
separate WorkOS Applications with separate cookies and internal user IDs.
Native Pika attendance does not create a Bara browser session.

While `WORKOS_MAGIC_AUTH_PILOT=true`, Pika treats its compatibility cookie as
valid only alongside a verified WorkOS session whose email and WorkOS user id
match the Pika session binding. For student QR
check-in, Pika additionally verifies that the WorkOS subject matches the local
student identity, then resolves an installation-scoped opaque `principal_ref`
before its server sends the signed, versioned command to Bara. Bara receives
and maps only that opaque ref into its tenant-bound `app_users` and
`auth_identities` model. Neither app transmits or uses a WorkOS subject as a
domain ownership ID.

The legacy `PIKA_BARA_AUTH_HANDOFF` flag must remain false. Do not replace the
server adapter with shared cookies, shared databases, shared internal IDs, or
an unverified browser assertion.

## Production email canary slice

### Purpose

Separate the board-mail delivery question from a Pika production rollout. Run
the existing self-hosted Pika UI and local Supabase against an expiring,
Pika-scoped WorkOS Production credential so the email uses WorkOS's production
sender. Do not deploy the pilot or point it at hosted Pika data.

### Why this slice is separate

- WorkOS Staging sends from `workos.dev`; WorkOS marked the board messages as
  delivered, but they did not reach the inbox.
- The same flow completed with a non-board address, saved both sessions, and
  linked exactly one WorkOS identity to one local Pika UUID.
- The existing Brevo-backed Pika sender uses `notify.codepet.ca`; sender-domain
  behavior is therefore the remaining unknown, not code generation or identity
  linking.

### Phase A — no-cost production-sender canary

1. Keep Pika local and `WORKOS_MAGIC_AUTH_PILOT=false` in the shared env file.
2. In Codepet Platform Production, set the neutral environment display name to
   `Codepet` because branding applies to both Pika and Bara.
3. Create the Pika application and a one-hour API key scoped to that application.
4. Enable Magic Auth only with explicit acknowledgement that authentication
   methods are shared by Bara and Pika in this WorkOS environment.
5. Start a separate local process with the production Client ID/API key supplied
   only to that process; keep local Supabase and do not persist the API key.
6. Request and verify one code with the board account. Record WorkOS delivery
   state, inbox arrival, verification response, session creation, and the unique
   local identity link.
7. Stop the process and revoke the key or let its one-hour expiry elapse.

Phase A uses WorkOS's default production sender (`workos-mail.com`) and creates
no DNS record or paid custom-domain subscription. WorkOS currently prices
AuthKit at $0 for the first one million monthly active users; this one-user
canary must not enable an enterprise SSO connection or any paid add-on.

With production branding set to `Codepet`, the expected message is:

- sender address: `access@workos-mail.com`
- subject: `Sign in to Codepet`
- body: WorkOS's transactional Magic Auth template containing the six-digit,
  ten-minute code

The user remains on `pika.codepet.ca/login` (or the local canary URL); the sender
domain does not introduce a hosted redirect.

### Phase B — Codepet-domain canary only if Phase A fails

Use `auth.codepet.ca`, which is currently unallocated, as the project-wide
WorkOS email domain. The current WorkOS Dashboard quotes $99/month for all
custom domains and says the setting applies across Codepet Platform
environments. Starting that subscription and adding the generated Cloudflare
CNAME records require separate explicit approval.

If the managed domain is not cost-effective, compare one environment-wide
provider supported directly by WorkOS (for example Resend or Postmark) before
building a custom Brevo bridge. A custom bridge must handle both Pika's direct
Magic Auth requests and any Bara Hosted UI events because WorkOS's default
Magic Auth email switch is environment-wide.

### Stop conditions

- Do not deploy or set Vercel production variables during the canary.
- Do not use hosted Pika/Supabase data.
- Do not subscribe to custom domains or mutate Cloudflare DNS without exact
  approval.
- Do not leave a non-expiring production API key.
- Do not declare board compatibility from a WorkOS `Delivered` event alone;
  the code must visibly arrive and authenticate successfully.

### Phase A rollback

If the board message does not arrive or verification fails:

1. Stop the local canary process. The shared Pika env remains on the staging
   Client ID/key with `WORKOS_MAGIC_AUTH_PILOT=false`.
2. Revoke the one-hour Pika production API key immediately rather than waiting
   for expiry.
3. Disable Magic Auth in Codepet Platform Production, restoring Bara's previous
   authentication-method surface.
4. Restore the prior production display name if the neutral `Codepet` name is
   not retained as an independent branding correction.
5. Remove the empty Pika production application only after confirming the
   WorkOS test user is not coupled to application deletion. Delete the exact
   canary user only with separate destructive-action approval.
6. Make no Pika/Vercel/Supabase production change. The existing Brevo/password
   authentication path remains the deployed behavior throughout the canary.

Before starting Phase A, record the current production method, branding,
application, key, user-count, billing, and domain state so rollback can be
verified against evidence rather than assumed.

### Phase A result — failed delivery gate

- WorkOS Staging marked the board message delivered; it appeared in junk about
  thirty minutes later, after the ten-minute code had expired.
- WorkOS Production accepted Pika requests and marked messages delivered at
  1:29 PM and 6:25 PM on 2026-08-16, but neither was visible within the valid
  code window.
- A non-board account completed the same Staging code, session, and identity
  flow, isolating the remaining failure to board-mail delivery latency.
- Both Pika Production canary keys are expired, the local Production canary is
  stopped, and no Pika/Vercel/Supabase Production change was made.
- The Production Pika application, neutral `Codepet` branding, and enabled Magic
  Auth method remain because the approved direction still uses WorkOS Magic
  Auth. WorkOS's default email provider remains configured until a replacement
  is verified and the shared Bara impact is handled.

### Phase A baseline — 2026-08-16

- Project/environment: Codepet Platform / Production
- Applications: one (`Bara`, default); no Pika application
- Active API keys: one, scoped to Bara
- AuthKit users: two
- Magic Auth: disabled
- Display name: inherited `dev.codepet's team`
- Email domain/provider: default WorkOS production sender; no custom domain
- Custom-domain subscription: inactive; Dashboard quotes $99/month
- Enterprise SSO connections and directories: zero
- Billing: pay-as-you-go, no prior bill shown; canary is limited to free AuthKit
  usage and must not enable paid connections or add-ons
- Pika deployment/data: existing Brevo/password production flow unchanged;
  canary uses local Pika and local Supabase only
