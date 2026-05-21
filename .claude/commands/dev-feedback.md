Review Pika developer feedback candidates from daily logs and direct Send Feedback submissions, then let me approve, dismiss, or work on numbered requests.

Rules:
- Operate on the current Pika repo/worktree.
- Do not show raw student logs.
- Treat direct Send Feedback descriptions as user-submitted product signals.
- Present candidates as a numbered list and keep the number -> candidate ID mapping in this conversation.
- Never send display numbers to the script; resolve them to stable candidate IDs first.
- Follow normal Pika startup/worktree rules before editing code.
- Do not apply Supabase migrations.

Default list command:
```bash
node scripts/dev-feedback.mjs list --status new --limit 10 --json
```

Actions:
- `approve 2, 4` -> run `node scripts/dev-feedback.mjs approve <id2> <id4>`
- `dismiss 3 duplicate` -> run `node scripts/dev-feedback.mjs dismiss <id3> --reason "duplicate"`
- `show 5` -> run `node scripts/dev-feedback.mjs show <id5> --json`
- `work on 2` -> run `node scripts/dev-feedback.mjs start <id2> --agent claude`, then use the returned task packet as the implementation request.
- After opening a PR, run `node scripts/dev-feedback.mjs pr <id> --url <pull-request-url>`

When listing, show each item with title, refined request, source type, signal count, classroom/date or direct-submission context, confidence, affected area, and suggested agent.
