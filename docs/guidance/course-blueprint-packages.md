# Course Blueprint Packages

This is the teacher-facing contract for portable course files.

## Naming Decision

- **Course Blueprint** is the reusable plan teachers edit in Pika.
- **Course Package** is the portable exported file teachers can move between Pika, a repo, Codex, Claude, or another editing workflow.
- The official exported file extension is `.course-package.tar`.

## Package Format

A course package is a tar archive with these root files:

- `manifest.json`
- `course-overview.md`
- `course-outline.md`
- `resources.md`
- `assignments.md`
- `tests.md`
- `lesson-plans.md`

`manifest.json` stores package metadata and planned-site publishing settings. The Markdown files store the editable teacher-authored course content.

## Included

- Course title, subject, grade level, course code, and term template
- Planned course site slug, published flag, and section visibility
- Course overview, outline, and resources
- Assignment plans, default due offsets, default due times, points, gradebook weights, final-grade inclusion, and draft state
- Test definitions, point scales, gradebook weights, and final-grade inclusion represented in Markdown
- Test document metadata/content when represented by the test Markdown format
- Lesson plan templates

## Excluded

Course packages are reusable planning files, not classroom backups. They exclude students, submissions, grades, attendance, rosters, join codes, class days, classroom calendar overrides, live announcements, actual course website settings, and runtime storage objects.

## Round Trip

1. Export a course blueprint from Pika as `.course-package.tar`.
2. Extract the archive.
3. Edit the Markdown files in a repo, Codex, or Claude. Keep the filenames and `manifest.json` at the archive root.
4. Repack the root files into a tar archive.
5. Import the course package in Pika.
6. Review the resulting Course Blueprint before using it to create a classroom or publishing its planned course site.

Do not use this package for automatic `actual -> blueprint` sync. Classroom changes should be reviewed and explicitly saved back into a Course Blueprint.

## Classroom Rollover

When a teacher saves an existing classroom as a blueprint, assignment due dates are converted into offsets from the source classroom start date using `America/Toronto`. Creating a classroom from that blueprint applies those offsets to the new classroom start date.

Blueprint-created assignments and tests are always created unpublished. The teacher must review due dates, lesson-plan calendar mapping, and assessment settings before releasing classwork to students. A blueprint never copies students, submissions, grades, attendance, or announcements into the new classroom.
