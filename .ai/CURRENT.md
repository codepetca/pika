# Checkpoint — 2026-10-05 UTC

Source: main `7570a9d6`; 27 audit source findings accepted, #1462/#1463 merged.
#1469 dormant reads merged on main; excluded from production; rollout OFF.
[Audit plan and receipts](../docs/guidance/codebase-audit-remediation-2026-10.md).

Hosted: Prod DB 001–246 applied and verified in run 37252303894;
matching application 83b683c READY. Public traffic held by operator-only WAF.
Auth/reset and two synthetic signed downloads PASS. Reopened Return caused
custom 40001 retries; three exact canary backends stopped, work unreturned.
Forward 247 is prepared, unreviewed/unapplied; exact new permission required.
Lifecycle canaries, fixture cleanup and traffic release remain pending.

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
