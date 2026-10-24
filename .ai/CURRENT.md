# Checkpoint — 2026-10-25 (America/Toronto)

RepoLight integration in progress on codex/repolight-integration (task01a15c49).
Source-only293 and canonical client prepared; native replay/types, fullarchive/provider
lifecycle adoption and UI/API verification pending. Analyze OFF. No293 applied to
sharedlocal/production; existing rollout controls below unchanged.
[Contract](../docs/integrations/repolight.md).

Audit27 `3b7ae978e` accepted.
[Audit](../docs/guidance/codebase-audit-remediation-2026-10.md).

Prod `6eacd7540`; #1683 CI40160892306 PASS (Oct25).
Home/admission ON: 3 test accounts; page flags absent; expansion held.
Signed-in create/join/Teaching/Joined/hide/outsider UI PASS.
DB001–292; [receipt/gates](../docs/guidance/classroom-home-pilot-receipt-2026-10-24.md).
282 audit:47 bodies/ACLs,775 grants,281 RLS/constraints PASS;decommission DB ON.
Poll5→1; fresh auth.
Braces: [roadmap](../docs/core/roadmap.md#deferred-maintenance).

Broader cutover/billing held.
entitlement 181/plan 206 and automatic Free ON; 182–205/image 213 OFF.
Controls unchanged: Pal membership/signals OFF; live calls held.
Access incomplete; deployed classwork/API/replay and expansion remain.
Exits: `docs/guidance/classroom-access-and-entitlements-roadmap.md`.
Owner259–262 installed/dormant; Tests adopter1580 prepared.
251/252 native/review/CI PASS.
LegacyPATCH; local001–292 applied Oct23; flags unchanged.
No exit; `docs/guidance/contextual-test-publication.md`.

253#1524 OFF (CI37715526569 PASS).
Quota notices: upgrade/tier only; creation-error deferred.
Batch2 open.

Worktrees: $HOME/.codex/worktrees/pika/; $HOME/.codex/worktrees/<id>/pika.
Env: $HOME/Repos/.env/pika/.env.local; .env.example.
Recorded releases: attendance `teacher_entitlements` smoke 4/4 on 2026-08-28;
individual-student/removed cleanup ON (provider/live/automatic/academic); Pal OFF.
