# Contextual Gradebook and returned Grades

## Scope and delivery state

This is the next dormant workflow group in batch 2 of the
[classroom-access roadmap](classroom-access-and-entitlements-roadmap.md).
Source preparation starts from main `8ed854ca95571285f4c55abe8576326e54251230`,
after Survey PR #1614. Implementation and verification are in progress; this
document does not claim a completed workflow, migration application or rollout.

Use the existing server/session and service-role architecture. Shared classroom
experience admission selects the contextual path, but never grants classroom
authority. Absent or unmatched admission retains the existing legacy path;
malformed configured admission and contextual failures must not fall back.
Do not add another rollout switch, permission framework or browser database path.

## Complete workflow

- Actual owners, regardless of historical account role, use the existing
  Gradebook table, student inspector, categories, assessment details, standalone
  items and marks, manual/final overrides and undo, and maximum editing.
- Actual nonowner members, regardless of historical account role, use the
  existing own returned Grades and standalone Classwork mark reads.
- Existing Assignment manual-grade and return adapters remain the canonical
  grading entrypoints. Verify their integration rather than replacing them.
- AI/run/artifact grading entrypoints are a separately scoped batch-2 remainder;
  this group does not execute providers or change billing or entitlements.

Preserve URLs, request/response contracts, screens, grade calculations and
maximum scaling/CAS behavior. Owner reads can inspect archived work; archived
classrooms remain read-only and members cannot read them. Owner precedence
excludes historical owner self-enrollment from member access and the roster.

## Privacy and behavior

The [Student Grades](student-grades.md) and
[standalone mark](standalone-gradebook-items.md) contracts remain authoritative:

- Owner Gradebook includes fully graded work and overrides before Return.
- Members receive only their own eligible returned Assignment/Test marks;
  incomplete, unreturned, draft and future work cannot become a numeric zero.
- Saved standalone marks are immediately visible when Classwork is visible.
  Explicit zero is a mark; blank or cleared is absent. No new Return step.
- Aggregate Grades respects its visibility control and the individual
  Classwork/Tests visibility rules. Standalone Classwork reads do not require
  aggregate Grades visibility.
- Member payloads never contain the owner Gradebook, peers, answer keys,
  submission content, class summaries or final-grade overrides.
- Undoing overrides never deletes standalone marks. Category/weight, excluded
  work and compact-zero-weight behavior remain unchanged.

## Authorization boundary

Use feature-owned service-only database operations for owner source snapshots,
own-member source snapshots and owner mutations. Reads must capture bounded,
explicit sources with current actor/classroom/resource relationships; existing
pure calculations consume validated sources without further unguarded reads.
Writes authorize the current owner and affected resource/member/category inside
the same transaction as the existing mutation primitive or concrete write.

Internal mutation acknowledgements also carry a strict action-specific target:
assessment type/ID, item ID, student ID where applicable, or submitted category
IDs. The server compares that target with the normalized request before accepting
the acknowledgement and returns only the existing public result. An echoed
target does not prove stored effects; native checks independently read them back.

Retain purge, membership-change, archive/revision, maintenance and decommission
fences and established lock order. Do not replace this with a route-role change
or a prior JavaScript ownership check. No uncertain write is automatically
retried. Source size/count/deadline bounds are operational protections, not new
subscription quotas; reject overflow instead of truncating rows or marks.

## Acceptance before main merge

1. Preserve existing legacy/API/calculation tests and add contextual admission,
   mixed-role ownership/membership, strict source/mutation binding and privacy
   regressions before implementation.
2. Prove real database reads/writes, rollback and current-relationship/lifecycle
   races, maximum CAS and score/return behavior in an owned disposable target.
   Generate genuine database types; never hand-edit the generated file.
3. Verify the existing owner/member workflow and desktop/mobile light/dark
   captures, including visibility, explicit zero, clear, unreturned/returned
   differences and cached/fresh revocation. Inspect the actual screenshots.
4. Complete focused/static checks and independent security/correctness and
   architecture/compatibility review, then exact-head CI/PR Gate and a normal
   main PR merge. Do not claim the whole assessments batch or goal is complete.

Production deployment/migrations, shared-local migrations 249+, real-account or
plan changes, quota/billing/provider activation, admission/cohort/home/page
configuration and cutover all remain on hold. Disposable synthetic verification
does not authorize changing any shared or production configuration. PR #1581 is
a historical carrier and must never be merged wholesale.
