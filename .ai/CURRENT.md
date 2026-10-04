# Checkpoint — 2026-10-04

Source: main `24cb8847`; #1460/#1461/#1468/#1462 merged. Audit #1463 combines
remaining reviewed fixes; final integration review/CI pending. See
[remediation plan](../docs/guidance/codebase-audit-remediation-2026-10.md).
Local 243 receipts remain in SESSION-LOG; audit disposable receipts are source-
pinned historical evidence, not new application permission. #1461: 29 SDK cases,
forced teardown/cleanup and baseline; [proof](../docs/guidance/contextual-assignment-learner-integrated-proof.md).

Hosted: Prod DB 001–225 (fresh read-only verification 2026-10-04; exact prefix).
Pending 226–246 require coordinated application/schema and exact-set permission.
Recorded controls: admission/home/page/cutover/billing OFF; entitlement 181/plan 206
and automatic Free ON; 182–205/image 213 OFF. Recorded settings last verified in prior receipts; no fresh hosted query here
for control values.

Access phases: 1 exit recorded; 2/3 active; 4/5 dormant; writers 164/236 closed. Epic exits:
`docs/guidance/classroom-access-and-entitlements-roadmap.md`.
Recorded releases: attendance `teacher_entitlements` smoke 4/4 on 2026-08-28; individual-student purge ON,
other purge/Pal OFF. These are historical receipts. PR Gate requires reviewed SHA; see dev-workflow.

Flow: local → main → production; staging retired.
Worktrees: $HOME/.codex/worktrees/pika/ or $HOME/.codex/worktrees/<id>/pika.
Env: $HOME/Repos/.env/pika/.env.local; collaborators: .env.example.
