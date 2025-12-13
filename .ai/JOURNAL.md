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

---
## 2025-12-12 11:14 [AI - GPT-5.2]
**Goal:** Apply PR 9 review follow-ups
**Completed:** Fixed docs tree formatting; set PR journal timestamps to America/Toronto
**Status:** completed
**Artifacts:**
- PRs: #9
- Files: `docs/README.md`, `.github/workflows/journal-on-pr.yml`
**Next:** None
**Blockers:** None
---

---
## 2025-12-12 11:14 [AI - GPT-5.2]
**Goal:** Harden PR journaling workflow
**Completed:** Added workflow concurrency + push retry to avoid race failures; configured union merges for `.ai/JOURNAL.md`
**Status:** completed
**Artifacts:**
- PRs: #9
- Files: `.github/workflows/journal-on-pr.yml`, `.gitattributes`
**Next:** None
**Blockers:** None
---

---
## 2025-12-12 17:57 [AI - GPT-5.2]
**Goal:** Preserve pilot MVP direction decisions
**Completed:** Captured current pilot requirements, UX direction, and scope boundaries in durable docs
**Status:** completed
**Artifacts:**
- Files: `docs/core/pilot-mvp.md`
**Next:** Convert open questions into scoped issues and implement Phase 6 (tests/polish) + pilot UX upgrades against staging
**Blockers:** None
---

---
## 2025-12-12 18:36 [AI - GPT-5.2]
**Goal:** Incorporate pilot clarifications
**Completed:** Updated pilot MVP spec with midnight cutoff, roster-restricted enrollment, and summary scheduling expectations
**Status:** completed
**Artifacts:**
- PRs: #10
- Files: `docs/core/pilot-mvp.md`
**Next:** Confirm AI provider/model + nightly schedule time/scope; implement enrollment gating + summary jobs against staging
**Blockers:** None
---

---
## 2025-12-12 21:59 [AI - GPT-5.2]
**Goal:** Lock AI summary decisions
**Completed:** Updated pilot MVP spec to use OpenAI `gpt-5-nano` and run nightly summary batches at 1:00am America/Toronto (changed docs only)
**Status:** completed
**Artifacts:**
- PRs: #10
- Files: `docs/core/pilot-mvp.md`
**Next:** Implement assignment/doc history + summary job scheduling and storage (on-demand + nightly) on staging
**Blockers:** None
---

---
## 2025-12-12 22:07 [AI - GPT-5.2]
**Goal:** Refine AI summary scope
**Completed:** Clarified summaries are for assignments only; nightly batch runs only for submitted docs that changed since last summary
**Status:** completed
**Artifacts:**
- PRs: #10
- Files: `docs/core/pilot-mvp.md`
**Next:** Confirm whether on-demand summaries are allowed for drafts, or only for submitted docs
**Blockers:** None
---

---
## 2025-12-12 22:08 [AI - GPT-5.2]
**Goal:** Update AI model choice
**Completed:** Switched planned assignment summaries model from OpenAI `gpt-5-nano` to OpenAI `gpt-5-mini`
**Status:** completed
**Artifacts:**
- PRs: #10
- Files: `docs/core/pilot-mvp.md`
**Next:** None
## 2025-12-12 18:39 [AI - GPT-5.2]
**Goal:** Enforce Node 22 baseline
**Completed:** Added `.nvmrc`, set `package.json` engines, and updated env verification + docs to require Node 22+
**Status:** completed
**Artifacts:**
- PRs: #11
- Files: `.nvmrc`, `package.json`, `scripts/verify-env.sh`, `README.md`, `docs/core/project-context.md`
**Next:** Ensure Vercel staging/production is configured to use Node 22+
**Blockers:** None
---

---
## 2025-12-12 23:08 [AI - GPT-5.2]
**Goal:** Unblock Vercel deploy
**Completed:** Removed `pnpm-lock.yaml` so Vercel uses npm, aligned Vitest deps so `npm ci` works, and fixed `next build` failures (route export + TS errors) so deployments can succeed
**Status:** completed
**Artifacts:**
- Files: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `.gitignore`, `src/app/api/auth/login/route.ts`, `src/lib/login-lockout.ts`, `src/lib/calendar.ts`, `tests/api/auth/login.test.ts`, `tests/api/setup.ts`, `tsconfig.json`
**Next:** Redeploy on Vercel; set Node version to 22 in Vercel settings to avoid future major auto-upgrades
**Blockers:** None
---
