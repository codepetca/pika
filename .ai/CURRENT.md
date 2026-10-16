# State — 2026-10-16 UTC

`3b7ae978e`; audit27 accepted: docs/guidance/codebase-audit-remediation-2026-10.md.

Baseline prod `5a3cb8967` Oct11 11:55UTC; #1573 CI38136281882 PASS.
200/401/hidden404; DB001–258 verified38136681044;257/258 once-approved.
Bodies/ACLs PASS; no write canary. Poll5→1, fresh auth.
Braces deferred: docs/core/roadmap.md.

admission/home/page/cutover/billing OFF;
entitlement 181/plan 206 and automatic Free ON; 182–205/image 213 OFF.
Quota OFF; prod env unchanged Oct11.
Access1 exit;2/3 active;4/5 dormant;164/236 closed.
Exits: docs/guidance/classroom-access-and-entitlements-roadmap.md.
1579/1577/1578 dormant merged8e9dabd597/18126e952/a37d03b3a;
CI38204673501/38175680856/38192450117 PASS.
#1580 dormant;1581 draft; Tests fail;Survey/archive pending; holds unchanged.
Survey001–263 component/12RPC metadata,41CPU PASS; full native/app pending.
Redirect PASS; full-app navigation-pending1; no exit. Unsent-read fence reviewfix.
251/252 native/review/CI PASS.
LegacyPATCH preserved; local249+ held.
No exit: docs/guidance/contextual-test-publication.md.

253#1524 OFF (CI37715526569 PASS).
Quota notices: upgrade/tier only; creation-error deferred.

Setup: docs/dev-workflow.md. Worktrees: `$HOME/.codex/worktrees/pika/`, `$HOME/.codex/worktrees/<id>/pika`.
Env: `$HOME/Repos/.env/pika/.env.local` or `.env.example`.
Recorded releases: attendance `teacher_entitlements` smoke 4/4 on 2026-08-28;
individual-student purge ON; other purge/Pal OFF.
