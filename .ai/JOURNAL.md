# Pika Project Journal

**Rules:**
- Append-only. Never delete entries.
- Both humans and AI log significant actions.
- Log GitHub PR events as `[GITHUB-EVENT]` (automated).

**Actor types:**
- `[HUMAN]`
- `[AI - <Model Name>]`
- `[GITHUB-EVENT]`

**Entry format:**
```markdown
---
## YYYY-MM-DD HH:MM [ACTOR]
**Goal:** What you intended to do
**Completed:** What actually changed
**Status:** completed / in-progress / blocked
**Artifacts:**
- Issues: #123
- PRs: #456
- Commits: <sha>
- Files: <paths>
**Next:** What should happen next
**Blockers:** Any blockers or open questions
---
```

---
## 2025-12-12 00:00 [AI - GPT-5.2]
**Goal:** Establish AI effectiveness layer for Pika
**Completed:** Added `.ai/` continuity layer, protocol docs, PR journaling workflow, and migrated legacy planning/history docs into durable summaries
**Status:** completed
**Artifacts:**
- Issues: #8
- Files: `.ai/*`, `scripts/*`, `docs/*`, `.github/workflows/*`
**Next:** Use `.ai/START-HERE.md` at the start of every session; track big-epic progress in `.ai/features.json`
**Blockers:** None
---

