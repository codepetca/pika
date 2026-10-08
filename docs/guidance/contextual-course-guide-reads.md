# Shared Course Guide reads

This dormant batch-1 slice adds only an early shared-admission GET branch to the
existing Course Guide endpoint. It leaves the legacy/pair handler, public sites,
metadata writes, home/shell, SQL, generated types, dependencies and billing intact.
It neither completes batch 1 nor activates the shared classroom experience.

## Relationship and projection

Configured shared admission authenticates before parameters and resolves the
cohort once. Admission is not classroom permission. Current ownership wins over
historical self-enrollment; archived owners may read. Any nonowner needs an active
classroom, their exact enrollment and current normalized syllabus visibility.
Both global account-role values follow these same relationship rules.

Narrow preflight queries classify 404/403 but authorize no content. Every control,
header, collection page, empty terminal page and final control statement binds
the current actor and classroom. After initial configuration control, every
statement additionally requires exact raw actual-site JSONB configuration;
members also require exact raw feature visibility. Actual-site JSON null/scalars
preserve historical normalization defaults. Persisted feature visibility retains
migration205's object/known-boolean constraint; missing keys keep historical
defaults, while invalid scalar/nonboolean fixtures must fail with that exact
constraint. No constraint is weakened to accommodate the reader. Independent
semantic checks ignore object key
order, not values. A lost relationship/config guard fails closed without retry,
fallback, relationship-mode switching or partial output.

Only enabled projections are selected. The unchanged CourseGuideData contains
classroom title, four visibility flags, overview, hydrated resources and assessment
key/title pairs. No questions, answers, documents, instructions, grades, lessons,
announcements, user profiles or enrollment enumeration are fetched. Resources
retain the genuine old classroom_materials foreign-key name and object/null
cardinality. Shared content parsing retains historical string/null/invalid-text,
empty and image-only behavior; bounded validation precedes recursive emptiness.

Both owners and members receive published assessments only: assignments are not
drafts and have null release or satisfy the existing visibility utility; tests
are active/closed rather than draft. Capture one trusted application clock and
use an exclusive SQL cutoff of that millisecond plus one, preserving JavaScript
timestamp truncation for PostgreSQL submillisecond values. HTTP supplies no clock.
Order position then UUID, retaining negative/tied positions and duplicate titles;
keys remain sequential assignment:N/test:N without database IDs in the DTO.

## Execution and evidence boundaries

Collections are sequential, with 1,000 rows per page, 10,000 rows per collection,
64 aggregate collection statements including explicit empty terminals, and a
20-second overall abort deadline. Exactly-at-limit still requires its terminal
page. Raw configuration is limited to 4KiB per value, resources to 2MiB and the
final DTO to 4MiB. These are technical bounds, not subscription allowances or
transport preparse caps. Overflow/malformed evidence yields generic 503, never
truncation. A final current relationship/config control follows even all-hidden
guides. This is statement-time authority, not an atomic cross-page snapshot or
retroactive/ABA revocation guarantee.

Source TDD initially failed for the absent reader, then 125 affected assertions
across nine suites passed, alongside TypeScript, scoped lint and architecture.
Installed-SDK no-network tests cover exact root predicates, JSONB wire equality,
combined release/keyset OR, real FK names, hidden projections, pagination,
cardinality, malformed/config/resource bounds and cancellation-ignoring transports.
Source serialization tests are not real PostgREST evidence.

The local SDK harness passed independent pre-execution security review. First
normal execution passed authority/FK/pagination/millisecond and tampered-wire
sections but exposed a proof-fixture mismatch with migration205: scalar feature
visibility cannot be persisted. Both the first run and one safe diagnostic run
completed exact cleanup with unchanged whole-row baselines. Corrected legal
feature fixtures and rollback-only exact constraint-denial cases passed a targeted
security recheck. Root also caught the synthetic ownership-transfer target's
creation-capacity prerequisite before rerunning: its exact tagged test grant is
preallocated and covered by the same teardown; no entitlement guard is bypassed.
A second targeted recheck passed. Normal execution now passes all four sections,
including real JSONB/resource wire, both collections beyond1,000 and 40 committed
revocations before header/first/later/terminal/final statements. Both forced modes
exit exactly1 with their own expected failure and complete cleanup sentinels.
Every execution preserves the global whole-row baseline and leaves generation
guards enabled. These were harness assumptions, not product/schema changes.
Fixtures are preallocated
and local-target guarded, with
exact unconditional teardown, enabled generation guards, zero residue and
whole-row public/private/storage baselines verified before cleanup commit and
afterward. Unexpected provider, attendance, private or storage dependencies deny
cleanup rather than being destroyed. CI registration and its source/fake-shell
gates pass, including rejection of arbitrary failure reasons and exits0/2.
Full independent PR review,
actual-main reconciliation and final exact-head CI remain acceptance gates.

No migration belongs to this slice. Local 001–236 includes other prepared writes;
production remains 001–225. Shared admission and full cutover stay OFF until the
roadmap's integrated release controls are satisfied.
