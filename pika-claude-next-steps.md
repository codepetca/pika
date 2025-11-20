# Claude Implementation Prompt – Pika Assignments & Online Editor

You are an AI coding assistant working on a Next.js + Supabase project called **Pika**.

Pika is an app for an asynchronous online high school course (GLD2O). Students log in with their school board email and:

- Complete a very short **“What did you do today?”** prompt used for attendance.
- Join a **classroom** using a **join code** created by the teacher.
- Work on **assignments** in a simple online editor.

The project is already partially implemented. Your job is to **add the assignments + online editor features**, without breaking existing auth or attendance.

---

## Tech Stack & Constraints

- **Framework:** Next.js (App Router)
- **Deployment:** Vercel
- **Backend/DB/Auth:** Supabase (free tier)
- **Language:** TypeScript
- Keep dependencies minimal; favor built-in Next.js + Supabase tooling.
- UI should be **clean and minimal** (no verbose subtitles or long descriptions in the UI).

---

## Existing Functionality (You Must Preserve)

The app **already has**:

1. **Auth flow**
   - Users sign up/log in using **email + verification code** and then set a password.
   - They use their existing **board email** (e.g., `@yrdsb.ca`).
   - Assume there is a `profiles` or equivalent table linked to `auth.users`.

2. **Classrooms**
   - Teachers can create a **classroom** (e.g., “GLD2O – Winter 2026”).
   - A classroom has a **join code**.
   - Students can join a classroom using this code.
   - There is at least one course (GLD2O) in use; the system should be future-proof to support multiple courses and classrooms.

3. **Attendance**
   - Students see a **“What did you do today?”** prompt.
   - Submitting **any** response for the current date marks them as present.
   - Attendance is tracked per (classroom, student, date).
   - This flow is already implemented and working.

**Important:** Do not change the existing auth or attendance behavior. Integrate assignments alongside them.

---

## New Features to Implement

You must implement:

1. **Assignments**
2. **Assignment editor for students (with autosave, submit/unsubmit)**
3. **Teacher views of assignments and student work**
4. **Late detection (on-time / late)**

Do **NOT** implement detailed per-keystroke history in this phase. However, design the schema so that history can be added later.

---

## Data Model Changes (Supabase)

### 1. `assignments` table

Create (or update) the following table in Supabase:

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

- One row per **assignment**.
- Each assignment belongs to exactly one `classroom`.

### 2. `assignment_docs` table

Create (or update) the following table:

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

- One row per **(assignment, student)** pair.
- Stores the **current content** of the student’s response and their **submission state**.

### 3. Future history table (do NOT implement yet)

Design with this future extension in mind (but do not create or use it yet):

```sql
-- For future detailed history (NOT part of this phase):
-- create table public.assignment_doc_events (
--   id bigserial primary key,
--   assignment_doc_id uuid not null references public.assignment_docs (id) on delete cascade,
--   student_id uuid not null references public.profiles (id),
--   created_at timestamptz not null default now(),
--   event_type text not null, -- 'autosave' | 'manual_save' | 'submit' | 'unsubmit' | ...
--   content text not null,
--   char_count int not null
-- );
```

---

## RLS & Security

You must add or update **Row Level Security (RLS)** policies so that:

- **Teachers** of a classroom:
  - Can create assignments for their classroom.
  - Can view all assignments and student `assignment_docs` within that classroom.
- **Students**:
  - Can view assignments for classrooms they are members of.
  - Can read and write **only their own** `assignment_docs`.

The exact policies depend on existing tables like `classrooms`, `classroom_members`, and `profiles`.  
You should:

1. Identify how the app currently determines:
   - Who is a **teacher** vs **student**
   - Which classrooms a user belongs to
2. Use that logic when writing policies for `assignments` and `assignment_docs`.

If needed, add a `classroom_members` table or extend it with a `role` (`'teacher' | 'student'`).

---

## UI & Routing Requirements (Next.js App Router)

Use the **App Router** structure. Keep components modular and use server components where appropriate.

### 1. Classroom Home

Route: `/classrooms/[classroomId]`

- Determine whether the current user is a **teacher** or **student** in this classroom.
- Render different UI sections depending on role.

#### For Students:

On this page, students should see:

1. **Today's attendance check-in** (existing feature – keep it as is).
2. **Assignments list** (new):

   - For the current classroom, show all assignments.
   - For each assignment:
     - Title
     - Due date
     - Status badge:
       - `Not started`
       - `In progress`
       - `Submitted (on time)`
       - `Submitted (late)`

   - Status calculation logic for the current student:

     - Fetch the assignment.
     - LEFT JOIN (or separate query) on `assignment_docs` for `(assignment_id, student_id)`.

     ```text
     if no assignment_docs row:
       status = "Not started"
     else if is_submitted = false:
       if now() <= due_at: status = "In progress"
       else:                status = "In progress (late)" or similar
     else (is_submitted = true):
       if submitted_at <= due_at: status = "Submitted (on time)"
       else:                      status = "Submitted (late)"
     ```

   - Clicking an assignment sends the student to the **assignment editor page**.

#### For Teachers:

On this page, teachers should see at least:

1. A section for **Assignments** (can be a tab or a distinct panel).
2. A **“New Assignment”** button.
3. A list of assignments for that classroom, each showing:
   - Title
   - Due date
   - Quick stats:
     - `X / Y submitted`
     - `Z late` (optional if easy)

Clicking an assignment sends the teacher to an **assignment detail view**.

---

### 2. New Assignment (Teacher)

Within `/classrooms/[classroomId]` (or a nested route), let teachers:

- Create a new assignment with:
  - Title (required)
  - Description (multi-line text, plain for now)
  - Due date/datetime (required)

Implementation details:

- Use a **server action** or API route to handle the creation.
- Validate:
  - The user is the teacher of that classroom.
- Insert into `assignments`.
- Redirect back to the classroom page or an assignment detail page.

Do **not** pre-create `assignment_docs` for all students; create them lazily when a student first opens the assignment.

---

### 3. Student Assignment Editor

Route: `/classrooms/[classroomId]/assignments/[assignmentId]`

This route must support the **student view** and may also be reused/extended for the teacher view.

For a **student**:

1. Server component:
   - Verify the user is a student in this classroom.
   - Fetch the `assignment` row (title, description, due_at).
   - Fetch the `assignment_docs` row for `(assignment_id, student_id)`:
     - If not found, you can either:
       - Create it immediately, OR
       - Lazily create it on first save in the API route.
   - Compute status (see logic above).
   - Pass necessary props to a **client component** for the editor.

2. Client editor component:
   - Show:
     - Assignment title
     - Due date
     - Description
     - Status badge (e.g., “Not submitted / Submitted on time / Submitted late”)
   - Provide a **simple editor**:
     - For now, a `<textarea>` or `contentEditable` `div` is fine.
   - Implement **autosave**:
     - On change, debounce (e.g., 1–2 seconds after last keystroke).
     - Call a `POST` endpoint or `fetch` to save the latest content.
     - Update a small “Saving…” / “Saved” indicator in the UI.

3. Submit / Unsubmit buttons:
   - **Submit button**:
     - Sets `is_submitted = true`, `submitted_at = now()` in `assignment_docs`.
   - **Unsubmit button**:
     - Sets `is_submitted = false`, `submitted_at = null` (for now).
   - After unsubmit, the student can keep editing and re-submit.

   Implement these via small API routes or server actions. Ensure only the owning student can toggle these flags.

---

### 4. Teacher Assignment Detail & Student Work

Route options (choose something clear):

- `/classrooms/[classroomId]/assignments/[assignmentId]/teacher`
- Or reuse `/classrooms/[classroomId]/assignments/[assignmentId]` and render based on role.

For a **teacher**:

1. Show assignment metadata (title, due date, description).
2. Show a table listing all **students** in the classroom:

   Columns:
   - Student name
   - Status:
     - `Not started`, `In progress`, `Submitted (on time)`, `Submitted (late)`
   - `Last updated` (from `assignment_docs.updated_at`, if exists)

3. Allow clicking a student row to open a **read-only** view of that student’s content.

   - Route could be:
     - `/classrooms/[classroomId]/assignments/[assignmentId]/students/[studentId]`
   - Render:
     - Student name
     - Submission status + submitted_at
     - Read-only HTML rendering of `assignment_docs.content` (simple `<pre>` or `<div>` is fine for now).

No grading or feedback system is required yet, but structure the code so it can be added later.

---

## Late Detection Logic

Implement “late” logic in a reusable way (helper function or computed field in query):

- `due_at`: from `assignments`.
- `submitted_at`: from `assignment_docs`.

Rules:

- If `is_submitted = true` AND `submitted_at <= due_at` → “Submitted (on time)”.
- If `is_submitted = true` AND `submitted_at > due_at` → “Submitted (late)”.
- If `is_submitted = false` AND `now() > due_at` → treat as “In progress (late)” or “Not submitted (late)” depending on whether any content exists.
- Use this same logic for:
  - Student assignment page
  - Student assignments list
  - Teacher assignment detail view

---

## Implementation Order (Step-by-Step)

Follow roughly this order:

1. **DB & RLS**
   - Add `assignments` and `assignment_docs` tables to Supabase.
   - Add/update RLS policies so that:
     - Teachers of a classroom can manage assignments and see all `assignment_docs` in that classroom.
     - Students can only see and modify their own `assignment_docs`.
   - Ensure existing auth and attendance remain working.

2. **Teacher: List & Create Assignments**
   - On `/classrooms/[classroomId]`, detect teacher role and:
     - Show an “Assignments” section.
     - Implement:
       - Fetching all assignments for that classroom.
       - Rendering a simple list with title + due date.
       - “New Assignment” button + form → server action → insert into `assignments`.

3. **Student: Assignments List**
   - On `/classrooms/[classroomId]`, for student role:
     - Fetch assignments.
     - For each assignment, fetch or join `assignment_docs` row (if any) for that student.
     - Compute and display status.
     - Link each row to `/classrooms/[classroomId]/assignments/[assignmentId]`.

4. **Student: Assignment Editor**
   - Implement the route and server component:
     - Fetch assignment, find or prepare `assignment_docs` row for that student.
   - Implement client editor:
     - Load initial content.
     - Implement autosave using `fetch`/API route:
       - `/api/assignment-docs/[id]/save` with `{ content }`.
     - Implement Submit / Unsubmit actions hitting appropriate endpoints.
     - Show status indicator and saving state.

5. **Teacher: Assignment Detail & Student Work**
   - Implement teacher-only view to:
     - List all students and their statuses for an assignment.
     - Click through to a read-only view of each student’s work.

6. **Polish & Late Logic**
   - Ensure the late/on-time logic is correctly wired to the due date and submission times.
   - Make status badges visually distinct but keep UI minimal and clean.

7. **Do NOT Implement History Yet**
   - Do not create or populate `assignment_doc_events` in this phase.
   - Ensure the current design makes it easy to add later:
     - Autosave/submit endpoints should be obvious touchpoints where history events will eventually be logged.

---

## Style & UX Guidelines

- Keep the UI **clean and minimal**:
  - Use short labels.
  - Avoid verbose subtitles or long instructional text.
  - Rely on sensible grouping, spacing, and headings.
- Prefer **simple, readable code** over over-abstracted patterns.
- Add comments where logic is non-trivial (e.g., late vs on-time calculation, role checks).

---

## Final Deliverable

When you finish, the app should support:

- Teachers:
  - Create classrooms (existing).
  - See their classrooms.
  - Create assignments with due dates.
  - See all assignments for a classroom.
  - See which students have started/submitted each assignment and when.

- Students:
  - Log in with existing auth.
  - Join classroom with a code.
  - See daily attendance check-in and complete it (existing).
  - See a list of assignments with status.
  - Open an assignment, type in a simple editor, autosave, and submit/unsubmit.
  - Edit work even after the due date (status will reflect lateness).

All of this must be implemented while keeping the current auth + attendance logic intact and using the Supabase free tier efficiently.
