Visually verify UI changes for the page path in `$ARGUMENTS`.

Use the repo guide for expectations: `docs/guides/ai-ui-testing.md`.

Playwright is the required final verification path. Chrome plugin/browser-profile checks may be used only as supplemental exploratory debugging and do not replace Playwright screenshots or verification scripts.

Preferred path:
```bash
bash .codex/skills/pika-ui-verify/scripts/ui_verify.sh "$ARGUMENTS"
```

After screenshots are captured:
1. Review the teacher and student views, or explicitly record why one role is not applicable.
2. Check desktop and mobile coverage.
3. Check light and dark mode when the surface supports both.
4. Check the relevant visual states: default, hover, focus, open, selected, loading, empty, drag, or edit.
5. Check layout, spacing, typography, responsiveness, and whether the intended primary signal is clear without extra chrome.
6. If anything looks off, fix the code and repeat the verification.
