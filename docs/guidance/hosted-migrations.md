# Manual hosted migrations

The **Manual migration rollout** Actions workflow lets the owner preview and apply reviewed,
merged migration files from a browser at school. It runs only on human `workflow_dispatch`,
using trusted tooling from `main`. Preview is the default. It never enables automatic migrations,
changes billing, seeds, resets, repairs migration history, or runs SQL pasted into a console.

Repository migration authorization remains authoritative: an AI needs a direct, one-time instruction
in its current task naming the target and exact migrations, plus acknowledgement of destructive or
irreversible effects. Setup is not blanket approval. A human apply dispatch is approval for that
single attempt and exact source, target, digest and migration set. An AI must not dispatch apply
without that separate permission. Permission expires after the first application attempt, even if it
fails. See [the schema rollout checklist](./schema-rollout-checklist.md).

## One-time owner setup

After this workflow is reviewed and merged into `main`, create two GitHub Actions environments:
`migrations-staging` and `migrations-production`. These are separate from Vercel environments.
Set each environment's deployment branch policy to **selected branches and tags**, with exactly
one allowed **branch** rule: `main` (no tag rule or wildcard). This server-enforced restriction is
required before storing credentials: a branch can edit its own workflow YAML and bypass a YAML
`if` guard. Add required reviewers when the repository plan supports them. GitHub Team supports
private environment secrets and branch restrictions; required reviewers are unavailable for private
Team repositories, so the workflow does not rely on them. The script also rejects branch execution.
In **each** environment configure:

| Setting | Value |
| --- | --- |
| Variable `ROLLOUT_TARGET` | `staging` or `production`, matching the environment |
| Variable `SUPABASE_PROJECT_REF` | Exact 20-letter project reference for that target |
| Secret `SUPABASE_ACCESS_TOKEN` | CLI management token authorized for that project, with the narrowest practical project/organization access |
| Secret `SUPABASE_DB_PASSWORD` | That project's database password |

Keep credentials scoped to these environments, rather than repository-wide. Verify the project
reference against the intended Supabase Dashboard project before saving it. GitHub's read-only token
reads repository contents and CI evidence; it does not provide database access. Supabase CLI linking
must produce the same environment-bound project reference before any database history is read.
Do not put credentials into workflow inputs, source, SQL, output, or approval messages.

The workflow uses Ubuntu, Node 24 and pinned Supabase CLI 2.103.0. It installs no app dependencies and
starts no Docker database. Existing successful CI provides migration replay and test evidence.
For a public repository, standard GitHub-hosted runners are free. Private repositories use the
account's shared included Actions minutes and any configured spending policy. GitHub environment
protection availability depends on repository visibility and plan. Check the current plan before
changing visibility or enabling paid usage. No billing change is part of this setup.

A preview should usually take roughly 1–3 minutes; an apply often roughly 1–5 minutes, depending on
connection time and the SQL. These are estimates, not measured guarantees. The job has a 10-minute
ceiling and individual CLI calls have a 90-second limit. Long migrations need separately reviewed
execution planning; a timeout can leave a committed prefix, so never automatically retry.

## Preview, review, approve once

1. Merge the reviewed SQL into `main` (or `production`). Copy its **full 40-character commit SHA**.
   A production schema rollout may use merged `main` before promoting the app to `production`.
2. Find a successful repository **CI** run that actually ran **Architecture Database Contracts**,
   **Test & Build**, and **PR Gate**. Supply its numeric run ID. Draft/skipped jobs or successful
   docs-only runs are insufficient. The workflow reads historical checkout logs, not today's moving
   PR merge ref, and compares the tested **complete `supabase/` tree** to the candidate. This handles
   squash merges whose SHA differs from the tested synthetic merge SHA. If migrations, config, seeds,
   or other Supabase files differ, get fresh CI evidence. Its CI workflow must also match trusted
   current tooling. Expired/unavailable logs fail closed. Fork runs are refused.
3. Open Actions → **Manual migration rollout** → Run workflow. Select branch **main**, mode
   **preview**, target, source SHA and CI run ID. Leave apply fields empty.
4. Read the summary: target/project, source SHA, pending SQL links, file hashes and digest. Review the
   actual SQL at that SHA for destructive effects, backfills, constraints, application compatibility,
   and required feature-specific checks. A regex cannot classify all SQL safely. Check the database
   target's current operational state and arrange a window with **no external migration writers**.
5. Dispatch a **new** run on **main**, mode **apply**, with the same target, source SHA and CI run ID.
   Copy `approved_digest` and the complete ordered `approved_migrations` list from the preview.
   Copy the exact confirmation `APPLY <target> <full source SHA>` and acknowledgement:
   `I reviewed the SQL and acknowledge all destructive or irreversible effects.`
6. Check for **applied-verified** and the expected applied versions. Run the feature-specific,
   read-only database contract/smoke checks from the approved rollout plan. Migration history proves
   recorded versions, not semantic correctness of data or application behavior.

The digest binds project, target, source SHA, pinned CLI, the trusted runtime configuration hash,
complete Supabase tree, every migration's
hash, full local/remote version history and the entire pending set. Apply recomputes the preview and
checks it again immediately before applying. A different digest, extra/missing pending file, changed
content or history drift requires a fresh preview and fresh approval. It never hides files to apply
an approved subset. Remote history must be an exact applied prefix of the candidate's migration
inventory; divergent history requires separately authorized investigation/repair.

The isolated executable CLI workspace uses a fixed configuration owned by trusted tooling:
project id `pika-migration-rollout`, Postgres major version **17**, migrations enabled with empty
schema paths, and seed disabled. It contains all approved candidate migration files, but no Vault
configuration, role file or seed file. The candidate's tracked regular config file remains part of
the complete Supabase tree checked against CI; it is never loaded into the CLI workspace. Changes
to the runtime configuration or CLI version require review, renewed offline parser/prompt/config
verification and a fresh preview/approval. Postgres upgrades need that explicit tooling update.

Application uses only `supabase db push --linked --yes` on CLI 2.103.0 after the exact approval checks.
`--yes` acknowledges its normal migration-set confirmation; roles and seed flags are absent, so their
confirmation paths cannot run. Other commands have closed stdin and no blanket confirmation flag.
The pinned CLI defaults its normal push prompt to yes even at EOF, so closed stdin alone is not an
approval gate. Do not substitute another CLI version or generalize this confirmation to other
commands. The script checks the installed version and parses expected preview/history formats;
unrecognized output, unexpected command failure or changed tooling requires investigation.

All CLI stdout/stderr and CI logs are captured privately and discarded, including failures. Actions
receives only allowlisted identifiers, hashes, counts and version history. Raw SQL/error output is
never uploaded as an artifact. Investigate failures privately using authorized read-only tools.

## Failure and concurrency

The workflow serializes runs **per target** with cancellation disabled. GitHub may replace an older
pending run when another run is queued; a queued run is not an executed approval. Do not queue batches
of apply requests. This concurrency group coordinates this workflow only. It does not lock home CLI,
other workflows or external operators. The CLI cannot make preview and application atomic against
external writers; keep them excluded during the approval/application window.

An apply rerun (`run_attempt > 1`) is refused. Never use Re-run jobs for an application. On command
failure or timeout, the script attempts one final history read and reports the durable history or
unknown state; it never retries the push. An outer job cancellation may prevent even that final read.
Review durable state privately, resolve the cause, preview again, then obtain a **new one-time
approval** and make a new dispatch. A fresh approval is required even if no versions were committed.
Already applied migration SQL hashes are not available through `migration list`; the digest binds
remote **versions**, and source hashes, rather than claiming to verify historical remote SQL bytes.

## Future home runner

The rollout entrypoint uses Node built-ins, Git and the pinned Supabase CLI; it does not depend on
GitHub-hosted filesystem paths or app dependencies. A future dedicated Linux home Actions runner can
use the same workflow after a separately reviewed switch of `runs-on`. Keep it exclusive to trusted
manual jobs and retain environment credentials/protection, target concurrency, timeout and guards.
Do not run untrusted PR jobs on a credential-bearing home runner.

For direct CLI use, run trusted `main` tooling against a separate clean candidate checkout whose
`origin` is the repository's HTTPS GitHub URL. Fetch authentication uses a process-scoped, read-only
GitHub token header, which is never passed to the Supabase CLI. Supply
`GH_TOKEN`, `GITHUB_REPOSITORY`, the environment-bound credentials/variables above,
`ROLLOUT_SOURCE_DIR`, `ROLLOUT_MODE`, `ROLLOUT_SOURCE_SHA`, `ROLLOUT_CI_RUN_ID`,
`ROLLOUT_BOUND_TARGET`, and the apply fields `ROLLOUT_APPROVED_DIGEST`,
`ROLLOUT_APPROVED_MIGRATIONS`, `ROLLOUT_CONFIRMATION`, `ROLLOUT_IMPACT_ACK` as environment values,
then run `node /absolute/trusted-tooling/scripts/migration-rollout.mjs`. Direct execution has no
Actions concurrency or environment review gate; the owner must provide that operational exclusion
and exact one-time permission. Use a fresh invocation per approval. The temporary private CLI
workspace is removed on normal exit; after a hard runner termination, remove its temporary files
privately before reusing the host.
