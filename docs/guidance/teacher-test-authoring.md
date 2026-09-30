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

When a classroom was created from a saved Course Blueprint Version, teachers
can use **Draft with Blueprint** from Tests or Classwork. Choose the unit, give
the assessment brief, and review the editable Markdown before creating a draft.
The draft uses that classroom's frozen Version rules, including any selected
unit rule; later edits to the Blueprint Draft do not silently change it. The
teacher editor shows the source Version after creation. Keep guidance and
answer keys in teacher-only fields, and check the student preview before
publishing.

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
student-facing reference documents. Use the dedicated authoring fields, but do
not assume they remain teacher-only: for coding responses, `Sample Solution` is
shown to students on the results page when results become available. Student
preview checks the prompt and references, not post-release results disclosure.

Format code in multiple-choice prompts and options as Markdown so students can
distinguish it from prose. Use inline backticks for commands, identifiers, and
short expressions or statements in prompts and options. Use a fenced code block
with a language label for a multiline snippet in a prompt. Each answer option
must occupy one Markdown list line; put longer shared code in the prompt and
keep code options inline. Preserve the code's exact syntax and the correct
option when revising an existing question. Check the student preview to confirm
that code renders correctly in both the prompt and answer options. Format answer
options before students start. After an attempt begins, Pika permits corrections
to one existing choice per question at a time while keeping the choice count,
positions and correct answer locked. Check that a correction does not change
the intended answer.

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

### Keep reference documents inside the test

Test reference documents must never contain hyperlinks: they create exits from
the test. Do not author link-type reference documents or include Markdown links,
autolinks, HTML anchors, clickable images, or URLs that the editor turns into
links. This applies to every reference, including `Instructions`, language or
subject documentation, and uploaded PDFs. Put the needed documentation directly
in a Markdown text reference or an uploaded file with no clickable links.

When generating images with multiple diagrams or states, stack them vertically
instead of placing them side by side. For transformations, put the starting
state above the ending state and label both clearly. For example, a Karel world
reference should show the starting world on top and the ending world below it.
Keep each diagram legible in the student's reference pane. Match the course's
notation, label each question and state, and include a legend for ambiguous
symbols. Check that the diagram agrees with every relevant prompt condition.

Label illustrative sizes or inputs as examples when the answer must generalize.
Do not make a visual's particular dimensions an unstated requirement. Keep all
essential constraints in text so the diagram is not the sole source of the task.

An attached PDF is a supported option for a diagram reference sheet. PNG and
JPG/JPEG images can also be uploaded through Reference Documents → Upload once
the image storage migration is deployed; students can fit or zoom them in the
reference pane. SVG is not supported. Use a focused Markdown text reference
for commands, formulas, or definitions when that is clearer. Verify
current editor capabilities before claiming an inline image feature is available
or unavailable. Creating a local PDF does not attach it to a test: upload it
through the supported workflow and verify the attachment when requested.

Render and inspect generated diagrams before delivery, including labels, counts,
direction, overlap, and legibility. Verify student access to an attachment. Do
not assume the AI grader receives or understands a diagram merely because it
is visible to students; the text prompt and answer key should be sufficient.

## Organize coding-test references

When a coding test needs reference documents, use this student-facing order:

1. **Instructions** — a Markdown text document titled exactly `Instructions`.
   Put directions shared by the test here: read the full question, follow its
   language and response format, submit the requested code, and handle every
   valid case rather than copying an example. Explain what counts as meaningful
   helper reuse when a question requires it. Keep this document free of question
   numbers, course names, language-specific commands, and solution hints.
2. **Language or subject reference** — program format, allowed commands,
   conditions, syntax examples, and relevant documentation excerpts. Use Markdown
   headings and fenced code blocks. Label examples as syntax examples, not
   solutions to test questions. Keep language-specific details here instead of
   putting them in `Instructions`.
3. **Question visuals** — separate, clearly titled image or PDF references.
   Explain symbols and illustrative sizes in the relevant reference. Keep the
   essential starting conditions and required result in the question text.

Keep coding prompts short and self-contained: state the starting conditions,
goal, variable-size or input requirements, and any assessed technique specific
to that question. Do not repeat shared directions or add navigation hints such
as “see the Question 1 image” or “follow Instructions.” If using a particular
reference is itself assessed, state that requirement in the prompt.

For an `Instructions` document, start from this general Markdown outline and
adapt it to the assessment:

```markdown
# Instructions

Read the full question and any reference material before answering. Follow the
language, environment, restrictions, and response format specified in the
question.

## Coding responses

- Submit the code the question asks for. If it requests a complete program,
  include the needed definitions and the code that runs them.
- Make your solution work for every valid case described. Example inputs and
  diagrams illustrate a case; do not assume their size or values are fixed
  unless the question says so.
- When a question requires a helper function or method, give it a descriptive
  name and a meaningful task. Follow the question's requirement for how often
  to call it. Calls inside a loop count as repeated use unless the question
  says otherwise. A helper that merely renames one built-in operation does not
  demonstrate decomposition.
```

Add a marking-policy section only after choosing the policy for that test, and
make its wording agree with the answer keys. For example, the Unit 1 Karel
quizzes allow minor syntax slips when the intended logic is clear; that is not
a default for every coding test. When copying a test to another class or
language, check the reference order, question and document IDs, diagrams,
points, prompts, answer keys, sample solutions, and release settings. Adapt
language-specific content without changing unrelated assessment content.

## Save and report readiness accurately

1. Cross-check prompt, point allocation, answer key, sample solution, and references.
2. Trace or otherwise verify the sample against representative and boundary cases.
3. Apply the authored markdown and wait for a successful saved state. Check that
   intended changes persisted and that unrelated questions/settings were preserved.
4. Inspect student preview when available, particularly formatting, code blocks,
   reference access, and whether teacher-only content is withheld as intended.
   Open every reference and confirm it has no hyperlinks or clickable exits;
   check uploaded PDFs as well as Markdown text.
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
