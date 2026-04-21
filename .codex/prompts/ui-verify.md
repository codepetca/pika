Visually verify UI changes for the page path in `$ARGUMENTS`.

Use the repo guide for expectations: `docs/guides/ai-ui-testing.md`.

Preferred path:
```bash
bash "$PIKA_WORKTREE/.codex/skills/pika-ui-verify/scripts/ui_verify.sh" "$ARGUMENTS"
```

After screenshots are captured:
1. Review the teacher and student views.
2. Check layout, spacing, typography, responsiveness, and missing states.
3. If anything looks off, fix the code and repeat the verification.
