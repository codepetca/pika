# `pika` — teacher CLI

Drive Pika's teacher operations headlessly instead of clicking the UI, so you —
or an AI agent — can manage curriculum as versioned markdown files.

**No server changes.** The CLI is a second consumer of the existing role-gated
API routes. It logs in via the same `POST /api/auth/login` the browser uses,
persists the `pika_session` cookie to `.auth/pika-cli.json` (gitignored), and
rides the shared `src/lib/test-markdown` contract the editor already uses.

## Setup

1. Start the dev server (local Supabase must be up): `pnpm dev`
2. Log in as the seeded teacher: `pnpm pika login`

   - Defaults to `teacher@example.com` / `test1234` (local seed). Override with
     `--email` / `--password`, or `PIKA_EMAIL` / `PIKA_PASSWORD`.
   - Target another host with `PIKA_BASE_URL=...` (defaults to `localhost:3000`).

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
| `pnpm pika course list` | List course blueprints. |
| `pnpm pika course pull <blueprintId> <dir>` | Export a blueprint to an editable directory (manifest.json + markdown). |
| `pnpm pika course push <dir> [--replace \| --new] [--yes]` | Import a course directory as a blueprint. |
| `pnpm pika course instantiate <id> --title <name> --semester semester1 --year 2026 [--yes]` | Turn a blueprint into a real classroom. |

## Creating a whole course

A course is a directory: `manifest.json` plus up to six markdown files
(`course-overview.md`, `course-outline.md`, `resources.md`, `assignments.md`,
`tests.md`, `lesson-plans.md` — all optional). See
`scripts/fixtures/dummy-course/` for a working example an agent can copy.

```bash
pnpm pika course push scripts/fixtures/dummy-course            # dry run
pnpm pika course push scripts/fixtures/dummy-course --yes      # → blueprint
pnpm pika course instantiate <blueprintId> --title "CS 101" \
  --semester semester1 --year 2026 --yes                       # → classroom
```

### Editing an existing course (round-trip)

```bash
pnpm pika course pull <blueprintId> course/            # export to markdown
$EDITOR course/assignments.md course/tests.md          # edit
pnpm pika course push course/ --replace --yes          # delete + recreate
```

`course push` refuses by default when a blueprint with the same course code (or
title) already exists, so repeated pushes don't silently pile up duplicates.
Pass `--replace` to delete and recreate it, or `--new` to create a duplicate on
purpose. Replacing a blueprint does not touch classrooms already instantiated
from it — those are independent copies.

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

## Scope / known gaps

- **Not everything is wrapped.** Tests and courses have commands; classrooms,
  assignments, and grading are reachable through the same client but unwrapped —
  add them as you actually reach for them.
- **`test push` updates an existing test's draft.** Creating a test from
  scratch and publishing a draft are not wrapped yet.
- **`course push --replace` deletes and recreates** the blueprint rather than
  diffing it. Classrooms already instantiated from it are unaffected.
- **Local dev by default.** `PIKA_BASE_URL` can point elsewhere, but there are
  no extra confirmation guards for production — add them before doing so.
- Files: `scripts/pika.ts` (commands), `scripts/pika-api.ts` (client),
  `scripts/pika-global.sh` (launcher), `scripts/pika-cli-smoke.ts` (tests),
  `scripts/fixtures/dummy-course/`, and the `pika` / `smoke:pika-cli` scripts in
  `package.json`.
