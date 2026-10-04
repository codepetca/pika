# Checkpoint — 2026-10-04

Source: main `902cbf76`; PRs #1460/#1461/#1468 merged. Migration 243 local
application/types/replay/revocation receipts remain in `.ai/SESSION-LOG.md`.
#1461 proof receipts: 29 SDK cases, two forced teardowns/cleanup and baseline;
see [integrated proof](../docs/guidance/contextual-assignment-learner-integrated-proof.md).
No fresh DB query; #1468 proofs recorded.
Authorized 27-finding effort: [remediation plan](../docs/guidance/codebase-audit-remediation-2026-10.md).

Hosted: Prod DB 001–225 (last verified); no fresh hosted query here. Recorded
controls: admission/home/page/cutover/billing OFF; entitlement 181 and plan 206
with automatic Free ON; 182–205 and image 213 OFF. Reverify before rollout.

Access phases: 1 (compatibility adapters) exit recorded; 2 (contextual backend/UI)
and 3 (onboarding pilot) source work active; 4 (paid) and 5 (cleanup) dormant.
Grouped writers 164/236 closed. Exit gates remain in
`docs/guidance/classroom-access-and-entitlements-roadmap.md`.

Recorded releases: attendance `teacher_entitlements` smoke 4/4 on 2026-08-28;
individual-student purge ON, other purge controls/Pal OFF. These are receipts,
not current settings verification. CI: `PR Gate` on the reviewed SHA and the
conditional Browser Experience Matrix; see `docs/dev-workflow.md`.

Flow: local → main → production; staging retired.
Worktrees: $HOME/.codex/worktrees/pika/ or $HOME/.codex/worktrees/<id>/pika.
Env: $HOME/Repos/.env/pika/.env.local; collaborators: .env.example.
