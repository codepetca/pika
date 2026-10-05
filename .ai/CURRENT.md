# Checkpoint — 2026-10-05 UTC

Source: main `5708750d`; 27 audit findings accepted; #1469/#1473 dormant.
[Audit plan and receipts](../docs/guidance/codebase-audit-remediation-2026-10.md).

Production LIVE at pika.codepet.ca since 2026-10-05 06:27UTC; login HTTP200.
App c6f23b4b READY (#1476); CI37268657918 all gates PASS at b5cf85b9.
DB001–248 applied-verified (run37267393757); seven exact functions/ACLs,
complete history, twelve controls unchanged. Forward248 uses PT409/API409.
Canary conflict2.47s, grade/Return/disclosure/idempotence PASS; exact synthetic
Test/storage/provider/Classroom/users cleaned, real accounts preserved.
WAF baseline restored; unrelated285 objects/digest unchanged. See session log.

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
