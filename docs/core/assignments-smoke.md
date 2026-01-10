# Assignments Smoke Test (Manual)

Goal: confirm the end-to-end assignments flow works for teachers and students.

## Preconditions
- Teacher and student accounts exist.
- Student is enrolled in the classroom.
- (If roster allow-list is enabled) student email is on roster and enrollment is enabled.

## Teacher flow
1) Log in as teacher.
2) Go to `Classrooms` → open the classroom.
3) Open `Assignments` tab.
4) Click `+ New Assignment`, fill:
   - Title
   - Optional description
   - Due date/time
5) Confirm assignment appears in the list and open it.
6) Confirm `Student Submissions` list loads.

## Student flow
1) Log in as student.
2) Ensure you are in the classroom (join via code/link if needed).
3) Open `Assignments` tab.
4) Open the new assignment.
5) Type some text; confirm autosave shows `Saving…` then `Saved`.
6) Click `Submit`; confirm status changes to submitted and timestamp appears.
7) Click `Unsubmit`; confirm status returns to in-progress.

## Teacher review
1) In the assignment detail page, confirm the student status changes to submitted.
2) Click the student row; confirm the teacher can view the student’s work.

