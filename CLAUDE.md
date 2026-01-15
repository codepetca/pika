# CLAUDE.md

**Start here:** Read [`.ai/START-HERE.md`](.ai/START-HERE.md) before doing anything.

This file exists so AI tools (Claude Code, Codex, Cursor, etc.) auto-load the session protocol. All instructions live in `.ai/START-HERE.md` and `docs/ai-instructions.md`.

## UI/UX Changes: MUST Verify Visually (MANDATORY)

**After ANY UI/UX change, you MUST:**

1. Take a screenshot and visually verify the change
2. Check BOTH teacher AND student views (if applicable)
3. Iterate on aesthetics/styling until it looks good

```bash
# 1. Ensure dev server is running
pnpm dev

# 2. Refresh auth if needed (uses teacher@example.com / student1@example.com)
pnpm e2e:auth

# 3. Take screenshot as teacher
npx playwright screenshot http://localhost:3000/classrooms /tmp/teacher-view.png \
  --load-storage .auth/teacher.json --viewport-size 1440,900

# 4. Take screenshot as student
npx playwright screenshot http://localhost:3000/classrooms /tmp/student-view.png \
  --load-storage .auth/student.json --viewport-size 1440,900

# 5. View the screenshot (use Read tool on the image file)
```

**Iterate until satisfied:** If something looks off, fix the code and take another screenshot.

See: `docs/guides/ai-ui-testing.md` for detailed usage.

## E2E Commands

```bash
pnpm e2e:auth                        # Generate auth states
pnpm e2e:verify <scenario>           # Run verification script
pnpm e2e:snapshots                   # Run visual snapshot tests
```
