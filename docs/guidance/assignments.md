# Feature Guidance: Assignments & Online Editor

This document consolidates feature specifications for the **Assignments** and **Online Editor** system. These will be broken into GitHub issues for AI agent implementation.

---

## Overview

Add assignment functionality to **Pika**, building on the existing auth, attendance, and classroom infrastructure.

**Core Features**:
- Teachers create assignments (title, description, due date) per classroom
- Students work on assignments in an autosaving online editor
- Students can submit/unsubmit work
- Late detection based on due date vs submission time
- Teachers view all student work in read-only mode

**Future Extension** (not part of current scope):
- Detailed writing history tracking (`assignment_doc_events` table)

---

## Data Model

### 1. `assignments` table

```sql
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title text not null,
  description text not null default '',
  due_at timestamptz not null,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- One row per assignment
- Each assignment belongs to exactly one classroom (owned by a teacher user)

### 2. `assignment_docs` table

```sql
create table if not exists public.assignment_docs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  content text not null default '',
  is_submitted boolean not null default false,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);
```

- One row per (assignment, student) pair
- Stores current content and submission state
- Lazily created when student first opens assignment

### 3. Future: `assignment_doc_events` (DO NOT IMPLEMENT YET)

```sql
-- For future detailed history (NOT part of this phase):
-- create table public.assignment_doc_events (
--   id bigserial primary key,
--   assignment_doc_id uuid not null references public.assignment_docs (id) on delete cascade,
--   student_id uuid not null references public.profiles (id),
--   created_at timestamptz not null default now(),
--   event_type text not null, -- 'autosave' | 'manual_save' | 'submit' | 'unsubmit'
--   content text not null,
--   char_count int not null
-- );
```

---

## RLS & Security

Add Row Level Security policies:

**Teachers** of a classroom:
- Can create assignments for their classroom
- Can view all assignments and student `assignment_docs` within that classroom

**Students**:
- Can view assignments for classrooms they are members of
- Can read and write **only their own** `assignment_docs`

App uses the service role client in API routes and enforces ownership/enrollment checks before DB access; RLS remains defense-in-depth.

---

## UI & Routing

### 1. Classroom Home (`/classrooms/[classroomId]`)

**For Students**:
- Show existing attendance check-in
- Add **Assignments list** section:
  - Title, due date, status badge for each assignment
  - Status: `Not started`, `In progress`, `Submitted (on time)`, `Submitted (late)`

**For Teachers**:
- Add **Assignments** section
- "New Assignment" button
- List of assignments with title, due date, and stats (X/Y submitted)

### 2. New Assignment (Teacher)

Within classroom page or nested route:
- Form: title (required), description (multi-line), due date (required)
- Server action to create assignment
- Validate teacher role
- Do NOT pre-create `assignment_docs` for all students

### 3. Student Assignment Editor (`/classrooms/[classroomId]/assignments/[assignmentId]`)

**Display**:
- Assignment title, description, due date
- Current status badge

**Editor**:
- Simple `<textarea>` or `contentEditable` div
- Autosave: debounce 1-2 seconds after last keystroke
- "Saving..." / "Saved" indicator
- Persist via `/api/assignment-docs/[id]` (PATCH) using service role on server

**Actions**:
- **Submit button**: Sets `is_submitted = true`, `submitted_at = now()`
- **Unsubmit button**: Sets `is_submitted = false`, `submitted_at = null`

**Late Logic**:
- Students can edit after due date
- UI clearly shows "Late" if submitted after due date

### 4. Teacher Assignment Detail (`/classrooms/[classroomId]/assignments/[assignmentId]`)

**Display**:
- Assignment metadata (title, due date, description)
- Table of all students in classroom:
  - Student name
  - Status: `Not started`, `In progress`, `Submitted (on time)`, `Submitted (late)`
  - Last updated timestamp

**Click student**:
- Opens read-only view of that student's content
- Shows submission status and timestamp

---

## Late Detection Logic

Helper: `calculateAssignmentStatus` in `src/lib/assignments.ts`

- No `assignment_docs` row → `not_started`
- `is_submitted = false` AND `now <= due_at` → `in_progress`
- `is_submitted = false` AND `now > due_at` → `in_progress_late`
- `is_submitted = true` AND `submitted_at <= due_at` → `submitted_on_time`
- `is_submitted = true` AND `submitted_at > due_at` → `submitted_late`

---

## Implementation Order

Follow this sequence:

1. **DB & RLS**
   - Add `assignments` and `assignment_docs` tables
   - Add RLS policies for teachers and students
   - Ensure existing auth and attendance remain working

2. **Teacher: List & Create Assignments**
   - Fetch and display assignments on classroom page
   - "New Assignment" button + form
   - Server action to insert into `assignments`

3. **Student: Assignments List**
   - Fetch assignments for classroom
   - Join/query `assignment_docs` for current student
   - Compute and display status

4. **Student: Assignment Editor**
   - Server component: fetch assignment and student's doc
   - Client component: editor with autosave
   - Submit/unsubmit actions via API routes

5. **Teacher: Assignment Detail & Student Work**
   - List all students and their statuses
   - Read-only view of student content

6. **Polish & Late Logic**
   - Ensure late/on-time logic is correctly wired
   - Visual status badges

7. **DO NOT Implement History**
   - No `assignment_doc_events` table or history tracking yet
   - Design touchpoints (autosave endpoints) for easy future extension

---

## Style Guidelines

- Keep UI **clean and minimal**
- Use short labels, avoid verbose text
- Simple, readable code over abstraction
- Add comments for non-trivial logic (late calculation, role checks)

---

## Expected Outcome

After implementation:

**Teachers**:
- Create assignments with due dates
- See all assignments for a classroom
- See which students have started/submitted each assignment
- View student work in read-only mode

**Students**:
- See daily attendance check-in (existing)
- See list of assignments with status
- Open assignment, type in editor, autosave
- Submit/unsubmit work
- Edit work even after due date (status reflects lateness)

All while keeping existing auth and attendance intact.
