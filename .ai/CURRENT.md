# Checkpoint — 2026-10-06 UTC

Source: main `25457e2d1`; 27 audit findings accepted.
[Audit](../docs/guidance/codebase-audit-remediation-2026-10.md).

Production LIVE at pika.codepet.ca since 2026-10-05 06:27UTC; login HTTP200.
App c6f23b4b READY (#1476); CI37268657918 all gates PASS at b5cf85b9.
Hosted: Prod DB 001–248 applied-verified (run37267393757); functions/ACLs/history PASS.
Audit canaries/cleanup/real-account/285-object preservation PASS; WAF restored.
OwnerOct5: live follow-ups waived/closed; braces deferred in
[roadmap](../docs/core/roadmap.md#deferred-maintenance).

admission/home/page/cutover/billing OFF;
entitlement 181/plan 206 and automatic Free ON; 182–205/image 213 OFF.
Settings last verified in prior receipts; no fresh hosted query here for controls.
Access 1 exit recorded; 2/3 active; 4/5 dormant; writers 164/236 closed.
Epic exits: `docs/guidance/classroom-access-and-entitlements-roadmap.md`.
Next: discard251 source-only; #1500 merged5bf3db.
249–251 unapplied. No phase exit.
See `docs/guidance/contextual-test-pristine-discard.md`.

Recorded releases: attendance `teacher_entitlements` smoke 4/4 on 2026-08-28;
individual-student purge ON, other purge/Pal OFF. Historical receipts.

Local → main → production; staging retired. PR Gate requires reviewed SHA.
Worktrees: $HOME/.codex/worktrees/pika/ or $HOME/.codex/worktrees/<id>/pika.
Env: $HOME/Repos/.env/pika/.env.local; collaborators: .env.example.
`docs/dev-workflow.md` defines setup.
