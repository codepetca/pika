# Pika — Issue Worker Protocol

Use this protocol whenever instructed to work on a GitHub issue.

## 1) Fetch the Issue
```bash
gh issue view <number> --json number,title,body,labels,comments
```

## 2) Load Context (MANDATORY)
1. Read `.ai/START-HERE.md`
2. Read `docs/ai-instructions.md` and follow its required reading order.
3. Check `.ai/features.json` for any referenced feature IDs.

## 3) Branch & PR Setup
- Branch name pattern: `<issue-number>-<short-slug>` (example: `8-ai-effectiveness-layer`)
- If a matching branch already exists, use it.
- Prefer creating a **Draft PR** early; include `Closes #<number>` in the body.

## 4) Plan Before Coding (MANDATORY)
Produce a short plan:
- Files to change/add
- Approach and edge cases
- Testing plan (`npm test` + targeted tests)

Do not proceed until the user approves the plan.

## 5) Execute With Constraints
- Keep changes small and focused.
- Use TDD for core logic (`docs/core/tests.md`).
- Preserve security patterns (sessions, role checks, Supabase usage).
- Keep business logic out of UI components.
- Do not add dependencies without explicit approval.

## 6) AI UI Verification (Recommended)

After implementing UI changes, verify them visually:

```bash
# 1. Ensure dev server is running
pnpm dev

# 2. Refresh auth states if needed
pnpm e2e:auth

# 3. Take screenshots
npx playwright screenshot http://localhost:3000/<page> /tmp/screenshot.png \
  --load-storage .auth/teacher.json --viewport-size 1440,900

# 4. View screenshot with Read tool, iterate if needed

# 5. Optionally run verification scripts
pnpm e2e:verify <scenario>
```

This step is recommended but not blocking. Use it when:
- Implementing new UI features
- Fixing visual bugs
- Changing user flows

See `docs/guides/ai-ui-testing.md` for detailed patterns.

## 7) Update AI Continuity Layer
Before ending a session:
- Append to `.ai/JOURNAL.md` (append-only).
- Update `.ai/features.json` if feature status changed:
  ```bash
  node scripts/features.mjs pass <feature-id>
  node scripts/features.mjs fail <feature-id>
  ```

## 8) Validation
- Run: `npm test`
- If relevant: `npm run lint`, `npm run build`
- Confirm acceptance criteria are met and documented in the PR.
- If you grep for path conventions, exclude `.ai/JOURNAL.md` (append-only).
  Example: `rg -n "\\$HOME/repos/|/Users/stew/" --glob "!**/.ai/JOURNAL.md" docs/ .ai/ scripts/`
