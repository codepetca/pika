# Pika — AI Agent Starting Ritual

**CRITICAL:** Follow this checklist at the start of **every** AI session.

---

## 1) Verify the Environment (1–2 min)

```bash
bash scripts/verify-env.sh
```

Optional (slower):
```bash
bash scripts/verify-env.sh --full
```

Do not start coding if verification fails.

---

## 2) Recover Context (2–3 min)

```bash
# Read the last few journal entries
tail -80 .ai/JOURNAL.md

# Review recent code changes
git log --oneline -10
git status

# Optional: recent GitHub activity
gh pr list --state closed --limit 5
gh issue list --state closed --limit 5
```

---

## 3) Load Documentation (MANDATORY)

Start with the AI orchestrator and follow its reading order:

1. `docs/ai-instructions.md`
2. `docs/core/architecture.md`
3. `docs/core/design.md`
4. `docs/core/project-context.md`
5. `docs/core/agents.md`
6. `docs/core/tests.md`
7. `docs/core/roadmap.md`

Optional (as needed):
- `docs/core/decision-log.md` (historical rationale)
- `CLAUDE.md` and `AGENTS.md` (tooling/agent guardrails)

Only after this should you inspect or modify source code.

---

## 4) Check Feature Inventory (1 min)

```bash
node scripts/features.mjs summary
node scripts/features.mjs next
```

---

## 5) Identify the Task (1 min)

Priority order:
1. If you’re working a GitHub issue → follow `docs/issue-worker.md`.
2. Otherwise → pick the next failing, unblocked feature in `.ai/features.json`.
3. If nothing is clear → ask the user what to do next.

---

## 6) Plan Before Coding (MANDATORY)

Before writing code:
- State what you think the task is.
- Reference any relevant docs/architecture constraints.
- Propose an implementation plan and a testing plan.
- **Wait for user approval.**

---

## During Work

- Prefer TDD for core logic (see `docs/core/tests.md`).
- Keep UI thin; move business logic into utilities/server actions.
- Do not add dependencies unless explicitly approved.
- Do not commit secrets or `.env.local`.

---

## End of Session (MANDATORY)

1. Append a session entry to `.ai/JOURNAL.md`.
2. Update `.ai/features.json` status if anything changed:
   ```bash
   node scripts/features.mjs pass <feature-id>
   node scripts/features.mjs fail <feature-id>
   ```
3. Commit and push the journal + feature changes.

---

## Document Hierarchy (When Conflicts Arise)

If sources contradict, trust in this order:
1. `.ai/features.json` — what is “done” / what is next (status authority)
2. `docs/core/architecture.md` — architecture and invariants
3. `docs/core/tests.md` — testing requirements
4. `docs/core/design.md` — UI/UX rules
5. `docs/core/project-context.md` — setup and commands
6. `docs/core/roadmap.md` — phase strategy (human-facing)
7. `docs/core/decision-log.md` — historical rationale
8. `.ai/JOURNAL.md` — session history
