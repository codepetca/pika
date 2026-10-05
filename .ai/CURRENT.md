# Checkpoint — 2026-10-05 UTC

Source: main `5708750d`; 27 audit findings accepted; #1469/#1473 dormant.
[Audit plan and receipts](../docs/guidance/codebase-audit-remediation-2026-10.md).

Hosted: Prod DB 001–248 applied-verified in run37267393757; seven exact function
body/security/owner/ACL checks PASS, history complete, twelve controls unchanged.
Application83b683c READY; public traffic held by operator-only WAF.
Forward248 fixes hosted custom40001 retry loops with PT409 and dual-code API409.
CI37264085316: all gates PASS. Details in the session log.
Release branch reconciles production history; app/SQL unchanged.
Matching deployment, canaries, cleanup and traffic release pending.
Owner task-wide instruction waives further approval requests.

Fresh post-apply controls match pre-apply: admission/home/page/cutover/billing OFF;
entitlement 181/plan 206 and automatic Free ON; 182–205/image 213 OFF.
Access 1 exit recorded; 2/3 active; 4/5 dormant; writers 164/236 closed.
Epic exits: `docs/guidance/classroom-access-and-entitlements-roadmap.md`.

Recorded releases: attendance `teacher_entitlements` smoke 4/4 on 2026-08-28;
individual-student purge ON, other purge/Pal OFF. Historical receipts.

Flow: local → main → production; staging retired. PR Gate requires the reviewed SHA.
Worktrees: $HOME/.codex/worktrees/pika/ or $HOME/.codex/worktrees/<id>/pika.
Env: $HOME/Repos/.env/pika/.env.local; collaborators: .env.example.
`docs/dev-workflow.md` defines setup.
