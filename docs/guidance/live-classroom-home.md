# Live relationship-based classroom home

Implementation slice, 2026-10-23. Production, live-provider calls and activation
remain on hold. This is not a release or a schema-application receipt.

The approved `/pattern-lab#owned-joined-home` is the reference. Adopt its
Teaching/Joined grouping, top-right actions menu and personal Hidden section
below Archived. Preserve the existing owner archive/recovery manager rather than
reimplementing its lifecycle operations. No counts, relationship filter toggle,
quota notices, subscription prompts or new classroom switcher.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Owner list and recovery | `TeacherClassroomsIndex` | extend | Preserve verified ordering, archive, recovery and purge flows. |
| Joined classroom rows | `ClassroomRowFrame` | extend | Same governed card layout; personal visibility is not ownership. |
| Actions and framing | shared work-surface menu, PageLayout/PageHeading | reuse | Retain focus, menu placement and compact reading width. |
| Creation wizard | `CreateClassroomModal` | extend | Keep transactional creation; separate package-import permission. |
| Joined visibility | current enrollment identity | create | No persisted personal home visibility exists. |

Both global account roles may own and join different classrooms. Session roles
remain unchanged. Existing home cohort and complete-experience admission must
both admit the new live journey; unmatched accounts retain their legacy home.
Membership and ownership are still verified separately on every server boundary.
Creation uses managed effective entitlements and the existing atomic writer,
never a client tier label. This does not change plans or purchased allowances.

Hide/unhide is personal, persisted and bound to the exact current enrollment.
It never archives, removes membership or modifies someone else's home. A stale
request from an earlier enrollment cannot hide a new membership.

Verification target: teacher/student account values × desktop/mobile × light/dark;
active, empty, read failure, menu open, editing, Archived/Hidden, visibility
success/failure and creation. Composite-widget accessibility review: required.
Primary signal: existing classroom theme cards and plain section headings.
Signed-in persistence and owner/member denial checks require database evidence;
Pattern Lab fixtures alone do not establish those properties.

## Verification and sequencing checkpoint

Prepared source, not yet changed-base review or release acceptance:

- The existing server home reader feeds the real `/classrooms` composition.
  Nonadmitted accounts retain the original role-based branch. Failed required
  live reads produce an error state, not a legacy fallback or empty success.
- Initial security review found a partial-list risk at the REST row ceiling.
  Both relationship reads now use ordered 500-row pages and exact counts,
  bounded to 4,096 rows per relationship source. Missing/changing counts,
  incomplete pages, repeated primary keys and late errors fail closed. This is
  an operational read bound, not a subscription or classroom allowance. Server
  rendering and admitted active-list refresh both reuse the verified owned rows;
  legacy list behavior is unchanged. Boundary regressions include 1,001 owned
  and joined relationships, retaining the final Hidden candidate.
- Owner ordering and the complete archive/recovery manager remain the existing
  implementation. Joined cards have only personal Hide/Unhide controls. Hidden
  cards remain accessible to current members and appear below Archived.
- Creation reads managed effective entitlements for its display capability and
  retains the atomic idempotent writer for authorization and quota races. New
  entry cannot inherit unmanaged legacy creation. A full slot must not prevent
  replaying a completed creation. Student-valued owners may select their own
  Blueprints but do not gain the teacher-only package-import endpoint.
- Code-based joining reuses the existing bounded exact lookup, guess limiter
  and atomic roster/membership writer. New entry rejects direct-ID joins and
  suppresses account-level Pal events. Explicit code intent preserves UUID-shaped
  codes while unchanged old links retain their legacy UUID interpretation.
- Disposable replay, service-only ACLs, personal effects, removal/rejoin and
  actual two-session ownership/archive/membership contention passed. Generated
  public types differ only by the two new RPCs; shared schema/history stayed unchanged.
- Eight synthetic production-composition browser cases passed (teacher/student ×
  desktop/mobile × light/dark), 56 screenshots, zero retries/skips/flaky cases.
  The initial run failed on an ambiguous test selector matching Next's route
  announcer; its evidence remains failed. The corrected selector targets the
  Classrooms region. These are UI fixtures, not signed-in persistence evidence.
- Eight additional wizard cases passed across the same role/viewport/theme
  matrix, proving that personal Blueprint selection remains available while
  package import is absent for student-valued accounts. Root visually inspected
  representative active/edit/Archived/Hidden and wizard captures; the complete
  screenshot matrix passed independent compatibility review: all 64 PNGs decoded,
  with all active, Archived/Hidden and wizard combinations visually inspected.
- Archiving or unarchiving refreshes server-resolved creation capabilities;
  freeing a slot must not leave the creation action unavailable until a reload.

Private database evidence: `pika-home-visibility.bF4U96` (type artifact generation)
and `pika-home-visibility.rghCmv` (portable runner + exact generated-type check).
Browser evidence: `live-home-ui.B8Mf2F` under the existing classroom-access private
verification directory. Production/provider calls were blocked in that browser run.
Wizard evidence: `live-home-wizard.Nloh0u`, eight screenshots, no retries.

Migration filename is provisional pending coordination: the separate editor PR
#1662 already owns locally applied `291_teacher_authoring_images.sql`. Preserve
that migration and give visibility the following number after the upstream merge;
rebase/resequence, replay the combined schema and review before readiness. Never
apply the provisional same-number source to the shared local database.
The owner authorized coordinating numbering and the normal reviewed merge of
#1662 after its required checks pass; that merge is owned by the editor chat.

Checklist reviewed: yes. Keyboard menu opening/Escape/focus return, checked edit
semantics, role-labelled sections, joined-only actions and disabled controls have
focused coverage. Full changed-base independent review, final CI and signed-in
mixed-role activation evidence remain required. No cohort, provider, subscription
or production rollout follows from this checkpoint.
