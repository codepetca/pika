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
## 2025-12-12 22:39 [AI - GPT-5.2]
**Goal:** Adopt Vercel Cron for nightly summaries
**Completed:** Added `vercel.json` cron schedules (05:00/06:00 UTC for 1am Toronto across DST), implemented a protected cron endpoint with `CRON_SECRET`, documented env vars + staging trigger, and added API tests
**Status:** completed
**Artifacts:**
- Files: `vercel.json`, `src/app/api/cron/nightly-assignment-summaries/route.ts`, `tests/api/cron/nightly-assignment-summaries.test.ts`, `.env.example`, `README.md`, `docs/core/project-context.md`, `docs/core/pilot-mvp.md`
**Next:** Implement assignment AI summary generation + “changed since last summary” storage and nightly batch processing
## 2025-12-12 23:08 [AI - GPT-5.2]
**Goal:** Unblock Vercel deploy
**Completed:** Removed `pnpm-lock.yaml` so Vercel uses npm, aligned Vitest deps so `npm ci` works, and fixed `next build` failures (route export + TS errors) so deployments can succeed
**Status:** completed
**Artifacts:**
- Files: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `.gitignore`, `src/app/api/auth/login/route.ts`, `src/lib/login-lockout.ts`, `src/lib/calendar.ts`, `tests/api/auth/login.test.ts`, `tests/api/setup.ts`, `tsconfig.json`
**Next:** Redeploy on Vercel; set Node version to 22 in Vercel settings to avoid future major auto-upgrades
**Blockers:** None
---

## 2025-12-13 10:02 [AI - GPT-5.2]
**Goal:** Fix Vercel `DYNAMIC_SERVER_USAGE` build errors
**Completed:** Forced authenticated GET API routes to render dynamically (`dynamic = 'force-dynamic'`, `revalidate = 0`) so Next.js doesn’t attempt static prerendering on cookie-backed endpoints during build
**Status:** completed
**Artifacts:**
- Files: `src/app/api/auth/me/route.ts`, `src/app/api/student/assignments/route.ts`, `src/app/api/student/classrooms/route.ts`, `src/app/api/student/classrooms/[id]/route.ts`, `src/app/api/student/entries/route.ts`, `src/app/api/assignment-docs/[id]/route.ts`, `src/app/api/teacher/class-days/route.ts`, `src/app/api/teacher/classrooms/route.ts`, `src/app/api/teacher/classrooms/[id]/route.ts`, `src/app/api/teacher/classrooms/[id]/roster/route.ts`, `src/app/api/teacher/attendance/route.ts`, `src/app/api/teacher/export-csv/route.ts`, `src/app/api/teacher/entry/[id]/route.ts`, `src/app/api/teacher/assignments/route.ts`, `src/app/api/teacher/assignments/[id]/route.ts`, `src/app/api/teacher/assignments/[id]/students/[studentId]/route.ts`
**Next:** Redeploy on Vercel and confirm build logs are clean; if you still see an error at runtime, share the exact message + URL so we can fix the actual root cause (often missing `SESSION_SECRET`/Supabase env vars)
**Blockers:** None
---

## 2025-12-13 10:06 [AI - GPT-5.2]
**Goal:** Pin Node to 22.x
**Completed:** Pinned `package.json` `engines.node` to `22.x` and updated env verification + docs to enforce Node 22.x (prevents automatic major upgrades on Vercel)
**Status:** completed
**Artifacts:**
- Files: `package.json`, `scripts/verify-env.sh`, `README.md`, `docs/core/project-context.md`
**Next:** In Vercel Project Settings → General → Node.js Version, set it explicitly to 22 to match `engines`
**Blockers:** None
---

## 2025-12-13 13:38 [AI - GPT-5.2]
**Goal:** Capture daily logs AI summary epic
**Completed:** Added an epic to track teacher-facing 1-line daily log summaries using a cheaper model (OpenAI `gpt-5-nano`), separate from assignment summaries
**Status:** completed
**Artifacts:**
- Files: `.ai/features.json`
**Next:** Implement the classroom shell + Logs view UX first; then add the daily-log summarization pipeline (on-demand + cached)
**Blockers:** None
---

## 2025-12-13 14:45 [AI - GPT-5.2]
**Goal:** Disable repo-managed Vercel cron schedules
**Completed:** Removed `vercel.json` so staging deployments don’t attempt to create cron jobs (cron is configured in the Vercel dashboard for production only)
**Status:** completed
**Artifacts:**
- Files: `README.md`, `docs/core/project-context.md`, `docs/core/pilot-mvp.md`
**Next:** Re-deploy staging; create the two production cron schedules (05:00 and 06:00 UTC) in the Vercel dashboard
**Blockers:** None
---

## 2025-12-13 15:05 [AI - GPT-5.2]
**Goal:** Simplify cron schedule (single UTC time)
**Completed:** Updated docs and cron endpoint window check to assume a single `0 6 * * *` schedule (06:00 UTC); accept 1–2am Toronto for DST tolerance
**Status:** completed
**Artifacts:**
- Files: `README.md`, `docs/core/pilot-mvp.md`, `docs/core/project-context.md`, `src/app/api/cron/nightly-assignment-summaries/route.ts`
**Next:** Configure the single cron schedule in Vercel dashboard; keep staging enabled only while validating, then disable to free cron quota
## 2025-12-13 14:27 [AI - GPT-5.2]
**Goal:** Start classroom shell UX
**Completed:** Added `/classrooms/[id]` role-based tabs, a reusable date navigator, and new teacher daily Attendance + Logs views (with inline expand and expand-all); added `/api/teacher/logs` to power the Logs tab
**Status:** completed
**Artifacts:**
- Files: `src/app/classrooms/[classroomId]/page.tsx`, `src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx`, `src/app/classrooms/[classroomId]/TeacherLogsTab.tsx`, `src/app/classrooms/[classroomId]/StudentTodayTab.tsx`, `src/app/classrooms/[classroomId]/StudentHistoryTab.tsx`, `src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx`, `src/components/DateNavigator.tsx`, `src/app/api/teacher/logs/route.ts`, `src/lib/class-days.ts`, `src/lib/date-string.ts`
**Next:** Move teacher roster/calendar/settings into their tabs and update navigation to prefer the classroom shell over legacy `/teacher/*` and `/student/*` pages
**Blockers:** None
---

## 2025-12-13 15:30 [AI - GPT-5.2]
**Goal:** Fill remaining classroom shell tabs
**Completed:** Implemented teacher `Roster`, `Calendar`, and `Settings` tabs in the classroom shell; updated roster removal to delete classroom-specific student data
**Status:** completed
**Artifacts:**
- Files: `src/app/classrooms/[classroomId]/TeacherRosterTab.tsx`, `src/app/classrooms/[classroomId]/TeacherCalendarTab.tsx`, `src/app/classrooms/[classroomId]/TeacherSettingsTab.tsx`, `src/app/classrooms/[classroomId]/page.tsx`, `src/app/api/teacher/classrooms/[id]/roster/[studentId]/route.ts`, `tests/api/teacher/roster-studentId.test.ts`
**Next:** Merge PR #18 (classroom shell) then merge stacked tabs PR; validate UX on staging with seeded accounts
**Blockers:** PR #18 required checks
---

## 2025-12-13 16:35 [AI - GPT-5.2]
**Goal:** Make classroom shell the primary app
**Completed:** Added `/classrooms` landing that routes users into their most recent classroom (teacher: most recently updated; student: most recently joined); added `/join` entry page; updated auth redirects and nav links to point at `/classrooms`; added teacher classroom switcher + create flow in the shell
**Status:** completed
**Artifacts:**
- Files: `src/app/classrooms/page.tsx`, `src/app/classrooms/teacher-no-classrooms.tsx`, `src/app/join/page.tsx`, `src/app/join/[code]/page.tsx`, `src/app/classrooms/[classroomId]/page.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/create-password/route.ts`, `src/app/api/auth/reset-password/confirm/route.ts`, `src/app/classrooms/layout.tsx`, `src/app/teacher/layout.tsx`, `src/app/student/layout.tsx`, `src/components/CreateClassroomModal.tsx`, `tests/api/auth/login.test.ts`, `tests/api/auth/create-password.test.ts`
**Next:** Merge and validate on staging (login → `/classrooms` → classroom shell) for both teacher and student
**Blockers:** None
---

## 2025-12-13 16:45 [AI - GPT-5.2]
**Goal:** Add dedicated teacher classrooms index
**Completed:** Updated `/classrooms` to show a teacher classrooms list (with create flow) instead of auto-redirecting into the most recent classroom; students still auto-route into their most recent classroom or `/join`
**Status:** completed
**Artifacts:**
- Files: `src/app/classrooms/page.tsx`, `src/app/classrooms/TeacherClassroomsIndex.tsx`
**Next:** Merge and validate teacher flow: login → `/classrooms` list → open/switch classrooms
**Blockers:** None
---

## 2025-12-13 17:10 [AI - GPT-5.2]
**Goal:** Add UI review tools (gallery + snapshots)
**Completed:** Added a staging-enabled `/__ui` gallery (gated by `ENABLE_UI_GALLERY=true`) and a Playwright snapshot runner that captures key screens across two laptop viewports into local artifacts
**Status:** completed
**Artifacts:**
- Files: `src/app/__ui/page.tsx`, `src/app/__ui/UiGallery.tsx`, `e2e/ui-snapshots.spec.ts`, `playwright.config.ts`, `README.md`, `docs/core/tests.md`, `.env.example`
**Next:** Set `ENABLE_UI_GALLERY=true` on staging and run `pnpm run e2e:snapshots` against staging to generate the first snapshot pack
**Blockers:** None
---

## 2025-12-13 18:05 [AI - GPT-5.2]
**Goal:** Roster-restricted enrollment + enrollment toggle
**Completed:** Added a roster allow-list (`classroom_roster`) and `classrooms.allow_enrollment`; updated student join to require roster match + enrollment enabled; updated teacher roster to manage allow-list (no auto-enrollment) with joined indicator; added teacher settings toggle to enable/disable enrollment; improved join page error messaging
**Status:** completed
**Artifacts:**
- Files: `supabase/migrations/009_roster_allowlist_and_enrollment_toggle.sql`, `src/app/api/student/classrooms/join/route.ts`, `src/app/api/teacher/classrooms/[id]/route.ts`, `src/app/api/teacher/classrooms/[id]/roster/route.ts`, `src/app/api/teacher/classrooms/[id]/roster/upload-csv/route.ts`, `src/app/api/teacher/classrooms/[id]/roster/[rosterId]/route.ts`, `src/app/classrooms/[classroomId]/TeacherRosterTab.tsx`, `src/app/classrooms/[classroomId]/TeacherSettingsTab.tsx`, `src/app/join/[code]/page.tsx`, `tests/api/student/classrooms-join.test.ts`, `tests/api/teacher/roster-upload-csv.test.ts`, `tests/api/teacher/roster-rosterId.test.ts`
**Next:** Apply migration `009` to staging/prod and confirm end-to-end: teacher uploads roster → student signs in with roster email → joins by code → teacher sees Joined
**Blockers:** None
---

## 2025-12-14 15:55 [AI - GPT-5.2]
**Goal:** Align dev seeding and roster add with allow-list
**Completed:** Updated `scripts/clear-and-seed.ts` to wipe and populate `classroom_roster` + `student_profiles`; updated `/api/teacher/classrooms/[id]/roster/add` to upsert allow-list rows (no auto-enrollment); updated tests
**Status:** completed
**Artifacts:**
- Files: `scripts/clear-and-seed.ts`, `src/app/api/teacher/classrooms/[id]/roster/add/route.ts`, `tests/api/teacher/roster-add.test.ts`
**Next:** Merge PR and (optional) reseed staging/local to confirm teacher roster shows rows + join indicator
**Blockers:** None
---
