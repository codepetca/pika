# Atomic Assignment Grading Rollout

Migration `087_atomic_assignment_feedback_returns.sql` is the expand phase of a two-release rollout.
It creates the atomic grading and feedback-return RPCs without blocking the direct assignment-document
writes used by the previous application version.

## Expand Release

1. Apply migration 087 while the previous application version is still deployed.
2. Deploy the application version that routes assignment grading, AI grading, repo review, and feedback
   returns through the new RPCs.
3. Drain all previous application instances and verify the atomic assignment database harness and normal
   grading workflows.

Do not install a direct-write guard in this release. Doing so would make migration-first deployment break
the previous application, while application-first deployment would call RPCs that do not exist yet.

## Contract Release

After the expand application is deployed everywhere, create a separately numbered migration that rejects
direct mutations of assignment grading and feedback-return fields. Apply that migration in a later release.
Do not combine the expand and contract migrations into one production migration batch.

Rollback of the expand application leaves migration 087 in place because its RPCs and revision column are
additive. Rollback of the contract release requires restoring the expand application first; do not re-enable
legacy writers while contract-only application instances are active.

## Background Run Progression

The teacher assignment page remains the low-latency progression path while it is open. The Phase 1
Gradex pilot also provides `GET|POST /api/cron/assignment-ai-grading-runs` as a server-owned fallback
so queued or running assignment grading work can progress after the teacher leaves the page.

The endpoint requires the dedicated `ASSIGNMENT_AI_GRADING_WORKER_SECRET` and
`ASSIGNMENT_AI_GRADING_WORKER_ENABLED=true`. Each invocation processes at most one unleased Gradex
run. Native provider runs are excluded. Runs are selected by least-recently-updated order so a
nonterminal Gradex run cannot starve later work. The 120-second database lease exceeds the
60-second route lifetime, preventing a terminated invocation from overlapping its replacement.

`.github/workflows/assignment-ai-grading-worker.yml` invokes the fixed
`https://pika.codepet.ca` endpoint every five minutes when the repository variable
`PIKA_ASSIGNMENT_AI_GRADING_WORKER_ENABLED=true` and repository secret
`PIKA_ASSIGNMENT_AI_GRADING_WORKER_SECRET` are configured. The secret must match the deployment's
dedicated worker secret. Until those values and the server gate are configured, the workflow and
endpoint are inert, and the scheduled job skips before allocating a runner. Once configured, the
five-minute schedule consumes GitHub Actions minutes; provider charges occur only when runnable
Gradex work reaches the provider. Disable the Actions variable after the bounded pilot if another
durable scheduler is not selected. Browser polling remains useful for immediate feedback, but it is
no longer the only available progression mechanism.
