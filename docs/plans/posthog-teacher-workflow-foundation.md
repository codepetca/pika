# PostHog teacher workflow foundation

## Goal and delivered boundary

Improve teacher workflows by measuring intended tasks, confirmed outcomes and failures, then checking whether fixes help. Teacher navigation and Assignment Save/Post/Schedule are the first slice. Student content, exam integrity, grading/attendance detail, replay and live analytics activation are outside it.

The user approved `posthog-js`, pinned at `1.438.5`. This PR provides application-owned event contracts and diagnostic hooks, **not live PostHog collection**. `captureTeacherEvent` is permanently inert in this slice. There is no SDK runtime import, initialization, vendor transport, key, environment activation, consent UI or CSP expansion. An environment variable cannot turn it on accidentally. Synthetic tests use the isolated `createTeacherAnalyticsClient` injection seam; the application does not configure that factory.

The broader proposal/feature inventory is saved in the coordinator's external `posthog-implementation-plan-20261009.md` artifact. This file records the implemented source contract and its outstanding activation boundary, not a replacement proposal.

## Implemented signal contract

| Event | Current source / definition |
| --- | --- |
| `teacher_surface_viewed` | Active semantic teacher tab while the document is visible; contextual classroom experience, not account role or retained tab mount |
| `teacher_surface_ready` | Active Classwork list read resolves with explicit owner-scoped arrays; monotonic read-resolution duration, including cache resolution—not DOM paint, full classroom readiness or backend query duration |
| `teacher_surface_failed` | Active Classwork list read fails or has malformed/unowned lists; finite persistence/unexpected category; existing usable snapshot behavior remains unchanged |
| `teacher_workflow_started` | Logical Assignment editor opens; random per-editor token; create/edit mode; an open is not a completed authored assignment |
| `teacher_action_attempted` | Explicit Save or confirmed Post/Schedule; blocked missing-title attempts and invalid schedule attempts also count; background autosaves excluded |
| `teacher_action_succeeded` | Explicit Save returns an originating classroom/assignment-matching persisted/current unchanged record (including reused autosave), Post returns the matching live record, Schedule returns the matching requested future release |
| `teacher_action_failed` | Bounded validation/persistence/unexpected category; no raw exceptions, server messages or input content |

Schema version 1 is added by the runtime validator. Every event uses a closed property set; unknown keys, accessors, symbols, invalid enums, nonfinite/out-of-bounds durations and malformed random tokens are dropped as a whole. Actor/resource IDs, names, titles, grades, answers, attendance, free text, URLs/referrers and raw errors have no field. Classroom/assignment identities are only local effect/operation ownership dependencies, never emitted.

Workflow/operation identifiers are fresh UUIDv4 tokens, not database IDs. An operation has one terminal outcome, retains its originating editor context across delayed responses, and has a bounded monotonic elapsed duration. This duration is not foreground task time. A successful no-change explicit Save is a task acknowledgement, not new authorship. Save/Close autosaves, empty-draft creation/deletion, schedule cancellation/revert, preview and unconfirmed cancellation are not completion events in this slice.

Read completion is dropped when the originating active classroom owner changes, the tab becomes inactive, or the document is hidden at begin/completion. Independent class-days setup/read coverage and detailed Assignment inspector reads are not included in the Classwork list signal. A refresh error may coexist with retained usable rows. No signal establishes confusion, abandonment, unique-teacher activity or server completion after a browser closes.

## Disable and future activation contract

The application singleton is off with no transport, buffer, browser persistence or SDK load. Synthetic client gates require explicit enabled/consent/teacher-context/approved-cohort booleans and an injected transport. Its `disable()` aborts the current delivery generation, drops future events and never replays disabled events after reenabling. Transport exceptions/rejections do not affect application actions. Cancellation is a fencing signal to the transport; it does not promise deletion of previously ingested data.

Before replacing the inert singleton with a real transport, obtain and implement the approved cohort/consent/region/retention/access/deletion decisions. The future implementation must include a default-off operational kill switch; revocation/account-switch/context transition handling; SDK-generated metadata allowlisting; exact CSP/ingestion boundaries; no-autocapture/no-replay configuration; and synthetic browser payload/no-network proofs. SDK `before_send` validation alone does not certify replay privacy. No activation is implied by merging this foundation.

## Verification and handoff

Tests cover schema rejection and immutable payloads, all policy gates, transport exception containment, cancellation/no replay, random-token isolation, single terminal results, stale editor response attribution, valid/malformed publication results, visible contextual views, inactive/replaced read ownership, Classwork failure→retry readiness and explicit Draft-save behavior. Existing Assignment session/exit lifecycle and Classwork recovery suites are included. No rendered labels, layout, focus, navigation or mutation semantics were intentionally changed; this is instrumentation, not a UI redesign.

Risk profiles: `workspace-state` and `runtime-platform` (pinned SDK dependency). Owners are the external Assignment editor lifetime and active classroom/tab context. Existing business-response guards remain; telemetry retains old operation context rather than repainting a replacement editor. No schema, server authorization, provider, production or held calendar/privacy-audit operations.

Implementation coordination: one GPT-6.1 Sol/high writer owned only analytics source/unit tests; coordinator owned hook integration and feature tests. Worker delivered 44 synthetic tests, lint and typechecking; coordinator verified source and integrated regression tests. Requested/effective model configuration: requested as named, effective telemetry unknown. Worker token cost and isolated elapsed time unknown; no savings claimed. Independent review and exact-head CI receipts belong in PR #1551/lifecycle metadata.

Next authorized code milestone after this foundation: the separately reviewed real PostHog transport and runtime lifecycle, once owner activation decisions are supplied. Dashboards and a live event pilot follow that boundary; replay remains a separate later decision.
