Visual verification of UI changes using Playwright screenshots.

Takes the page path as $ARGUMENTS (e.g. `classrooms/abc123`).

Steps:
1) Verify dev server: `curl -s http://localhost:3000 > /dev/null`
2) Verify auth: `ls "$PIKA_WORKTREE/.auth/"` — need teacher.json, student.json
3) Teacher screenshot (1440x900):
   `npx playwright screenshot "http://localhost:3000/$ARGUMENTS" /tmp/pika-teacher.png --load-storage "$PIKA_WORKTREE/.auth/teacher.json" --viewport-size 1440,900`
4) Student screenshot (390x844):
   `npx playwright screenshot "http://localhost:3000/$ARGUMENTS" /tmp/pika-student.png --load-storage "$PIKA_WORKTREE/.auth/student.json" --viewport-size 390,844`
5) View screenshots, describe what you see, flag any issues.
6) If issues found: fix code and repeat.

Alternatively:
```bash
bash "$PIKA_WORKTREE/.codex/skills/pika-ui-verify/scripts/ui_verify.sh" "$ARGUMENTS"
```
