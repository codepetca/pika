# Clarity teacher-workflow pilot — implementation plan

Status: draft, not implemented. Derived from the [product proposal](clarity-teacher-workflow-proposal.md).
Recorded: 2026-09-02. Refreshed: 2026-10-08.
Code baseline: `e24d591abb53713e01d75a5c95fc418cf57592eb`.
Planning branch: `codex/clarity-teacher-pilot-plan`; owner: this planning task.
Recheck integration points against the implementation checkout before editing code.

Model recommendation: `gpt-6.1-sol` with high reasoning — scoped integration work with
privacy/security review and current repository defaults; keep the task's configured model
and settings unless a later owner explicitly changes them.
Planning risk profile: none (documentation only). Future implementation risk profiles:
workspace-state and runtime-platform; privacy/security review risk: high.

## Authority and boundaries

- This change saves plans only. No SDK, project, cookie, tracking, schema, deployment,
  or account configuration is created by it. No production launch is authorized.
- Begin implementation only after approval, full session startup/environment verification,
  and reconciliation with current feature/branch ownership.
- Follow [dev workflow](../dev-workflow.md), [architecture](../core/architecture.md),
  [tests](../core/tests.md), and [risk checklists](../guidance/dev-flow-risk-checklists.md).
- Before consent/settings or other visible changes, load `pika-ui-change`, name the
  approved Pattern Lab/reference surface and reuse decisions, then run `pika-ui-verify`.
- No new dependency by default. Prefer the documented script loader if the capability
  spike validates it; any dependency needs explicit approval. Never alter shared secrets.
- No migration assumed. If durable consent/audit requirements need a new table, stop
  to approve that design and follow the exact-target migration permission workflow.
- Keep future mixed-classroom roles out of scope: the
  [access roadmap](../guidance/classroom-access-and-entitlements-roadmap.md) is dormant.
  Do not activate its contracts or change current authorization for this integration.

## Repository findings and proposed touchpoints

| Existing location | Observed behavior | Implementation consequence |
| --- | --- | --- |
| `src/app/layout.tsx` | Global providers now include optional WorkOS AuthKit; metadata still describes online high schools | Do not install Clarity unconditionally here. Review audience/disclosure consistency; do not change marketing wording merely to bypass eligibility. |
| `src/app/teacher/layout.tsx` | Server-resolved teacher guard for teacher tools | Possible approved tools boundary, but not the main classroom workflow. |
| `src/app/classrooms/layout.tsx` | Shared authenticated teacher/student route tree; student Pal context can wrap the same subtree | `/teacher` path filtering is insufficient. Use server identity, admitted classroom relationship, and explicit collection eligibility. |
| `src/app/classrooms/[classroomId]/page.tsx`, `src/lib/server/classroom-page-access.ts` | Current account role can differ from the contextual classroom owner/member relationship; the admitted relationship chooses the experience role | Neither global account role nor pathname proves pilot eligibility. Require server-confirmed owner relationship for the exact classroom and a separate adult-pilot decision. |
| `src/app/classrooms/[classroomId]/ClassroomPageClient.tsx`, `src/ui/TabContentTransition.tsx` | Role-based tabs, query-selected records and test previews; visited tabs remain mounted while inactive content becomes hidden/inert | Require semantic screen/overlay state. Inactive sensitive DOM remains mounted; pathname, CSS visibility or the current tab alone is insufficient. |
| `src/components/AppShell.tsx` | Shared header and `AuthSessionWatcher`; user identity and classroom details | Candidate lifecycle wiring only. Never pass entire user/classroom objects to analytics. |
| `src/components/AuthSessionWatcher.tsx`, `src/lib/client-auth.ts`, `src/app/api/auth/me/route.ts` | Server session validation, identity-change detection, focus/visibility rechecks | Reuse identity boundaries; do not weaken authentication or rely on the existing 60-second watcher as a privacy guarantee. |
| `src/components/AssignmentModal.tsx` | Opening create mode immediately persists an untitled draft, then autosaves and supports explicit keep/close flows | Automatic placeholder creation is not teacher completion or publication. Preserve state/unsaved work and distinguish system initialization from an intentional Draft outcome. |
| `src/hooks/useAssignmentScheduling.ts` | Separate Post, Schedule, Draft lifecycle and successful response handling | Emit outcome events at these semantic transitions; do not instrument button text as truth. |
| `src/lib/classroom-ux-metrics.ts` | Browser-local ring of tab-switch timings | Reuse timing semantics if needed; do not silently export existing metrics or unrestricted tab values. |
| `src/lib/events.ts`, test focus-event modules | Existing student exam-mode exit/focus telemetry is a first-party assessment-integrity feature | Keep it entirely separate. Never export it to Clarity or treat replay as cheating evidence. |
| `next.config.js`, `src/lib/browser-security.ts` | Browser-security policy and release-related environment values are centrally reviewed | Reuse approved release identifiers only. Review actual deployment headers before any narrowly scoped CSP change. |

Targeted search of current `src`, `package.json`, `next.config.*`, and `.env.example`
found no Clarity/PostHog integration or cookie-consent implementation. The current
[student-data egress audit](../guidance/student-data-egress-audit.md) independently
records the same absence for its scoped source search. No dedicated privacy, terms, or
account-level analytics settings page was found by the scoped `src/app` path search;
classroom settings exist at `src/app/classrooms/[classroomId]/TeacherSettingsTab.tsx`.
This is not a full legal-policy, platform-config or deployed-header audit. Do not invent
organization, age, consent or adult-status fields: current app contracts do not establish
them. Current contextual access also means the global account role is not enough.

## Work packages and gates

### P0 — Eligibility and lifecycle feasibility (blocks live collection)

- [ ] Send the separately approved [eligibility inquiry](clarity-microsoft-eligibility-inquiry.md)
  and record an authoritative Microsoft response for this mixed-audience,
  adult-teacher-only, same-domain pilot.
- [ ] Name privacy owner, participating adults, allowed screens, and reviewer access.
- [ ] Review vendor use, cookies, retention, project deletion, and customer agreements.
- [ ] Audit teacher headers, sidebars, portals, inactive tabs, editors, media, title,
  attributes, hrefs, page/referrer URLs, and query parameters for sensitive content.
- [ ] With synthetic accounts/data only and an approved test project, prove script
  start, stop, withdrawal, queued uploads, history restoration, and account transitions.
  Use current documented APIs; do not assume a generic pause/stop API exists. Consent V2
  denial ends the cookie-backed session but restarts cookieless tracking, so it does not
  prove a Pika no-collection stop boundary.
- [ ] Verify dynamic modal heatmaps and internal scroll-container usefulness. If heatmaps
  cannot represent the real workflow, record the limitation and use replay/events instead.

**Gate:** choose a demonstrated isolation design before implementation:

1. Shared app integration only if capture can be stopped before excluded DOM/state is
   introduced, including queued payloads and browser history restoration.
2. Otherwise use an approved isolated authoring page/document with hard navigation
   boundaries, if it can preserve editor state and avoid a disproportionate redesign.
3. Otherwise narrow the pilot or stop. Never compensate with dashboard filtering,
   script-tag removal, broad masking assumptions, or monkey-patching browser internals.

No production script or public project key is enabled while P0 is unresolved.

### P1 — Default-off policy and integration foundation

Proposed new modules (names are implementation suggestions, not existing files):

- `src/lib/analytics/clarity-policy.ts`: pure eligibility/surface decisions and states.
- `src/lib/analytics/clarity-events.ts`: typed event/tag allowlists and validation.
- `src/lib/analytics/clarity-client.ts`: documented loader/adapter, bounded failure handling.
- `src/lib/server/clarity-pilot.ts`: server-only pilot config and current-account eligibility.
- `src/components/analytics/TeacherClarityBoundary.tsx`: thin lifecycle integration using
  those modules; no policy/business logic embedded in the presentation layer.

- [ ] Require production pilot enabled AND authoritative Microsoft eligibility AND
  server-resolved current classroom owner relationship AND eligible adult participant
  AND valid explicit Pika opt-in AND approved current document/screen. Unknown/error
  means no script request.
- [ ] Separate account role from adult participation; start with a maintainer-managed
  server-only participant allowlist. Do not expose that list, emails, or raw IDs to Clarity.
- [ ] Scope preferences to current account and disclosure version. Proposed pilot default:
  separate server-validated, signed HttpOnly consent cookie; no auth-cookie modification,
  no cross-device consent promise. Confirm expiry, withdrawal and audit requirements first.
- [ ] If endpoints are needed, use `withErrorHandler`, feature-owned Zod schemas,
  existing auth/origin protections and private/no-store responses. Return minimal state.
- [ ] No script requests, preconnect, vendor queue, or replay buffer before eligibility
  and Pika consent. No global `identify` calls; default vendor IDs are still pseudonymous.
  If approved, send Consent V2 with `ad_Storage: "denied"`; grant analytics storage only
  inside the already-approved Pika boundary. Vendor denial/default still collects
  cookieless interactions and is not the application's opt-out mechanism.
- [ ] Loader is idempotent under Strict Mode, route transitions and repeated consent actions.
- [ ] Stop/reset before account/surface change; propagate local withdrawal across tabs.
  Require fresh eligibility on foreground return. Expired policy leases fail closed.
- [ ] Specify a measurable kill-switch revocation bound for already-open tabs, and test
  it; a build-time environment flag alone is not immediate remote shutdown. Document
  background timer/network limitations, in-flight requests, and already-uploaded data.
- [ ] Add `.env.example` placeholders and deployment notes, not real keys/participants.
  Runtime config, allowed domains, script CSP and release settings must fail closed.

**Gate:** unit/API tests show denied states never load or queue vendor collection;
normal application operations succeed when analytics is disabled, blocked, or unavailable.

### P2 — Participation UI and safe surfaces

- [ ] Use the Pika UI-change skill to select a native disclosure/settings reference.
  Keep the opt-in accessible, optional, equally easy to decline, and available to withdraw.
- [ ] State what is collected, purpose, Microsoft involvement, retention limitations,
  and that declining does not affect teaching. No claim of anonymity or no sharing.
- [ ] Default-mask generated text and inputs; selectively allow reviewed static labels.
  Verify content, media, attribute, link and URL exposure; text masking alone is insufficient.
- [ ] Gate all mounted content, including portals and retained inactive tabs. Do not load
  on gradebook/roster/daily/student-work/test/preview/auth screens in the initial scope.
- [ ] Sanitize or exclude unsafe navigation metadata using supported capabilities proven
  in P0. If raw IDs/referrers cannot be prevented, do not enable that surface.
- [ ] Recheck client-side navigation, hard reload, deep links, refresh, back/forward,
  bfcache restoration, logout, account switching and consent withdrawal before rendering
  excluded content. Preserve autosave and unsaved editor state through those transitions.

**Gate:** synthetic sensitive sentinel strings never appear in inspected uploads/replays;
no excluded page begins recording during transitions, even briefly.

### P3 — Minimal teacher signal catalogue

Proposed event names are deliberately stable and independent of button copy:

| Event | Emit only when |
| --- | --- |
| `teacher_assignment_editor_opened` | An approved, opted-in authoring workflow opens; once per editor-open instance |
| `teacher_assignment_draft_initialized` | Automatic create-mode placeholder POST returns a valid response; never interpret as intentional completion |
| `teacher_assignment_post_succeeded` | A Post operation successfully makes the assignment live, not merely a click |
| `teacher_assignment_schedule_succeeded` | A successful response confirms the future schedule; not publication now |
| `teacher_assignment_draft_kept` | An explicit keep/save-draft-and-close action succeeds; not automatic initialization or each autosave |
| `teacher_assignment_validation_failed_<category>` | One finite, allowlisted event name identifies a coarse validation category that blocks an attempted operation |
| `teacher_assignment_<intent>_failed_<category>` | One finite, allowlisted event name identifies sanitized intent and failure category; no raw exception/server response |

Reserve Clarity custom tags for session-stable, finite values such as the approved
workflow/surface, `workflow_version`, release version, and adult-teacher pilot audience.
Do not use tags for mutable intent or error context: Microsoft's current
[client API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-api)
and [custom-tag guidance](https://learn.microsoft.com/en-us/clarity/filters/custom-tags)
describe session-scoped tags where repeated values can accumulate, with no documented
overwrite/remove operation. Encode per-action intent and coarse error category in a
small, typed allowlist of event names instead. Validate every tag and event against
fixed enums and length bounds. No user/class/assignment IDs, titles, content,
times/deadlines, join codes or query strings.

- [ ] Put semantic hooks at existing success/error paths in `AssignmentModal` and
  `useAssignmentScheduling`; use the central adapter, never raw vendor calls throughout UI.
- [ ] Deduplicate callback/remount repetitions without suppressing legitimate repeat actions.
- [ ] Do not emit success after failed autosave, stale response, cancelled operation or role change.
- [ ] No backend forwarding from unconsented or excluded workflows; analytics are not an audit log.
- [ ] Create pilot Clarity segments/filters and the creation-to-Post funnel; separate
  Schedule and Draft branches. Basic navigation uses native signals before adding events.

**Gate:** synthetic replay traces match known successful/failed operations. Do not label
multiple editor visits as unique assignments or promise cross-session conversion without
an approved linkage design. Report captured-session outcomes and coverage limitations.

### P4 — Verification and release evidence

| Scenario | Required result |
| --- | --- |
| Guest, classroom member/student, nonparticipant, unknown adult eligibility, global teacher without current owner admission, no consent, stale policy | No vendor loading/collection |
| Eligible teacher, valid consent, approved document | Useful capture with only allowed content |
| Decline/withdraw, account or role change, session expiry | Collection stops under proven lifecycle contract; no identity leakage |
| Safe editor -> gradebook/roster/test/preview/auth, including back/forward | No excluded DOM or navigation data reaches vendor |
| Slow load A -> switch account/surface B -> A resolves | Stale eligibility cannot enable capture for B |
| Retained tabs/portals, uploaded content, long names, URLs, error strings | Sentinel privacy checks pass across text and non-text channels |
| Ad blocker, offline, vendor failure, duplicate initialization | Teaching actions unaffected; no unbounded retries/buffer |
| Post/Schedule/Draft/validation/autosave failure | Correct distinct events, no false success or duplicate counts |
| Remote disable with multiple open tabs | Documented revocation bound passes; no silent collection on resume |
| Desktop/mobile, light/dark; teacher/student regression | Pika visual matrix and representative workflow tests pass |

Extend relevant existing tests such as `tests/hooks/useAssignmentScheduling.test.ts`,
`tests/components/AppShell.test.tsx` and classroom tests; add policy/adapter/consent and
browser privacy tests. Mock vendor calls by default. Real synthetic capture verification
requires an approved isolated test project; do not contact Clarity in ordinary tests.

Before publication: full startup verification, affected tests, architecture checks,
Pika audit, required visual verification, and `pnpm check:focused -- --base origin/main`.
Use the required draft-first PR, risk-matched independent review, stable reviewed SHA,
and final `PR Gate`. Do not merge or enable production without the normal authority gate.

### P5 — Bounded production pilot and decision

- [ ] Named owner signs off P0–P4 and authorizes separate production enablement.
- [ ] Enable a small adult-teacher cohort on approved screens; verify first-session
  behavior and collect no student sessions. Do not activate PostHog in this release.
- [ ] Review weekly for a provisional two-to-four-week period, extending for low volume.
  Build an issue list with observed behavior, affected captured sessions, severity,
  reproduction, alternative explanations and candidate fix. Do not expose recordings
  beyond approved reviewers or automatically attach them to public issues.
- [ ] Fix one or two issues with normal UI review. Compare workflow versions and like
  cohorts; report denominators, capture/consent bias and uncertainty. No invented targets.
- [ ] Decide expand, narrow, stop, or add PostHog for a demonstrated measurement gap.

Stop immediately for suspected sensitive-data leakage, student capture, invalid consent,
unsafe transitions, or interference with teaching. Use the tested server-side disable
path and open-tab revocation procedure; retain a compatible app rollback. Follow the
incident process and approved project-deletion decision for already-collected data.
Deletion is irreversible and not implied by general rollout permission.

## Suggested delivery slices

1. P0 feasibility evidence and final consent/lifecycle decisions — no production capture.
2. P1 dormant policy/adapter/tests — no visible collection and no activation.
3. P2–P4 consent UI, approved authoring surface, minimal events and complete verification —
   off by default until all gates pass; do not ship a partial privacy boundary enabled.
4. P5 separately authorized pilot, review, and targeted workflow improvements.

## Outstanding decisions / handoff

- Microsoft eligibility response to the exact prepared inquiry and privacy/legal reviewer.
- Exact adult-teacher cohort, eligible screens, participation expiry and evidence requirements.
- Tested lifecycle/isolation mechanism and whether an isolated authoring route is necessary.
- Consent cookie vs approved durable preference/audit store; no schema work presumed.
- Disclosure destination, recording access, vendor retention/deletion acceptance.
- Test/production project setup, deployment domain/header settings, revocation bound and owner.

Next action: approve this implementation scope, then execute P0. Saving this plan is not
evidence that any of its unchecked gates passed. Vendor sources are recorded in the
[proposal](clarity-teacher-workflow-proposal.md#source-notes).
