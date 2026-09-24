# Teacher Test Authoring

Use this guide when creating or revising a classroom assessment in Pika. It is
about assessment content, not application unit tests or changes to the grading
engine. Follow the [markdown schema](teacher-tests-markdown-schema.md) for import
syntax; keep subject-specific conventions in the course repository.

## Establish the assessment brief

Use the teacher's request and existing course material to establish:

- learning objectives and taught prerequisites;
- intended difficulty, available time, question types, and point budget;
- allowed resources and tools, including whether students can run their answers;
- expected response format and any deliberately assessed process or technique;
- terminology, examples, and visual conventions students already know.

Ask only for missing decisions that materially affect the assessment. Do not
turn one quiz's length, point total, topic, or mix of questions into a default for
every test. For revisions, preserve question/document IDs, unrelated content,
point totals, and release settings unless the requested change includes them.

## Write the prompt, rubric, and sample together

Treat each question as one coordinated package:

| Part | What it must establish |
| --- | --- |
| Student prompt | Task, starting information, assumptions, required result, response format, and assessed restrictions |
| Answer key | Explicit credit criteria, point allocation, accepted alternatives, and partial-credit/error rules |
| Sample solution | One correct answer that follows the prompt and earns all available credit |

Use familiar course language. State the conditions needed to make the task
unambiguous, including ranges, boundary cases, units, rounding, final state, or
orientation when relevant. Avoid irrelevant story details that obscure them.

Every restriction that can cost marks must be visible to students. For example,
if a method must be reused, a source must be cited, or a particular technique is
required, say so in the prompt and identify its credit in the rubric. The sample
solution must demonstrate it. Distinguish mandatory technique from one possible
solution strategy; accept equivalent correct answers unless that technique is
itself the learning objective.

Check both the final result and required intermediate actions. A process such as
"one item on each pass" is not satisfied merely by reaching the same final total
through a different sequence. If the sequence matters, assess it explicitly.

## Make credit decisions predictable

- Make rubric allocations sum to the question's `Points`. Prefer separable,
  observable criteria over a single broad impression of correctness.
- State how partial completion is credited. If a point bundles several outcomes,
  say whether all are needed or how partial credit works, using increments the
  assessment/grading surface supports.
- Define the relevant error policy for this assessment: for example, treatment
  of minor syntax, arithmetic, spelling, or formatting errors versus substantive
  reasoning errors. Do not invent a universal leniency policy from a prior quiz.
- Preserve credit for independently demonstrated skills. Make any cascading
  deductions explicit; do not repeatedly penalize the same missing technique
  across otherwise correct criteria without a stated reason.
- Accept appropriate alternative wording, names, representations, and algorithms.
  Do not treat the sample answer as an exact-match requirement.
- Request concise evidence for awarded or withheld credit by criterion where the
  grading workflow supports it. This is grading guidance, not proof that the
  product will emit or enforce that format.

Populate `Answer Key` for open responses and `Sample Solution` where useful.
For multiple choice, verify that exactly one option is correct and that the
1-based `Correct Option` matches it. Keep grading notes and solutions out of
student-facing reference documents; use the dedicated authoring fields and check
the intended disclosure behavior in student preview.

## Calibrate difficulty and workload

Judge difficulty by the reasoning required: novelty, number of coordinated
steps, nested control, generalization, and edge cases. Answer length and execution
length are not difficulty ratings. Repeating the same algorithm more times does
not necessarily make it harder to devise.

Use course exercises as comparison points, checking the actual version and
requirements when available. Label pedagogical rankings and completion-time
estimates as estimates, not official ratings or measured student performance.
Account for prior practice and whether students have an execution environment.

Check coverage across the whole assessment. Several individually good questions
can still test the same narrow skill. Explain the tradeoff to the teacher when
it matters; do not silently expand the agreed scope or point budget.

## Use diagrams and references deliberately

For transformations, show starting and ending examples side by side. For other
subjects, choose the representation that clarifies the task. Match the course's
notation, label each question and state, and include a legend for ambiguous
symbols. Check that the diagram agrees with every relevant prompt condition.

Label illustrative sizes or inputs as examples when the answer must generalize.
Do not make a visual's particular dimensions an unstated requirement. Keep all
essential constraints in text so the diagram is not the sole source of the task.

An attached PDF is a supported option for a diagram reference sheet; link and
text documents are also described in the markdown schema. Use a focused text
reference for commands, formulas, or definitions when that is clearer. Verify
current editor capabilities before claiming an inline image feature is available
or unavailable. Creating a local PDF does not attach it to a test: upload it
through the supported workflow and verify the attachment when requested.

Render and inspect generated diagrams before delivery, including labels, counts,
direction, overlap, and legibility. Verify student access to an attachment. Do
not assume the AI grader receives or understands a diagram merely because it
is visible to students; the text prompt and answer key should be sufficient.

## Save and report readiness accurately

1. Cross-check prompt, point allocation, answer key, sample solution, and references.
2. Trace or otherwise verify the sample against representative and boundary cases.
3. Apply the authored markdown and wait for a successful saved state. Check that
   intended changes persisted and that unrelated questions/settings were preserved.
4. Inspect student preview when available, particularly formatting, code blocks,
   reference access, and whether teacher-only content is withheld as intended.
5. Report exactly what was saved, attached, previewed, published, or left pending.
   Follow the user's authorized publication scope; saving content does not by
   itself establish that the assessment was published.

Distinguish **content ready for use** from **grading consistency measured**.
Clear instructions, rubrics, and verified samples can make a test ready without
a live AI grading experiment. Name any actual blocker precisely; describe optional
refinements as refinements rather than vaguely calling usable work "nearly ready."

When grading consistency is explicitly being evaluated, use authorized synthetic
or appropriately handled example responses, with expected teacher scores:
a fully correct answer, a valid alternative, a partially correct answer, a
boundary-case failure, and an answer missing an assessed technique. Compare
criterion-level decisions, not just totals. Do not claim measured reliability
from a content review or alter live student grades to test a rubric. See
[grading evaluations](teacher-grading-evals.md) for the separate product workflow.

## Scope of these conventions

These authoring practices were distilled from a September 2026 quiz-authoring
session. They do not change Pika's schema, grader implementation, or publication
permissions. Course preferences belong in the course repository; for the ICS3U
coding and Karel conventions, see its
[test-authoring guide](https://github.com/armorup/ics3u/blob/main/teacher-tests/AUTHORING.md).
