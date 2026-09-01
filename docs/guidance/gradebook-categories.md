# Gradebook Categories

This guide defines the teacher-controlled course-grade calculation and the
behavior of category and assessment settings.

## Default setup

Every classroom begins with these categories:

| Category | Course percentage | Default assessment weight | Default category |
|---|---:|---:|---|
| Attendance | 10% | 10 | No |
| Term | 65% | 10 | Yes |
| Final | 25% | 10 | No |

Existing assessments are assigned to Term when the migration is introduced.
New assignments and tests use the classroom's default category and that
category's default assessment weight.

Teachers can rename, add, reorder, or delete categories, choose one default,
and set each category's course percentage and default assessment weight.
Category percentages must total exactly 100 before they can be saved.

## Calculation

Assessment weight is relative inside its category. If a 65% Term category has
two included assessments with weights 10 and 10, each assessment has an exact
course weight of 32.5%. Changing those weights to 10 and 20 changes their exact
course weights to 21.67% and 43.33%.

A student's score in each category is the assessment-weighted average of fully
graded, included work. The final percentage combines those category
scores using the configured course percentages.

For a running grade, categories that do not yet contain a qualifying score for
that student are omitted and the remaining category percentages are
renormalized. Missing or ungraded work is not treated as zero.

## Uncategorized assessments

Deleting a category does not delete its assessments. Their category reference
is set to null and the gradebook shows them as **Uncategorized**. Uncategorized
assessments make no contribution to the aggregate course grade until a teacher
assigns them to a category. Their scores and feedback remain unchanged.

Draft and excluded assessments also make no contribution and display no exact
course weight. Exact course weight otherwise uses all non-draft, included
assessments in that category, whether or not a particular student has a score.

Category definitions and assessment memberships are included in classroom
archives. Archives created before categories existed restore the standard
Attendance, Term, and Final setup and place restored assessments in Term.

## Teacher workflow

- **Edit gradebook** opens the category editor.
- Selecting an assessment title opens its details.
- Changing the assessment category proposes that category's default assessment
  weight; the teacher can then set a different relative weight.
- The details dialog shows both the category's course percentage and the
  assessment's calculated exact course weight.

The live calculation falls back to the legacy points-based calculation only
when the category schema has not yet been deployed. This compatibility path is
temporary rollout protection, not a second configurable gradebook mode.
