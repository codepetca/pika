Visual verification of UI changes using Playwright screenshots.

Takes the page path as $ARGUMENTS (e.g. `classrooms/abc123`).

This command operates on the bound worktree (`$PIKA_WORKTREE`).

Rules:
- Verify `$PIKA_WORKTREE` is set before running any commands.
- Requires dev server running at `localhost:3000`.
- Must capture BOTH teacher and student views when applicable.
- You MUST look at the screenshots and provide visual feedback.

Steps:

1) Ensure dev server is running
   - Check: `curl -s http://localhost:3000/api/auth/me > /dev/null && echo ok || echo not running`
   - If not running: `pnpm -C "$PIKA_WORKTREE" dev &` and wait 5s.

2) Ensure auth states exist
   - Check: `ls "$PIKA_WORKTREE/.auth/"` for teacher.json and student.json.
   - If missing: `pnpm -C "$PIKA_WORKTREE" e2e:auth`

3) Take screenshots for BOTH roles
   - Teacher view:
     ```bash
     npx playwright screenshot "http://localhost:3000/$ARGUMENTS" \
       /tmp/pika-teacher.png \
       --load-storage "$PIKA_WORKTREE/.auth/teacher.json" \
       --viewport-size 1440,900
     ```
   - Student view:
     ```bash
     npx playwright screenshot "http://localhost:3000/$ARGUMENTS" \
       /tmp/pika-student.png \
       --load-storage "$PIKA_WORKTREE/.auth/student.json" \
       --viewport-size 390,844
     ```
   - Mobile teacher (if responsive):
     ```bash
     npx playwright screenshot "http://localhost:3000/$ARGUMENTS" \
       /tmp/pika-teacher-mobile.png \
       --load-storage "$PIKA_WORKTREE/.auth/teacher.json" \
       --viewport-size 390,844
     ```

4) View and evaluate screenshots
   - Read each screenshot using the Read tool: `/tmp/pika-teacher.png`, `/tmp/pika-student.png`
   - Check for:
     - Layout integrity (no overflow, no broken flex/grid)
     - Dark mode rendering (if applicable)
     - Text legibility
     - Interactive elements accessible
     - No console errors in network tab
   - Report what you see — be specific about any issues.

5) Iterate if needed
   - If issues found: fix the code and repeat from step 3.
   - Report "Visual verification passed" only when everything looks correct.

See `docs/guides/ai-ui-testing.md` for detailed patterns.
