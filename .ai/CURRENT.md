# Checkpoint — 2026-10-11 UTC

Release `3b7ae978e`; 27 audit findings accepted.
[Audit](../docs/guidance/codebase-audit-remediation-2026-10.md).

Prod `5a3cb8967` LIVE Oct11 11:55UTC; #1573 CI38136281882 PASS.
Login200/anonymous401/hiddenfixtures404; savings unmeasured.
Prod DB001–258 verified(run38136681044); owner approved257/258 once.
Four new function bodies/ACLs PASS; no write canary.
Poll reads5→1; fresh auth; admission absent.
Prior audit/WAF PASS.
Braces: [roadmap](../docs/core/roadmap.md#deferred-maintenance).

admission/home/page/cutover/billing OFF;
entitlement 181/plan 206 and automatic Free ON; 182–205/image 213 OFF.
Controls unchanged: quota OFF; production env key names unchanged Oct11.
Access 1 exit recorded; 2/3 active; 4/5 dormant; writers 164/236 closed.
Exits: `docs/guidance/classroom-access-and-entitlements-roadmap.md`.
1555/1561/1566 merged; learner dormant; CI38133165213 PASS.
Next: owner grades/return dormant.
251/252 native/review/CI PASS.
LegacyPATCH/UI unchanged; local249+ held.
No exit; `docs/guidance/contextual-test-publication.md`.

253#1524 OFF (CI37715526569 PASS).
Quota notices: upgrade/tier only; creation-error deferred.
1543/1541 delivered;1515/1534 closed; batch2 open.

Worktrees: $HOME/.codex/worktrees/pika/; $HOME/.codex/worktrees/<id>/pika.
Env: $HOME/Repos/.env/pika/.env.local; .env.example.
Recorded releases: attendance `teacher_entitlements` smoke 4/4 on 2026-08-28;
individual-student purge ON; other purge/Pal OFF.
