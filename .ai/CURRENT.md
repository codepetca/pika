# Checkpoint — 2026-10-11 UTC

Release `3b7ae978e`; audit27 accepted.
[Audit](../docs/guidance/codebase-audit-remediation-2026-10.md).

Prod `5a3cb8967` LIVE Oct11 11:55UTC; #1573 CI38136281882 PASS.
Login200/anonymous401/hiddenfixtures404; savings unknown.
Prod DB001–258 verified(run38136681044); owner approved257/258 once.
Four bodies/ACLs PASS; no write canary.
Poll reads5→1; fresh auth; admission absent.
Prior audit/WAF PASS.
Braces: [roadmap](../docs/core/roadmap.md#deferred-maintenance).

admission/home/page/cutover/billing OFF;
entitlement 181/plan 206 and automatic Free ON; 182–205/image 213 OFF.
Controls unchanged: quota OFF; production env key names unchanged Oct11.
Access 1 exit recorded; 2/3 active; 4/5 dormant; writers 164/236 closed.
Exits: `docs/guidance/classroom-access-and-entitlements-roadmap.md`.
1555/1561/1566 merged/dormant; CI38133165213 PASS.
1569 merged `2cea88dc1`/dormant; CI38150651417 PASS.
Next: owner recovery; unpublish/Test delete open.
251/252 native/review/CI PASS.
LegacyPATCH/UI unchanged; local249+ held.
No exit; `docs/guidance/contextual-test-publication.md`.

253#1524 OFF (CI37715526569 PASS).
Quota notices: upgrade/tier only; creation-error deferred.
Batch2 open; roadmap records prior deliveries.

Worktrees: $HOME/.codex/worktrees/pika/; $HOME/.codex/worktrees/<id>/pika.
Env: $HOME/Repos/.env/pika/.env.local; .env.example.
Recorded releases: attendance `teacher_entitlements` smoke 4/4 on 2026-08-28;
individual-student purge ON; other purge/Pal OFF.
