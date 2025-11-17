# Claude Implementation Guide — Pika Classrooms Refactor

You are assisting with a major refactor of the **Pika** asynchronous learning platform.  
Your job is to fully read and apply the accompanying specification document (`pika_classrooms_refactor_full.md`).

---

## Your Mission

Implement the multi-classroom system exactly as described, ensuring teachers and students both have clean, minimal, modern dashboards for managing and joining classrooms.

---

## Core Requirements

### 1. Follow the Entire Spec
Use the full specification to update:

- Data model (`Classroom`, `ClassroomEnrollment`, etc.)
- API routes / backend functions
- CSV roster import logic
- UI pages for teacher dashboard, student dashboard, class creation, editing, joining
- Attendance/logging, now filtered by `classroomId`
- Join code & join link workflows

### 2. Keep the UI Minimal
This is critical.

- **NO subtitles** unless absolutely required  
- **NO unnecessary helper text**  
- **NO verbose explanations**  
- **NO decorative text or clutter**  
- Use concise labels and one-action-per-screen design

Examples of good labels:
- “Course name”
- “Class code”
- “Term”
- “Upload CSV”
- “Create class”
- “Join class”

Prefer whitespace and clarity over text.

### 3. Follow Existing Conventions
Honor the project’s:

- Code style
- Folder structure
- Component patterns
- Database/session/utils conventions
- Naming conventions

Do NOT introduce unnecessary dependencies.

### 4. Safe & Conservative Refactor
- Existing attendance data must not break.
- Migrate old single-class flows to the new classroom model safely.
- Use backfill logic as needed (e.g., create a default classroom for existing data).

### 5. Make Reasonable Decisions
If anything is ambiguous:

- Choose the simpler, cleaner, more minimal solution.
- Ask for clarification only if absolutely required.

---

## Output Expectations

When writing code:
- Produce complete file implementations
- Modify existing files as needed
- Provide schema migrations / Convex schema updates
- Generate new UI components and pages
- Produce helper utilities where needed

Your work should result in a fully functioning **multi-classroom Pika platform**.

---

## Final Instruction

Apply the TL;DR for context.  
Apply the full guide for implementation details.  
Respect the minimal aesthetic at every step.

Do not add subtitles or unnecessary text.  
Keep everything clean and functional.
