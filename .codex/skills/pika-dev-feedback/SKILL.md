---
name: pika-dev-feedback
description: Review and act on Pika developer feedback candidates from daily logs and direct Send Feedback submissions. Use when the user asks to show Pika dev feedback, approve or dismiss numbered requests, rewrite/refocus a request, or work on a feedback candidate.
---

# Pika Dev Feedback

## Purpose

Operate the developer feedback queue for Pika. The queue contains sanitized, AI-refined improvement candidates extracted from daily logs plus direct bug/feature reports submitted through Send Feedback. The user should interact with numbered items, not raw commands.

## Core Workflow

1. Confirm the current repo root with `git rev-parse --show-toplevel`.
2. If the user asks to show/list/review feedback, run:
   ```bash
   node scripts/dev-feedback.mjs list --status new --limit 10 --json
   ```
3. Present candidates as a numbered list starting at 1. Include:
   - short title
   - refined request
   - source type, signal count, classroom count/dates or direct-submission role/page
   - confidence, affected area, suggested agent
4. Keep the displayed mapping in conversation memory:
   - `1 -> candidate.id`
   - `2 -> candidate.id`
   - etc.
5. The user may reply with natural language:
   - `approve 2, 4`
   - `dismiss 3 duplicate`
   - `work on 2`
   - `show 5`
   - `rewrite 2 smaller`
   - `more`

## Commands To Run

- List new candidates:
  ```bash
  node scripts/dev-feedback.mjs list --status new --limit 10 --json
  ```
- Show one candidate:
  ```bash
  node scripts/dev-feedback.mjs show <candidate-id> --json
  ```
- Approve:
  ```bash
  node scripts/dev-feedback.mjs approve <candidate-id> [<candidate-id>...] --note "<optional note>"
  ```
- Dismiss/disapprove:
  ```bash
  node scripts/dev-feedback.mjs dismiss <candidate-id> [<candidate-id>...] --reason "<reason>"
  ```
- Start work and get a task packet:
  ```bash
  node scripts/dev-feedback.mjs start <candidate-id> --agent codex
  ```
- Get a task packet without status changes:
  ```bash
  node scripts/dev-feedback.mjs prompt <candidate-id> --agent codex
  ```
- Mark PR opened:
  ```bash
  node scripts/dev-feedback.mjs pr <candidate-id> --url <pull-request-url>
  ```

## Numbered Reply Handling

Resolve user-provided numbers against the most recent displayed queue. Never send display numbers to the script. Always convert them to stable candidate IDs first.

If the user references a number that was not shown, ask them to list again or clarify.

For `approve 2, 4`, approve both IDs and summarize the status update.

For `dismiss 3 duplicate`, dismiss candidate 3 with reason `duplicate`.

For `work on 2`:
1. Resolve number 2 to its candidate ID.
2. Run `node scripts/dev-feedback.mjs start <id> --agent codex`.
3. Use the returned task packet as the implementation request.
4. Follow Pika startup/worktree rules and present a plan before editing code unless the user has already approved implementation in the current turn.
5. After implementation and PR creation, run the `pr` command to record the PR URL.

## Guardrails

- Do not show raw student logs.
- Direct Send Feedback descriptions are already redacted before storage, but still treat them as user-submitted product signals.
- Treat candidates as product signals, not individual student reports.
- Do not apply Supabase migrations; humans do that.
- For UI changes, run mandatory Pika UI verification.
- If the helper says the migration is missing, tell the user the migration must be applied before the queue can be used.
