# Implementation Roadmap

Phase-based tracking for **Pika**.

---

## Current Status

✅ All MVP phases complete. Quizzes, tests, drag-reorder classrooms, and full test coverage are live.
Active work tracked in `.ai/features.json` (authoritative) and GitHub issues.

---

## Implementation Phases

### Phase 0 — Setup ✅
- Initialize Next.js + TypeScript
- Tailwind CSS configured
- Supabase client wiring
- Env templates created

### Phase 1 — Auth ✅
- Email verification codes (signup/reset) + password hashing
- Login with lockout
- Session utilities (iron-session)
- `/auth/*` pages for signup, verify, create-password, login, reset

### Phase 2 — Student Experience ✅
- `/classrooms/[id]?tab=today` - Daily journal form with mood tracking
- `/student/history` - Cross-classroom attendance history
- Student entries API with Toronto timezone handling

### Phase 3 — Teacher Dashboard ✅
- Attendance matrix + entry detail modal
- CSV export
- Class days management

### Phase 4 — Classrooms & Rosters ✅
- Classroom CRUD + join codes/links
- Student join by code
- Roster CSV upload + enrollment checks
- Class days per classroom

### Phase 5 — Assignments ✅ (core)
- Assignment creation per classroom
- Student editor with autosave, submit/unsubmit
- Teacher read-only view + submission stats

### Phase 6 — Tests & Polish ✅
- Coverage thresholds enforced per-file in `vitest.config.ts`
- 175+ test files, 1540+ tests
- Security hardening and documentation cleanup complete

---

## Future Features

- Production-ready email delivery
- Late status display and richer attendance analytics
- Regional holiday configuration
- Notifications (missed entries, due dates)
- Editor history/versioning (for assignments)

---

## Deployment

- Target: Vercel + Supabase
- Steps: apply migrations, configure env vars, deploy on push to `main`
- Email: mock in dev; wire provider before production
