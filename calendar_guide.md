======================================================================
SECTION 11 — CLASS DAYS MANAGEMENT
======================================================================

Goal: Minimal teacher work. The system should auto-generate class days, and the teacher only confirms them via a calendar UI.

### 11.1 Semester Ranges

Assume two standard semesters for now:

- Semester 1 (Fall/Winter): from September 1 to January 30
- Semester 2 (Winter/Spring): from February 1 to June 30

These ranges can be constants for this MVP.

### 11.2 Auto-generation of class days

When a teacher first configures a course’s class days:

1. Teacher selects which semester the course belongs to (Semester 1 or Semester 2).
2. The system auto-generates `class_days` rows for that `course_code`:
   - All dates within the chosen semester range.
   - Exclude weekends (Saturday and Sunday).
   - Exclude statutory holidays defined in a configuration list in code (Ontario holidays; e.g., Labor Day, Thanksgiving, Winter Break, etc.).
3. For these generated dates:
   - `is_class_day = true` by default.
   - `prompt_text` may be null initially.

If `class_days` already exist for that course, do NOT regenerate automatically. Instead, load existing data.

### 11.3 Teacher calendar UI

Provide a page such as `/teacher/class-days` that:

- Requires `role = teacher`.
- Lets the teacher:
  - Select a course (for now, assume a single GLD2O course if simpler).
  - Select a semester (Semester 1 or Semester 2) to view.
- Displays a calendar (multi-month view) for the selected semester.
- Highlights all dates where `is_class_day = true` for that course.
- Shows non-class days as greyed/disabled.

Interaction rules:

- Clicking a highlighted (class) day:
  - Toggles it to non-class.
  - Updates `class_days.is_class_day` to false for that date.
- Clicking a non-class day:
  - Optionally toggles it back to class day (`is_class_day = true`), if desired.
  - For MVP it is acceptable to support both toggling on and off.

This UI should be a Client Component that calls API routes to update `class_days` for the given course/date.

### 11.4 Effect on attendance

Attendance calculations must:

- Only consider dates where `is_class_day = true`.
- Ignore dates where `is_class_day = false` (no present/late/absent expected).
- If entries exist on non-class days, they may still be stored and viewable, but should not generate required attendance records.

The student `/student/today` page should:

- Check whether today is a class day (`is_class_day = true`) for the student’s course.
- If it is:
  - Show the daily prompt and treat the entry as required for attendance.
- If it is not:
  - Optionally allow an entry as an extra log, but do not mark absence if it is missing.

### 11.5 Implementation notes

- The list of stat holidays should be defined in one place (e.g., a helper module), and used during auto-generation.
- For MVP, it is acceptable to hard-code an array of holiday dates (YYYY-MM-DD) for the current school year.
- Class days are always stored in the `class_days` table as described earlier and keyed by `course_code` + `date`.