# Hosted native attendance scan measurement

Status: harness implemented and locally tested; no hosted measurement has been
run by this branch.

## Local signed-adapter evidence

On 2026-08-20, the disposable shared local Supabase stack and local Convex
deployment completed guarded signed-adapter/engine runs at both supported
boundaries. This is local service evidence, not a hosted or browser-endpoint
latency claim:

| Concurrent scans | Confirmed | Throughput | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|---:|
| 30 | 30 | 182.1/s | 91.8 ms | 161.8 ms | 163.9 ms |
| 100 | 100 | 193.1/s | 276.7 ms | 498.8 ms | 513.1 ms |

The local-only runner seeds distinct Pika students, syncs one roster and class
day, resolves each student's opaque principal mapping, opens a Bara session,
sends one signed `student_check_in` with a fresh attempt UUID per student in
parallel, requires every synchronous result to be authoritative, and closes
the session. It rejects non-loopback Supabase or Bara targets and requires the
explicit `LOCAL_ATTENDANCE_LOAD=shared-local-disposable` acknowledgement:

```bash
pnpm attendance:load:local-engine -- --concurrency 30
pnpm attendance:load:local-engine -- --concurrency 100
```

The operator must still load matching local-only credentials and service URLs
into the process. The runner prints aggregate results only.

The local procedure measures Pika's signed-adapter/server-helper path through
the server-to-server Bara call. It bypasses the HTTP route, role/session
middleware, and WorkOS actor resolution, so its timings are engine-path
evidence only. It does not replace the hosted HTTP harness below or a browser
journey check.

## Preconditions

Run this only after all of these are true:

1. The target is an explicitly authorized, isolated Pika Preview deployment.
2. The preview database has the full Pika migration history through migration
   130. There is currently no isolated preview database, so this hosted harness
   remains blocked and must not be pointed at production.
3. Matching Pika and Bara previews pass `attendance:rollout:preflight` and the
   signed roster, schedule, session, event, and reconciliation smoke.
4. A test attendance occurrence is open and allowlisted for the exercise.
5. There are 30–100 distinct test students with valid Pika Preview sessions.
6. The operator has confirmed rate limits and has a rollback contact. Never run
   this harness against production.

## Secret manifest

Create a local JSON file ending in `.attendance-load.json`. That suffix is
gitignored. The file contains exactly one case per concurrent scan:

```json
{
  "cases": [
    {
      "cookie": "<complete Cookie header for test student 1>",
      "entryToken": "<current Pika attendance entry token>"
    }
  ]
}
```

Supply 30–100 entries. Every Cookie header must contain distinct
`pika_session` and `pika-wos-session` values for one authenticated test
student; adding unrelated cookies cannot make a duplicate session valid. The
same current classroom entry token may be reused. Do not commit, upload, paste,
or log the manifest. Restrict it before use:

```bash
chmod 600 /absolute/path/pika-preview.attendance-load.json
```

The harness rejects group/world-accessible manifests, malformed tokens,
duplicate session strings, a case count outside 30–100, or a concurrency value
that differs from the number of cases.

## Run

Start at 30, then ramp to the explicitly approved higher count. Each ramp needs
a manifest with exactly that many distinct sessions.

```bash
pnpm attendance:load:scans -- \
  --stage preview \
  --manifest /absolute/path/pika-preview.attendance-load.json \
  --base-url https://exact-pika-preview.example \
  --expected-origin https://exact-pika-preview.example \
  --concurrency 30
```

An optional `--timeout-ms` accepts 1,000–60,000 milliseconds and defaults to
15,000. The base URL and separately supplied expected origin must be identical
HTTPS origins without paths, credentials, queries, or fragments. The tool
refuses every stage except `preview`.

Output is aggregate-only: attempted, confirmed, rejected, transport failures,
state counts, duration, requests per second, and min/p50/p95/p99/max latency.
Cookies, entry tokens, response bodies, identities, classroom references, and
target configuration are never printed. `checked_in` and
`already_checked_in` are authoritative confirmations. Any rejection,
transport failure, or contract-invalid response makes the command fail.

Retain only the aggregate JSON and deployment/commit identifiers in the pilot
evidence. Destroy the secret manifest and revoke the test sessions when the
exercise ends.
