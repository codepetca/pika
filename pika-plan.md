# Pika – Assignments & Online Editor Plan

This document describes how to add **assignments with an online editor** to **Pika**, building on the existing:

- Email + verification code + password **auth**
- **Attendance** check-in (per day, per student, per classroom)
- **Classrooms** with join codes
- GLD2O as the initial course, but future-proofed for multiple courses/classes

You (the AI) should implement this in **Next.js (App Router) + Supabase** (free tier), deployed on **Vercel**.

---

## TL;DR

- Keep existing **auth** and **attendance** as-is.
- Add **Assignments**:
  - Teachers: create assignments (title, description, due date) per classroom.
  - Students: see list of assignments; each opens a simple **autosaving editor**.
  - Students have **Submit / Unsubmit**:
    - `Submit` sets `is_submitted = true` and `submitted_at` timestamp.
    - `Unsubmit` sets `is_submitted = false` but keeps `submitted_at` history row or log (for now, just keep last, we’ll refine later).
  - Work **can be edited after due date**; UI and data should **mark it as late**.
- **Do NOT implement detailed writing history yet.**
  - Design schema so we can add `assignment_doc_events` later.

---

## High-Level Requirements

### Core Entities

We already have:

- `profiles` (or equivalent) for users
- `classrooms` + join code
- `classroom_members`
- `attendance_entries` (or equivalent)

You will add:

1. `assignments`: created by teachers for a classroom  
2. `assignment_docs`: 1 per (student, assignment), stores editor content & submission state  

Later we may add:

- `assignment_doc_events`: per-save history of content & timing

### Teacher Experience

- Teachers log in with existing auth.
- Teachers see **their classrooms**.
- In a classroom, they see:
  - **Assignments tab**:
    - List of assignments (title, due date, number of students started/submitted)
    - “New Assignment” button
  - (Attendance tab already exists / will exist separately)

**New Assignment flow:**

- Fields:
  - Title (short text)
  - Description (multi-line text; supports Markdown-like formatting later)
  - Due date (date or datetime)
- On save:
  - Create row in `assignments`.
  - Option: Do **not** pre-create `assignment_docs` for all students (to save DB churn).
    - Instead, lazily create when a student first opens the assignment.

**Viewing student work:**

- Teacher clicks an assignment:
  - See a table of students:
    - Student name
    - Status: `Not started`, `In progress`, `Submitted (on time)`, `Submitted (late)`
    - Last updated timestamp
  - Clicking a student:
    - Opens a **read-only view** of that `assignment_doc.content`.
    - Later: add grading/feedback fields.

### Student Experience

- Student logs in with existing auth.
- Joins classroom by code (this is already implemented or planned).
- For now assume **exactly one classroom** is active (GLD2O); architecture should support multiple.

**Student classroom home:**

- Section 1: **Today’s attendance check-in**  
  (Already implemented: if no entry for today, show “What did you do today?”; if present, show answer.)

- Section 2: **Assignments list**:
  - Show assignments for that classroom:
    - Title
    - Due date
    - Status:
      - `Not started`: no `assignment_docs` row exists.
      - `In progress`: has `assignment_docs` row, `is_submitted = false`.
      - `Submitted`: `is_submitted = true`, plus label `on time` / `late`.

**Assignment page (student):**

- Shows:
  - Assignment title
  - Description
  - Due date
  - Current status:
    - “Not submitted” / “Submitted on time” / “Submitted late”
- Editor:
  - A simple text editor (`contenteditable` or `<textarea>`) is fine initially.
  - Autosave:
    - Update `assignment_docs.content` every few seconds when content changes.
    - Update `updated_at`.
- Buttons:
  - **Submit**:
    - Sets `is_submitted = true`.
    - Sets `submitted_at = now()`.
  - **Unsubmit**:
    - Sets `is_submitted = false`.
    - Keep `submitted_at` (we can either keep last submission time or set to null; for now set to null and treat re-submit as new submission).
- After due date:
  - Students can still edit & submit.
  - UI clearly shows “Late” if `submitted_at > due_date` (or “Not submitted – late”).

---

## Data Model (Supabase SQL)

### 1. `assignments`

```sql
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title text not null,
  description text not null default '',
  due_at timestamptz not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 2. `assignment_docs`

```sql
create table if not exists public.assignment_docs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  content text not null default '',
  is_submitted boolean not null default false,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);
```

---

## Routing & API

- `/classrooms/[classroomId]` – teacher/student home  
- `/classrooms/[classroomId]/assignments/[assignmentId]` – assignment editor or teacher overview  
- `/api/assignment-docs/[id]/save` – autosave  
- `/api/assignment-docs/[id]/submit` – submit  
- `/api/assignment-docs/[id]/unsubmit` – unsubmit  

---

## Implementation Order

1. Add schema (`assignments`, `assignment_docs`)
2. Add RLS policies based on classroom membership + teacher role
3. Teacher: create & list assignments
4. Student: list assignments with status
5. Student: assignment editor page with autosave + submit/unsubmit
6. Teacher: view student submissions & read-only work
7. Add late logic (due_at vs submitted_at)
8. (Later) add writing history table & UI

---

## Notes

- Keep UI minimal and clean (no verbose subtitles)
- Do not break existing attendance or auth workflows
- Schema supports multiple future courses
