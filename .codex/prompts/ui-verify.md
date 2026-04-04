Visual verification of UI changes using Playwright screenshots.

Takes the page path as $ARGUMENTS (e.g. `classrooms/abc123`).

Steps:
1) Verify dev server is running: `curl -s http://localhost:3000 > /dev/null`
2) Verify auth files exist: `ls .auth/` — need teacher.json and student.json
   If missing: `pnpm e2e:auth`
3) Teacher screenshot (1440x900):
   ```bash
   npx playwright screenshot "http://localhost:3000/$ARGUMENTS" /tmp/pika-teacher.png \
     --load-storage .auth/teacher.json --viewport-size 1440,900
   ```
4) Student screenshot (390x844):
   ```bash
   npx playwright screenshot "http://localhost:3000/$ARGUMENTS" /tmp/pika-student.png \
     --load-storage .auth/student.json --viewport-size 390,844
   ```
5) View screenshots with Read tool, describe what you see, flag any issues.
6) If issues found: fix code and repeat from step 3.
