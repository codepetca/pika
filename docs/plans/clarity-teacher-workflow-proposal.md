# Clarity teacher-workflow pilot — proposal

Status: proposed direction; planning authorized, implementation and production collection not authorized.
Recorded: 2026-09-02; refreshed 2026-10-08 against current Microsoft documentation
and Pika `e24d591abb53713e01d75a5c95fc418cf57592eb`.
Owner: Pika maintainer; pilot reviewer and privacy owner to be named.

Companion: [implementation plan](clarity-teacher-workflow-implementation.md).
Prepared, unsent: [Microsoft eligibility inquiry](clarity-microsoft-eligibility-inquiry.md).
This brief preserves product intent; the companion owns the executable checklist.
Neither document overrides repository architecture, security, UI, or release guidance.

## Purpose and decisions

Discover confusing teacher workflows, prioritize fixes, and determine whether those
fixes reduce friction. Pika serves teachers and learners in adult education as well
as younger audiences; do not assume every student is a minor or that a teacher role
alone proves adult eligibility.

- Teacher workflow improvement is the first priority.
- Evaluate Clarity first for low-setup recordings, heatmaps, and frustration signals.
- Begin with participating adult teachers only; exclude all student sessions initially.
- Defer PostHog until a demonstrated need for deeper product analytics justifies it.
- Keep exam-integrity monitoring separate. Analytics is not cheating evidence or a
  student/teacher performance-scoring system.
- A disclosure is necessary for transparency, but is not by itself vendor approval,
  sufficient consent in every jurisdiction, or proof that collection is appropriate.

## Initial scope

Pilot teacher navigation and assignment creation through publication on specifically
approved screens. Class setup can follow after its surface/privacy inventory passes.
Use recordings, heatmaps, rage/dead clicks, quick backs, and excessive-scrolling
signals to identify candidate problems. Add only a few explicit outcome events.

Exclude grading, student records, submissions, feedback content, documents, tests,
exam monitoring, authentication, public pages, and student previews from initial
recording. Sensitive content can also appear around an otherwise eligible editor;
the implementation must inspect the entire mounted document, not just the modal.

## Launch requirements

1. Obtain Microsoft clarification for teacher-only collection in this mixed-audience
   platform. The published under-18 targeting restriction does not explicitly resolve
   this deployment. Do not imply that a disclaimer, adult-teacher segment, role label,
   consent, or technical filtering removes the restriction.
2. Approve the pilot population, eligible surfaces, purpose, disclosure and consent
   experience, vendor data use, access, retention, and deletion arrangements.
3. Use a separate pilot project and restrict access to named reviewers.
4. Prove no Clarity script request or collection for ineligible or non-consenting
   sessions. Cookie denial alone is not sufficient: Clarity's current Consent Mode
   still loads the tag and collects cookieless data when analytics storage is denied.
5. Verify masking and lifecycle boundaries using actual network payloads and replays.

Microsoft currently describes recordings kept for 30 days, with favorite recordings
and a randomly selected recording retained up to nine months. Heatmaps and labels can
also remain available for up to nine months. User-specific or project-data deletion
requires deleting the entire project. Do not promise configurable short retention or
individual deletion without new vendor evidence. A separate pilot project limits scope;
it does not change these terms.

## Collection principles

- Load only after Microsoft eligibility, eligible adult-teacher participation, and
  explicit Pika opt-in are established. Decline or unknown state means no vendor script.
- If a future approved implementation uses Consent V2, keep `ad_Storage` denied. Grant
  `analytics_Storage` only after the separate Pika collection gate passes; the vendor's
  default/denied consent state is not Pika's no-collection boundary.
- Mask all user-generated text and inputs; selectively expose reviewed static UI labels.
- Exclude sensitive media, links, attributes, URLs/referrers, and educational records.
- Do not send names, emails, user/class/assignment IDs, answers, grades, feedback, or
  raw error messages as custom events/tags. Vendor identifiers are pseudonymous,
  not a claim of anonymity.
- Record successful actions only after the application receives successful results.
- Keep saving, posting, scheduling, navigation, and authentication independent of analytics.
- Include a kill switch and test already-open tabs, consent withdrawal, logout,
  account changes, browser history, and entry into excluded content.
- Removing a script tag or filtering a dashboard is not a collection boundary.

## Pilot and improvement loop

Provisional duration: two to four weeks, extended if representative usage is too low.
No automatic monitoring job is authorized by this plan.

1. Review repeated friction weekly, segmented by workflow and release version.
2. Corroborate observations with technical failures and teacher feedback.
3. Prioritize by affected participating teachers, severity, and workflow importance.
4. Fix one or two high-impact problems through the normal Pika UI/review workflow.
5. Compare equivalent cohorts and periods, reporting volume, capture coverage,
   school-calendar effects, and uncertainty.

Proposed measures: observed workflow completion, error/retry frequency, and active
time to completion where it can be measured reliably. Distinguish Post, Schedule,
and Draft intent. A deliberately saved draft is not abandonment. These measures
describe opted-in, captured sessions, not all teachers. Set targets after baseline.
Rage clicks, dwell time, and backtracking are hypotheses, not proof of confusion.

Success means an actionable finding and evidence about a subsequent improvement,
not the number of sessions recorded. If the pilot yields insufficient value or
cannot meet privacy requirements, disable it and evaluate a narrower alternative.

## Expected deliverables

- Approved collection/disclosure specification and eligibility decision.
- Centralized, default-off integration with participation controls and kill switch.
- Small event/tag catalogue and release-version convention.
- Verification evidence, reviewer access list, and rollback/deletion runbook.
- Teacher-friction views in Clarity and a prioritized improvement backlog.

## Source notes

Vendor documentation rechecked on 2026-10-08; recheck before coding and before
production enablement. No Microsoft eligibility confirmation has been obtained.

- [Clarity FAQ: eligibility, retention, deletion, and support](https://learn.microsoft.com/en-us/clarity/faq)
- [Site and privacy disclosure guidance](https://learn.microsoft.com/en-us/clarity/setup-and-installation/privacy-disclosure)
- [Consent V2 and limited no-consent tracking](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2)
- [Consent Management behavior](https://learn.microsoft.com/en-us/clarity/setup-and-installation/consent-management)
- [Clarity data collection fields](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data)
- [Content masking](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking)
- [Session recording retention](https://learn.microsoft.com/en-us/clarity/session-recordings/session-list)
- [Heatmap capabilities and dynamic/container limitations](https://learn.microsoft.com/en-us/clarity/heatmaps/heatmaps-features)
- [Client API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-api)
