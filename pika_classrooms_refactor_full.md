# TL;DR — Pika Classrooms Refactor

We are refactoring Pika so teachers can create and manage **multiple classrooms**.

Key goals:
- Teacher dashboard listing all classrooms.
- Teachers can create/edit classrooms (course name, class code, term, roster CSV/manual).
- Students have a dashboard with their enrolled classes.
- Students can join via **class code** or **join link**.
- UI must remain **minimal, concise, low-distraction**.
- Attendance/logging must reference a **classroomId**, not a single course.

Below is the full specification.


# Pika Classrooms Refactor Guide

This document describes a refactor to support **multiple classrooms per teacher** and a cleaner teacher/student dashboard experience in the Pika app.

Use this as a high‑level implementation guide for AI tools (Claude, Copilot, etc.) and for manual development.

---

## 1. Goals

### Functional

- Teachers can:
  - Create and manage **multiple classrooms** (not just a single hard‑coded course like `GLD2O`).
  - See a **classroom dashboard** on login with:
    - A list of their classrooms.
    - The **most recently used classroom** loaded by default, showing the attendance dashboard.
  - Create a new classroom with a minimal set of fields:
    - Class code (displayed, and usable as join code).
    - Course name.
    - Calendar / term selection (e.g., semester, quadmester, or custom label).
    - Class roster:
      - Upload via CSV (using an agreed format like `ICD2O1-1_2025_.csv`).
      - OR manually add students.
  - Edit classroom properties (name, code, roster, etc.) after creation via a simple, low‑distraction UI.

- Students can:
  - See a **dashboard of their enrolled classes**.
  - Join a class using:
    - A **join code** (class code).
    - Optionally, a **join link** (e.g., `joinroom.link/pika/join/<classroomId or code>`).
  - Navigate between classes (e.g., collapsible left sidebar listing their courses).

### UX / Aesthetic

- Keep UI **minimal and clean**:
  - No unnecessary subtitles or long explanations.
  - Labels and placeholders should be concise and obvious.
- Focus on **single clear action per view** (e.g., “Create class”, “Take attendance”).
- Avoid clutter: progressive disclosure for advanced options (e.g., editing details, roster tools).

---

## 2. Roles and Core Objects

### Roles

- **Teacher**: owns one or more classrooms, views attendance dashboards, manages rosters.
- **Student**: belongs to one or more classrooms, marks attendance or logs learning.

### Core Domain Objects

At minimum, ensure the app has conceptual equivalents of:

- `User`
  - `id`
  - `role` (`teacher` | `student`)
  - (Existing auth fields remain unchanged.)

- `Classroom`
  - `id`
  - `teacherId`
  - `classCode` (used as join code; unique per teacher or globally)
  - `courseName` (e.g., "GLD2O – Career Studies")
  - `termLabel` / `calendarLabel` (e.g., "Semester 2", "Quad 1", "2024–25")
  - `createdAt`, `updatedAt`
  - (Optionally) `isArchived` flag for past classes

- `ClassroomEnrollment`
  - `id`
  - `classroomId`
  - `studentId`
  - `role` (optional, if TAs or co‑teachers are supported later)
  - `createdAt`

- `StudentProfile` (if separate from `User`)
  - `id`
  - `userId`
  - `displayName`
  - `studentNumber` / `schoolId` (if used)
  - Additional metadata (optional)

Existing attendance/logging tables should reference `classroomId` instead of (or in addition to) a hard‑coded course.

---

## 3. Teacher Experience

### 3.1 Teacher Landing / Dashboard

**When a teacher logs in:**

1. Determine their classrooms, ordered by:
   - `updatedAt` or
   - `lastOpenedAt` (new field) if available.
2. Show a **two‑pane layout**:
   - Left: **Classroom list** (simple vertical list).
   - Right: **Attendance dashboard** for the selected classroom.

**Behavior:**

- If they have classrooms:
  - Auto‑select the **most recently used** classroom.
  - Show its attendance dashboard (whatever exists today, but scoped to that classroomId).
- If they have no classrooms:
  - Show a “Create your first class” screen with a primary **“Create classroom”** button.

### 3.2 Classroom List (Teacher)

The classroom list (likely on the left) should:

- Display:
  - Course name (primary).
  - Class code (secondary, small text).
- Allow:
  - Clicking on a class to load its attendance view on the right.
  - A **“+ New class”** button at the bottom or top.

Keep this visually minimal:
- No long descriptions.
- No extra icons unless they are meaningful (e.g., archive icon).

---

## 4. Creating a Classroom

### 4.1 Create Classroom Modal/Page

Accessed via:
- “Create classroom” button on empty state, or
- “+ New class” in the classroom list.

**Fields (minimal):**

- **Course Name** (text)
- **Class Code** (text, required; auto-suggest a code, but allow editing)
- **Term / Calendar Label** (text or select; e.g., dropdown with “Sem 1”, “Sem 2”, custom entry)

**Roster options:**

- Section: “Students”
  - Button: **“Upload CSV”**
  - Button: **“Add manually”**

**CSV behavior:**

- Accept a CSV in the format similar to `ICD2O1-1_2025_.csv`.
- Parse columns like:
  - Student name
  - Student number/email (dependent on your actual file format)
- Show a simple preview table:
  - `Name | Email/ID`
  - Allow removing rows before saving.

**Manual entry behavior:**

- Small inline table or list:
  - `Name` and optionally `Email` / `ID`.
  - “Add student” row for quick entry.

**UX constraints:**

- Avoid instructional paragraphs; rely on:
  - Clear labels,
  - Concise placeholders (e.g., “ICD2O – Period 3”),
  - Short helper text only where absolutely necessary.

### 4.2 Edit Classroom

After creation, a teacher should be able to:

- Edit:
  - Course name
  - Class code (with uniqueness validation)
  - Term label
- Manage roster:
  - Add/remove students.
  - Re‑upload CSV to merge/add students (avoid accidental destructive updates).
  - Optionally, allow export to CSV.

Use a **simple “Edit” button** somewhere in the classroom header. When editing:

- Present fields inline or in a focused modal.
- Avoid distractions (no unrelated settings on this screen).

---

## 5. Student Experience

### 5.1 Student Dashboard

When a **student logs in**:

- Show a layout with:
  - Left: **Collapsible sidebar** with a list of their enrolled classes:
    - Course name (primary).
    - Class code (secondary text).
  - Right: The selected class’s main view (today’s attendance/log, learning activities, etc.).

- If the student has no classes:
  - Show a clean empty state:
    - “You’re not enrolled in any classes yet.”
    - Primary button: **“Join a class”**.

### 5.2 Join a Class

From the student dashboard:

- Provide an **input for a join code**:
  - Label: `Join class`
  - Placeholder: `Enter class code`
  - Button: `Join`

**Flow:**

1. Student enters the **class code** (provided by the teacher).
2. Backend:
   - Lookup a classroom by `classCode` (and any necessary scoping).
   - Create a `ClassroomEnrollment` for the current student if not already enrolled.
3. On success:
   - Add the class to the sidebar.
   - Load that class’s view on the right.

### 5.3 Join Link (Optional but Recommended)

Also support a join URL:

- Pattern: `/join/<classCode>` or `/join/<classroomIdOrToken>`.
- Teachers can copy this link from the classroom header and share it in LMS, email, slides, etc.

**Behavior:**

- If a logged-in student opens the link:
  - Same as entering the code manually.
- If not logged in:
  - Prompt to log in or sign up, then complete the enrollment.

---

## 6. UI Layout Suggestions

Keep everything minimal and clean:

### Teacher View

- **Top bar:** App name + user menu (log out, etc.).
- **Left sidebar:**
  - Header: `Classes`
  - List of classes:
    - `CourseName`
    - `ClassCode` (small secondary text)
  - `+ New class` button.
- **Main content:**
  - Classroom header with:
    - Course name
    - Class code
    - Quick actions: `Copy join code`, `Copy join link`, `Edit`
  - Below: existing **attendance dashboard** scoped to `classroomId`.

### Student View

- **Collapsible left sidebar:**
  - Header: `My Classes`
  - List of enrolled classrooms.
  - Button: `Join class`.
- **Main content:**
  - If at least one class:
    - Show selected class’s daily/weekly view (whatever Pika already does for students).
  - If no classes:
    - Show “Join class” panel front and center.

---

## 7. API & Data Changes (High Level)

### 7.1 New/Updated Endpoints

Adjust names to match your current stack (REST, RPC, Convex, Supabase, etc.), but conceptually:

- **Classrooms (Teacher):**
  - `GET /api/teacher/classrooms` → list teacher’s classrooms.
  - `POST /api/teacher/classrooms` → create classroom.
  - `PATCH /api/teacher/classrooms/:id` → update metadata.
  - `GET /api/teacher/classrooms/:id/roster` → get roster.
  - `POST /api/teacher/classrooms/:id/roster/upload-csv` → upload CSV.
  - `POST /api/teacher/classrooms/:id/roster/add` → add student(s) manually.
  - `DELETE /api/teacher/classrooms/:id/roster/:studentId` → remove student.

- **Enrollment (Student):**
  - `GET /api/student/classrooms` → list student’s classes.
  - `POST /api/student/classrooms/join` (body: `classCode`) → join class.
  - `GET /api/student/classrooms/:id` → get class context.

### 7.2 Attendance Integration

- Ensure existing attendance/log tables now take `classroomId`.
- Wherever attendance is queried, filter by both:
  - `classroomId`
  - `studentId` or `date`, depending on existing model.

---

## 8. Migration Plan

1. **Introduce new tables/columns**:
   - `Classroom`, `ClassroomEnrollment`, any new fields on attendance.
2. **Backfill from existing hard‑coded class**:
   - Create a default `Classroom` (e.g., `GLD2O`) per teacher (or per instance).
   - Link existing attendance/log records to that default classroom.
3. **Deploy UI changes**:
   - Teacher dashboard with class list.
   - Student dashboard with class list and join flow.
4. **Clean up hard‑coded assumptions**:
   - Remove any references to a single course ID like `GLD2O`.
   - Replace with `classroomId`-scoped queries.

---

## 9. UX & Edge Cases

- If a teacher deletes or archives a class:
  - Decide whether to hide it from student dashboards or mark as “Archived”.
- Handle duplicate class codes:
  - Either enforce global uniqueness, or uniqueness per teacher.
  - Surface clear errors in the create/edit UI.
- If a student enters an invalid class code:
  - Show a simple error: “Class not found.”
- If a student tries to join a class they’re already enrolled in:
  - Treat as success and simply focus that class.

---

## 10. Instructions to AI (Claude/Copilot)

When implementing this refactor:

- **Respect existing stack and patterns** (Next.js, Convex, Supabase, etc. – whatever is present).
- Reuse existing components and styles to maintain the current Pika look.
- Keep the UI **minimal**: no extra subtitles or explanatory paragraphs unless absolutely necessary.
- Ensure all attendance and logging features are correctly **scoped by `classroomId`**.
- Add only the fields and UI described here; avoid over‑engineering on the first pass.
- Where ambiguous, aim for:
  - Clean, teacher/student-friendly flows.
  - Fewer clicks to:
    - Take attendance (teacher).
    - Join class and log learning (student).
