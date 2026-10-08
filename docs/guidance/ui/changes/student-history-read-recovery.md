# Student History read recovery

Owner scope: the continuing product fluidity goal. This independent read-client
correction does not reopen held grading/journal reviews or authorize merging.
Risk profile: `workspace-state` (read cache and selected-class continuity).

## Acceptance target

- Surface: Student History classroom/history loading and error recovery; shared
  class-day and student-entry read clients used by Today, classroom views and
  teacher Calendar remain compatible.
- Reference: stable PageState error-versus-empty contract; executable
  `/pattern-lab?role=student#page-states` inspected on 2026-10-06 before edits.
  Current History already renders canonical PageState/Button and retry-region
  focus. Reuse that presentation rather than adding a visual pattern.
- Roles: student History and Today; teacher Calendar/classroom compatibility
  because the class-days client is shared. Both roles require verification.
- Viewports/themes: desktop 1440×900 and mobile 390×844; light and dark.
- States: unreadable successful JSON, invalid/missing array payload, failed HTTP
  (readable or unreadable body), pending retry, valid empty and populated reads;
  preserved classroom selection, keyboard retry focus and late-response fences.
- Primary signal: existing error heading and immediate retry action distinguish
  retrieval failure from a successful empty list. A failed entries read must not
  fabricate absent attendance.
- Must not add: new dependencies, server/schema/auth changes, redesign, shared
  motion changes, new feedback chrome, cache-key/TTL changes or join mutations.
- Composite accessibility review: no new composite; retain existing pressed
  classroom buttons and shared dialog behavior with compatibility checks.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Read failure versus valid empty | Three feature-owned read clients and request cache | extend | Reject unreadable or invalid successful envelopes before caching; preserve real empty arrays and failed-HTTP error messages. |
| Error and immediate retry | History PageState/Button and stable named region | reuse | Presentation already implements the approved read-recovery contract. |
| Selection, entry inspection and local join draft | History existing page and shared ContentDialog | reuse | No change to local state, keyboard or ownership responsibilities. |
| Shared executable reference | Pattern Lab page-states | reuse | No primitive/composition contract changes; no catalog addition required. |

## Verification

Tests first: actual read clients reject malformed success (JSON/body failure and
missing/non-array payload), avoid caching rejection, and successfully recover on
a later valid read. Cover valid empty/populated caching, HTTP error compatibility,
identity-unverifiable classroom reads and entry limit scope.

Browser verification uses actual production owners in development-only fixtures
with synthetic GET responses and denies mutations. History covers the declared
display/state matrix and retained retry/selection/dialog/local-form contracts;
teacher/Today shared-consumer checks establish compatible successful and failed
read behavior. Capture natural recordings and screenshots, inspect them against
the approved reference, and state fixture/full-route limits. Existing reduced
motion and hydration gaps stay tracked with their existing owners.
