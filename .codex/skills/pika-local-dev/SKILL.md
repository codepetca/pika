---
name: pika-local-dev
description: Launch the Pika development server with a generated session secret and credentials from the running local Supabase stack. Use when the user asks to start, launch, or run Pika locally; do not use for hosted deployments or production runtime configuration.
---

# Pika Local Dev

Use the bundled launcher instead of running `pnpm dev` directly:

```bash
bash .codex/skills/pika-local-dev/scripts/start.sh <pika-worktree>
```

Pass the Pika worktree relevant to the current task. Do not launch from the Pika
hub checkout when a dedicated worktree is in use. If the current directory is
the hub and task context does not identify a worktree, resolve the intended
registered worktree before launching.

The launcher intentionally:

- reads local credentials from `supabase status`, never from hosted Supabase;
- accepts both current publishable/secret keys and legacy anon/service-role keys;
- rejects a Supabase API URL unless it is loopback HTTP;
- clears inherited Git repository-selection variables, then requires the target
  to be an exact registered worktree of the same Pika repository as this skill
  before passing it credentials;
- supplies `NEXT_PUBLIC_SUPABASE_URL`, the publishable key, and the secret key
  only to the dev-server process;
- generates a new 64-character `SESSION_SECRET` for that process;
- disables shell tracing before reading or generating sensitive values;
- never prints, persists, or commits those values;
- stops with a clear message if the local Supabase stack is unavailable.

Wait until Next.js reports `Ready`, verify `/login` returns HTTP 200, then report
the local URL. Keep the server session running. Use `--check` to validate the
launcher without starting another server:

```bash
bash .codex/skills/pika-local-dev/scripts/start.sh --check <pika-worktree>
```
