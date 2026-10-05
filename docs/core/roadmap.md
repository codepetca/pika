# Implementation Roadmap

Phase-based tracking for **Pika**.

---

## Current status and phase authority

Use [the epic inventory](../../.ai/features.json) for pass/fail status and
[the dated checkpoint](../../.ai/CURRENT.md) for source/local/hosted evidence.
A passed capability does not establish current production rollout controls;
a failing epic may contain already-shipped slices.

Active access/onboarding/monetization gates are in
[Classroom access and entitlements](../guidance/classroom-access-and-entitlements-roadmap.md).
Attendance pilot gates are in [Native attendance](../integrations/pika-bara-native-attendance-roadmap.md).
Gradebook work is tracked separately from the implemented gradebook surface in
the epic inventory and [Student Grades](../guidance/student-grades.md).

Assignments already support editor history through
`src/app/api/assignment-docs/[id]/history/route.ts`; see [Architecture](architecture.md).
Do not reopen completed MVP work from the historical checklist below.

---

## Fluid classroom experience

Active coordinator goal: [audit, Daily pilot and phased continuity work](../guidance/ui/fluid-classroom-plan.md).
The first slice preserves Daily's table identity and valid same-date selection;
experimental motion needs human acceptance before broader promotion/adoption.

---

## Historical MVP phases (completed by 2025-12-14)

The inventory records Phases 0–6 as passed. This is the original MVP scope,
not the current implementation or release checklist. Ongoing security, testing
and documentation improvements retain their own task-specific checks.

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

### Phase 6 — Tests & Polish ✅ (historical epic exit)
- Coverage thresholds and stability recorded by `epic-tests-polish`
- Security review and documentation polish in the original MVP scope
- Continued changes still require current risk-matched tests and review

---

## Separately gated future work

- Plan-independent archived-classroom retention: advance notices, verified cold storage,
  and a separately gated eventual deletion policy. This is proposed future work, not
  enabled behavior; see the [classroom lifecycle roadmap](../guidance/classroom-lifecycle-archives.md#future-archived-classroom-retention-proposal-not-enabled).

## Deferred maintenance

- [ ] **DEP-01 — `braces` dependency advisory (GHSA-vfj7-8cjw-p6xm).** Deferred
  by Stewart Chan on 2026-10-05; leave the current dependency/toolchain in place.
  Retain the depth mitigation and visible advisory. The existing temporary
  exception review date remains **2026-11-04 (America/Toronto)**. When revisiting,
  check for an official fixed release or compatible parent-tool updates, then
  verify glob/watch/lint and styling compatibility. No automatic task is scheduled.
  See [dependency security evidence](../guidance/dependency-security-2026-10.md)
  and [the audit disposition](../guidance/codebase-audit-remediation-2026-10.md#owner-follow-up-disposition--2026-10-05).

---

## Deployment

- Target: Vercel + Supabase
- Steps: local app/DB checks → reviewed `main` PR → protected `production`
  promotion; Vercel deploys `production`. Production migrations/canaries require
  exact-target authorization. See the [canonical flow](../dev-workflow.md#environments-and-release-flow).
- Email setup: see [Brevo setup](../deployment/BREVO-SETUP.md); mock sending is a local development option.
