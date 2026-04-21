# Pika UI Canon

This directory is the governed UI/UX canon for Pika.

Use it to keep AI-driven UI work grounded in the current product instead of inventing new patterns on the fly.

## Operating Model

Pika uses four UI guidance buckets:

1. **Stable guidance**
   Default rules for new UI work. These are the preferred patterns and should be treated as truth for AI implementation.
2. **Experimental guidance**
   Candidate patterns observed in recent work or proposed for controlled reuse. AI may draft or update these, but they are not truth yet.
3. **Legacy guidance**
   Older or still-present patterns that should not be copied into new work unless a human explicitly chooses them.
4. **Open questions**
   Unresolved UX tensions where the product still needs human judgment or additional iteration.

## Read Order For UI Work

When a task affects UI, styling, layout, or interaction flow, read in this order:

1. [`docs/core/design.md`](/docs/core/design.md)
2. [`src/ui/README.md`](/src/ui/README.md)
3. [`docs/guidance/ui/stable.md`](/docs/guidance/ui/stable.md)
4. Family-specific canon docs in this folder when the task targets a governed slice
5. Relevant experimental, legacy, and open-question docs in this folder only if they materially affect the task

The stable file is the default. Experimental and legacy docs are context, not overrides.

## Promotion Rules

- Humans promote guidance into `stable.md`.
- AI may create or update experimental drafts.
- AI may add legacy entries when older patterns still exist in code and need to be called out as non-default.
- AI may add open questions when a UX tradeoff is real and unresolved.
- AI must not silently edit stable guidance as part of ordinary feature work.

## V1 Scope

The current governed slices are:

- Cross-cutting stable guidance for assignments, attendance, and shared classroom shell behavior that directly supports those workflows
- A dedicated teacher work-surface canon for:
  - teacher assignments
  - teacher quizzes
  - teacher tests

This is intentionally smaller than the full app.

## Workflow Contract

When a task touches UI/UX, the implementation plan or issue note should declare:

- guidance read
- stable guidance followed
- experimental guidance introduced: yes/no
- experimental draft file updated or created, if any
- human promotion needed: yes/no

## Related Files

- [`audit-v1.md`](/docs/guidance/ui/audit-v1.md)
- [`stable.md`](/docs/guidance/ui/stable.md)
- [`teacher-work-surfaces.md`](/docs/guidance/ui/teacher-work-surfaces.md)
- [`audit-teacher-work-surfaces.md`](/docs/guidance/ui/audit-teacher-work-surfaces.md)
- [`legacy.md`](/docs/guidance/ui/legacy.md)
- [`open-questions.md`](/docs/guidance/ui/open-questions.md)
- [`experimental/README.md`](/docs/guidance/ui/experimental/README.md)
