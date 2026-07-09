# Contributing to Pika

Thanks for helping out! This doc covers the workflow for invited collaborators.

## Permission to contribute

Pika is source-visible but not open source (see [LICENSE](./LICENSE)). By
inviting you as a collaborator, the maintainer grants you permission to run,
modify, and contribute to Pika **for the purpose of contributing to this
repository**. By submitting a contribution you agree it becomes part of Pika
under the LICENSE. This does not grant rights to use, host, or distribute
Pika elsewhere.

## Local setup

Follow the [README Getting Started](./README.md#getting-started). In short:

1. Node 24 + `corepack enable` + `pnpm install`
2. Create **your own** Supabase database (free cloud project or `supabase start`)
3. Apply migrations with `supabase db push` (never by hand — there are ~80)
4. `cp .env.example .env.local` and fill in the required values
5. `pnpm dev`

You do **not** need Vercel, Brevo, or an OpenAI key for normal development.
Never commit `.env*` files or real credentials.

## Workflow: everything goes through a PR

`main` and `production` are protected. Direct pushes are blocked; every change
lands via a pull request that requires:

1. **A passing CI run** (`Test & Build`: tests, typecheck, lint, build)
2. **An approving review from the maintainer** (@armorup, enforced via CODEOWNERS)

Steps:

```bash
git checkout -b <short-descriptive-branch> origin/main
# ...make changes...
pnpm test && npx tsc --noEmit && pnpm lint
git push -u origin <branch>
gh pr create --base main
```

- Keep PRs small and focused — one concern per PR.
- `main` uses squash or rebase merges (linear history); the PR title becomes
  the commit message, so write it well.
- The `production` branch is a deploy target promoted from `main` by the
  maintainer — don't target it directly.

## Working with AI agents

The repo ships AI-agent instructions (`CLAUDE.md`, `.ai/START-HERE.md`,
`AGENTS.md`). Some conventions there (worktree layout under `$HOME/Repos/pika`,
a shared `.env.local` symlink) describe the **maintainer's** machine — a plain
clone with your own `.env.local` is fine. If your agent session appends to
`.ai/SESSION-LOG.md`, expect occasional merge conflicts there; resolve by
keeping both entries.

## Questions

Open a GitHub issue or leave a comment on your PR.
