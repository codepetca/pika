# `pika` — teacher CLI

Drive Pika's teacher operations headlessly instead of clicking the UI, so you —
or an AI agent — can manage curriculum as versioned markdown files.

The CLI predates browser-based WorkOS Magic Auth and currently uses the legacy
`POST /api/auth/login` route. That route is unavailable by default and must be
enabled explicitly for a local CLI session. The CLI persists the resulting
`pika_session` cookie to `.auth/pika-cli.json` (gitignored) and rides the shared
`src/lib/test-markdown` contract the editor already uses.

## Setup

1. Start the dev server with the local-only password override (local Supabase must be up):
   `PIKA_LEGACY_PASSWORD_AUTH=true pnpm dev`
2. Log in as the seeded teacher: `pnpm pika login`

   - Defaults to `teacher@example.com` / `test1234` (local seed). Override with
     `--email` / `--password`, or `PIKA_EMAIL` / `PIKA_PASSWORD`.
   - Target another host with `PIKA_BASE_URL=...` (defaults to `localhost:3000`).
   - Do not enable the password override on a shared or hosted environment just
     to use the CLI. A WorkOS-compatible CLI login is future work.

## Running it globally (optional)

`pnpm pika …` works from any checkout. To get a bare `pika` on PATH, keep a
checkout on `main` and symlink the launcher:

```bash
git clone https://github.com/codepetca/pika.git ~/.pika-cli
cd ~/.pika-cli && pnpm install
ln -sf ~/.pika-cli/scripts/pika-global.sh ~/bin/pika
```

Update it later with `git -C ~/.pika-cli pull`. Override the location with
`PIKA_CLI_HOME`. The launcher runs the CLI from that checkout while resolving
paths you type against your current directory, so `pika test pull <id> --out
quiz.md` writes `quiz.md` where you are, not inside the checkout.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm pika login` | Authenticate; save session cookie. |
| `pnpm pika whoami` | Show the logged-in user (verifies the saved session). |
| `pnpm pika test pull <testId> [--out f.md]` | Export a test to markdown (stdout or file). |
| `pnpm pika test push <testId> <f.md> [--yes]` | Parse markdown → replace the test's draft. **Dry-run without `--yes`.** |
| `pnpm pika classroom list [--archived]` | List active classrooms, or archived ones. |
| `pnpm pika classroom archive <id> [--yes]` | Archive a classroom: hidden from your list, student access blocked. Reversible. |
| `pnpm pika classroom restore <id> [--yes]` | Unarchive a classroom. |
| `pnpm pika blueprint list` | List course blueprints. |
| `pnpm pika blueprint delete <id> [--yes]` | Delete a blueprint. Permanent; classrooms made from it are unaffected. |
| `pnpm pika blueprint pull <blueprintId> <dir>` | Export a blueprint to an editable directory (manifest.json + markdown). |
| `pnpm pika blueprint push <dir> [--new] [--yes]` | Import a new Blueprint or submit an identity-aware change proposal. |
| `pnpm pika blueprint proposals <blueprintId>` | List reviewable proposals. |
| `pnpm pika blueprint apply <blueprintId> <proposalId> [--yes]` | Explicitly apply a reviewed, non-stale proposal. |
| `pnpm pika blueprint instantiate <id> --title <name> --semester semester1 --year 2026 [--yes]` | Turn a blueprint into a real classroom. |

## Creating a whole course

A course is a directory: `manifest.json` plus up to eight markdown files
(`course-overview.md`, `course-outline.md`, `resources.md`, `assignments.md`,
`tests.md`, `lesson-plans.md`, `classwork-materials.md`, `surveys.md` — all
optional). See
`scripts/fixtures/dummy-course/` for a working example an agent can copy.

```bash
pnpm pika blueprint push scripts/fixtures/dummy-course            # dry run
pnpm pika blueprint push scripts/fixtures/dummy-course --yes      # → blueprint
pnpm pika blueprint instantiate <blueprintId> --title "CS 101" \
  --semester semester1 --year 2026 --yes                       # → classroom
```

### Editing an existing course (round-trip)

```bash
pnpm pika blueprint pull <blueprintId> course/            # export to markdown
$EDITOR course/assignments.md course/tests.md          # edit
pnpm pika blueprint push course/ --yes                    # submit proposal
```

When the pulled package identifies an existing Blueprint, push submits a
reviewable proposal. Pika rejects stale package revisions and never deletes the
existing Blueprint. Pass `--new` only to create an independent copy.

## Testing

```bash
pnpm smoke:pika-cli                 # auth + markdown round-trip (idempotent)
pnpm smoke:pika-cli --full          # also imports a course and instantiates it
pnpm smoke:pika-cli --full --keep   # same, but leave the artifacts for inspection
```

The `pull → push → pull` round-trip is the drift detector: if a route or a
shared contract changes shape, it stops matching and the smoke test fails.

`--full` removes the blueprint and classroom it creates, even if an assertion
fails partway through, so repeated runs don't pile up duplicates. The blueprint
goes through the API; the classroom is deleted directly, since classrooms have
no DELETE route by design and every foreign key into them cascades. That
teardown needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`, which
`.env.local` already provides.

## Curriculum-as-code loop

```bash
pnpm pika test pull <id> --out unit3/quiz.md   # export
$EDITOR unit3/quiz.md                          # edit (you or an agent)
pnpm pika test push <id> unit3/quiz.md          # dry-run: shows what would change
pnpm pika test push <id> unit3/quiz.md --yes    # apply
```

Now the quiz lives in git — diffable, reviewable, reusable. `pull → push → pull`
is a stable round-trip (verified).

## A Pika bug this surfaced

Using the CLI turned up a real defect: importing a course package containing
tests failed with `400 assessments.N: Unrecognized key: "id"`, through both this
CLI and the UI's tar upload. Fixed in
[#932](https://github.com/codepetca/pika/pull/932); `pnpm smoke:pika-cli --full`
now guards it.

## Two different nouns

`blueprint` and `classroom` are distinct things, and the commands do not cross
over:

| Noun | What it is | How it is removed |
| --- | --- | --- |
| `blueprint` | The reusable **template** — what `blueprint push` creates | `blueprint delete`, permanent |
| `classroom` | The **live class** with students, created by `blueprint instantiate` | `classroom archive`, reversible |

Deleting a blueprint never deletes a classroom. Classrooms are independent
copies; the foreign key is `ON DELETE SET NULL`, so they keep every assignment,
test and submission and only lose the link back to the template.

## Removing a classroom

There is no delete: classrooms hold student work, so the product exposes
archiving instead. `classroom archive` flips `archived_at` on the classroom —
it disappears from your list and students lose access — and `classroom restore`
undoes it. That is the practical way to retire a classroom created by mistake,
including in production.

```bash
pika classroom archive <id>          # dry run
pika classroom archive <id> --yes    # apply; prints the restore command
pika classroom list --archived       # find it again
pika classroom restore <id> --yes    # undo
```

Not to be confused with `POST /classrooms/{id}/archives`, the cold-storage
export with checksummed copies and retention policy. That is a separate,
feature-gated operation (`CLASSROOM_ARCHIVE_EXPORT_ENABLED` plus a per-teacher
allowlist) and is not what these commands use.

## Scope / known gaps

- **Not everything is wrapped.** Tests and courses have commands; classrooms,
  assignments, and grading are reachable through the same client but unwrapped —
  add them as you actually reach for them.
- **`test push` updates an existing test's draft.** Creating a test from
  scratch and publishing a draft are not wrapped yet.
- **`course push` proposes changes** to an existing Blueprint. Applying is a
  separate explicit action and preserves stable artifact lineage.
- **Local dev by default.** `PIKA_BASE_URL` can point elsewhere, but there are
  no extra confirmation guards for production — add them before doing so.
- Files: `scripts/pika.ts` (commands), `scripts/pika-api.ts` (client),
  `scripts/pika-global.sh` (launcher), `scripts/pika-cli-smoke.ts` (tests),
  `scripts/fixtures/dummy-course/`, and the `pika` / `smoke:pika-cli` scripts in
  `package.json`.
