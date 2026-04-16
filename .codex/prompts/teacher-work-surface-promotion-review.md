# Teacher Work-Surface Promotion Review

Review the teacher work-surface family only:

- teacher assignments
- teacher quizzes
- teacher tests

Stay out of unrelated teacher tabs, the main classroom shell, and all student-only surfaces unless they materially affect the teacher-side implementation of this family.

## Required Inputs

Read and compare:

- [`docs/guidance/ui/stable.md`](/docs/guidance/ui/stable.md)
- [`docs/guidance/ui/teacher-work-surfaces.md`](/docs/guidance/ui/teacher-work-surfaces.md)
- [`docs/guidance/ui/audit-teacher-work-surfaces.md`](/docs/guidance/ui/audit-teacher-work-surfaces.md)
- relevant files under [`docs/guidance/ui/experimental/`](/docs/guidance/ui/experimental/) only if they materially affect this family
- current implementation of teacher assignments, teacher quizzes, and teacher tests

## Goal

Produce a concise non-mutating review packet that tells a human:

- which current patterns should remain local
- which patterns should be recorded as experimental
- which patterns are ready to promote to stable
- which patterns are ready for primitive extraction
- which patterns should be deprecated as legacy drift
- which guidance docs look stale versus the best current implementation

## Rules

- Do not edit repo-tracked files.
- Do not silently promote anything to stable.
- Do not treat assignments as permanent authority. Treat the canon as authority.
- Prefer structural findings over cosmetic nitpicks.
- If screenshot capture would materially improve the review, use the existing verification flow, but keep the run non-mutating.

## Extraction Test

Recommend primitive extraction only when all are true:

- the pattern is structural rather than domain-specific
- it appears in at least two places or clearly needs to
- it has stabilized
- the API can remain narrow
- abstraction would reduce duplication without hiding meaningful differences

## Expected Output

Return one concise review packet with these sections:

1. `Stable Candidates`
2. `Experimental Candidates`
3. `Primitive Candidates`
4. `Legacy Drift`
5. `Docs To Update`
6. `Recommended Next Actions`

Each item should name:

- the pattern
- the current owner files
- the proposed disposition: keep local / mark experimental / promote stable / extract primitive / deprecate legacy
- the shortest convincing reason
