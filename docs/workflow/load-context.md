# Load Context Workflow

Use [`.ai/START-HERE.md`](../../.ai/START-HERE.md) and the
[session-start prompt](../../.codex/prompts/session-start.md) for a new session.
Run the startup script from the current feature worktree:

```bash
bash .codex/skills/pika-session-start/scripts/session_start.sh
```

For read-only orientation use `--orient-only`. When unchanged guidance has already
been read in this conversation, `--context-loaded` avoids repeating its text while
retaining fresh checks. See [the canonical workflow](../dev-workflow.md).

Load only the task-specific documents selected by [the AI router](../ai-instructions.md)
after the required startup set. Report the actual task, checkout, risk and next
step using the dated checkpoint in `.ai/CURRENT.md` and status in `.ai/features.json`.

For issue work, inspect the issue and follow [the issue workflow](handle-issue.md).
