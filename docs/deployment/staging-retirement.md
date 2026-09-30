# Hosted staging retirement

Pika staging is retired. Development uses the local app and local Supabase,
local smoke/database checks, a reviewed PR to `main`, then promotion to
`production`. Do not recreate staging or add a hosted Preview prerequisite.
See the [canonical workflow](../dev-workflow.md#environments-and-release-flow).

## Verification and cleanup — 2026-09-30

- Supabase CLI project inventory contains Pika production and no Pika staging project. The former staging database was already removed.
- The Vercel `pika-staging` project returns project-not-found. The current `pika` project is linked to `codepetca/pika` with production branch `production`, no deploy hooks, and no branch-specific environment overrides.
- GitHub had two empty retired environment records, `Preview – pika-staging` and `Production – pika-staging`; both were removed. Their latest deployment records dated to January 2026. No staging branch or staging repository secret/variable was found.
- The ignored hub `.env.staging` was removed from the checkout and preserved in a private local credential backup. Setup now uses `.env.local`, or an explicitly supplied local Brevo source file; missing credentials fail closed. Mock email remains sufficient for ordinary development.
- Automatic Vercel Git deployments are enabled only for `production`. Local checks and CI validate `main`; they do not require a hosted Preview deployment.
- The attendance HTTP load harness accepts `--stage local` and exact loopback origins only. Production deployed smoke retains its separately authorized exact target and rejects Preview without accessing credentials or services.

## Deprecation requirements

No compatibility window, database migration, data backfill, or feature-flag
sunset is required for the retired environment. Its database and Vercel project
are already gone. Repository guidance, setup defaults, deployment configuration,
and the empty GitHub records were the remaining cleanup.

WorkOS's provider test environment is independently used by local authentication;
do not delete it or change its credentials to retire Pika staging. Archive and
attendance operation-buffer tables and cleanup flags also remain live contracts.
Dated historical records are retained as evidence, not current rollout steps.
