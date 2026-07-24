# `pika` CLI — probe

A delete-able experiment (branch `cli-probe`): drive Pika's teacher operations
headlessly instead of clicking the UI, so you — or an AI agent — can manage
curriculum as versioned markdown files.

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
pnpm smoke:pika-cli          # auth + markdown round-trip (idempotent)
pnpm smoke:pika-cli --full   # also creates a blueprint + classroom
```

The `pull → push → pull` round-trip is the drift detector: if a route or a
shared contract changes shape, it stops matching and the smoke test fails.

## Curriculum-as-code loop

```bash
pnpm pika test pull <id> --out unit3/quiz.md   # export
$EDITOR unit3/quiz.md                          # edit (you or an agent)
pnpm pika test push <id> unit3/quiz.md          # dry-run: shows what would change
pnpm pika test push <id> unit3/quiz.md --yes    # apply
```

Now the quiz lives in git — diffable, reviewable, reusable. `pull → push → pull`
is a stable round-trip (verified).

## A Pika bug this surfaced (fixed on branch `fix-course-import`)

Importing a course package containing tests failed with
`400 assessments.N: Unrecognized key: "id"`. Root cause: the markdown parsers
attach `id: existingMatch?.id` for row matching, which is `undefined` on a fresh
import, and zod 4 rejects an `undefined`-valued key on the `.strict()` write
schemas. Assignments were already normalized before hitting the schema;
assessments and lesson templates were passed through raw.

Fixed by normalizing all three consistently in `buildCreateBlueprintWritePlan`.
It affected the UI's tar upload too, since `importCourseBlueprintArchive`
delegates to the same function.

**Until that branch merges**, a course directory containing `tests.md` will
still fail against `main`. Omit it as a workaround.

## Scope / known gaps

- **Read-heavy, one write.** Only `test` pull/push so far. Other operations
  (classrooms, assignments, grading) are reachable via the same client but not
  yet wrapped — add them only as you actually reach for them.
- **Push updates an existing test's draft.** Creating a test from scratch
  (title POST → draft PATCH) and publishing a draft are not wrapped yet.
- **Local dev only** by design. No prod targeting, no confirmation guards on
  destructive ops — add both before pointing this anywhere real.
- Files: `scripts/pika-api.ts` (client), `scripts/pika.ts` (commands),
  `pika` alias in `package.json`. Delete those three to remove the probe.
