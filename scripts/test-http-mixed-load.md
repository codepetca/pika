# Mixed HTTP rehearsal workload

`test-http-mixed-load.ts` is a workload module, not a standalone load command or evidence of capacity. It requires a caller that provisions and verifies an exclusively owned, disposable local application and database, creates synthetic authenticated sessions and fixtures, binds `dispatch` only to that app, verifies exact attempt and submitted response rows against the returned expectations, and cleans up after all requests settle. A loopback URL alone does not establish ownership. The caller must reject shared/local or hosted targets, verify the app's actual database target before writes and cleanup, and never print cookies, identities, response bodies, or environment credentials. Destroy the entire disposable target after interrupted or uncertain cleanup. No migration is applied by this module.

Each of 2–40 learners starts, reads session status, records one focus event and performs two revision-aware autosaves while a teacher reads results. Optional same-class and separate-class teacher result reads run concurrently. Once all saves and reads settle, submissions are released together, followed by a final teacher read. Summaries contain counts, HTTP status distribution (0 means transport failure), and p50/p95/max request latency; there are no retries. A caller must treat `failed` or any mismatch in final database rows as failure and must verify cleanup. The generated expected response values are fixture data and must not be logged.

## Manual launcher on a pre-provisioned isolated target

The launcher requires the exact separately provisioned, labeled DB and PostgREST target described in [test-contention-load.md](test-contention-load.md), with the current application's full reviewed schema already present. It never creates containers or applies migrations. The existing labels, container IDs, PostgREST image, database URI/network, and exclusive loopback port are verified before database operations. The owner must establish that the target is disposable; do not use a shared local stack or an active task's containers. Set the service-role JWT through the environment, never an argument:

```sh
TEST_LOAD_SERVICE_KEY='<disposable service-role JWT>' pnpm exec tsx scripts/test-http-mixed-launcher.ts '<full DB container ID>' '<full API container ID>' '<owner token>' 30
```

The launcher starts an owned Next dev process from a fresh scratch project with copied configuration, linked source/dependencies, no env files and a minimal explicit environment. Its gateway accepts only local REST paths and forwards to the verified PostgREST loopback port. It inserts synthetic users, password sessions, two Classrooms and three Tests, then runs the workload, checks exact submitted attempts, responses and focus events, and stops the app before checked fixture cleanup. Status and latency aggregates do not contain identities, request bodies, or credentials. Any failure or interruption without the cleanup verification requires disposal of the entire target; no retry on another target. Dev-mode timings are local rehearsal evidence, not production capacity or browser performance.

For an explicitly authorized, separately provisioned Supabase CLI project, run the launcher from the app source worktree, using the launcher's absolute path and exact full IDs:

```sh
TEST_LOAD_SERVICE_KEY='<disposable service-role JWT>' pnpm exec tsx /absolute/path/to/scripts/test-http-mixed-launcher.ts --supabase-project '<project-id>' '<DB full ID>' '<REST full ID>' '<Kong full ID>' '<API port>' 30
```

The project ID must be `pika_test_load_baseline_` or `pika_test_load_candidate_` followed by 15–16 lowercase hexadecimal characters (and the whole project ID at most 40 characters). The CLI mode requires exact project labels and names, one project network, a REST database URI that resolves to the owned DB, and a Kong REST route that resolves to the owned REST container. The Kong API port must be either loopback-only or the CLI's IPv4 and IPv6 wildcard pair on the supplied port; the harness connects exclusively to `127.0.0.1` and forwards `/rest/v1/` unchanged. The CLI's wildcard binding exposes the API on the host's other interfaces while that stack is running; provisioning and network exposure remain the caller's responsibility. The standalone target guard and its fixed port are unchanged. The working directory supplies the application source, so select and independently verify the intended source revision before running.
