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
- Under the same home plus complete-experience intersection, protected authoring
  images use current classroom relationships rather than the global account role.
  Reserve/finalize keep actual active ownership and creator/object binding;
  delivery gives owners precedence while current members still need a ready
  image disclosed by their learner surface. Retained previews remain owner-only.
  Outside that intersection, the existing image authorization is unchanged.

Private database evidence: `pika-home-visibility.bF4U96` (type artifact generation)
and `pika-home-visibility.rghCmv` (portable runner + exact generated-type check).
Browser evidence: `live-home-ui.B8Mf2F` under the existing classroom-access private
verification directory. Production/provider calls were blocked in that browser run.
Wizard evidence: `live-home-wizard.Nloh0u`, eight screenshots, no retries.

Editor PR #1662 merged as `61d9265b7e7adf181bea29d57bd62120f839df87`.
The home branch is rebased onto that merge and preserves its already-applied
`291_teacher_authoring_images.sql`. Home visibility is now
`292_classroom_home_visibility.sql`, with the original reviewed SQL digest
`3d5d47d92c0750f2a58e71bd0390653a98bbe0d67a49a450d46c2183837f349d`
unchanged. Combined replay/generated types, changed-base review and final CI
remain readiness gates. This source renumbering applies nothing to shared local
or production databases.

Combined-base local evidence, 2026-10-23: the fresh isolated 001–292 replay,
rollback-only visibility contracts, actual two-session contention and generated
type comparison passed (`native-home292-sLIXmT`). Canonical history stayed at 291;
all owned clone/metadata containers were removed. Fresh home and wizard fixtures
passed 16/16 in 40.425 seconds with no retries, skips, flaky cases or errors
(`live-home292-ui.CFDmyF`, 64 screenshots). Forty-eight captures are byte-identical
to the prior accepted matrix; the 16 changed creation-dialog captures include
upstream `DialogPanel` changes. The temporary app stopped and the shared env
symlink was restored. These remain synthetic-input visuals plus isolated SQL
evidence, not signed-in mixed-role activation evidence.

The first ready-event CI run (`40004265801`) exposed two stale 291 pins in the
attendance-membership and material-post-date verification harnesses. Their source
admission and sealed replay targets now include exactly 292; unknown 293 and
malformed profiles still fail closed. Both actual preflight commands have unit
coverage. Fresh offline proofs (`native-attendance292-wrxE3Q` and
`native-material292-EsxZkh`) passed full 001–292 replay, their existing behavioral
and concurrency contracts, generated-type equality and shared-schema preservation.
Canonical history remained 001–291 and owned containers were removed. This is a
verification correction, not a shared migration application or rollout.

CI then reached the home proof and rejected its source image before creating a
clone: that runner only allowed the existing local `17.6.1.044` image, whereas
the repository's pinned Supabase CLI `2.103.0` uses `17.6.1.132` in its
[tagged image manifest](https://github.com/supabase/cli/blob/v2.103.0/apps/cli-go/pkg/config/templates/Dockerfile).
The runner now explicitly allows those two versions from the existing official
ECR/GHCR mirrors only. Executed shell-guard tests reject future/modified tags,
other registries and namespaces, mutable tags and image-ID mismatches. The
running image must still match the cached exact ID; no pull, isolation, source
preservation, cleanup or SQL behavior check is removed. The unchanged accepted
local proof is reused; the new CI-image home proof still needs final-head CI.

Editor follow-up #1668 merged as `b03198a9f80a74282d8027b15775f83ad58ca935`.
The home branch is rebased onto it without conflicts or SQL changes. Its shared
image-reference reader now compares only complete UUID identities without case
sensitivity; literal route/query names and all existing publication/access
checks remain. The home API retains exact cohort and current-relationship guards
around that reader. Existing native/visual artifacts are unchanged; final
changed-base image tests, focused checks and independent review remain gates.

Checklist reviewed: yes. Keyboard menu opening/Escape/focus return, checked edit
semantics, role-labelled sections, joined-only actions and disabled controls have
focused coverage. Full changed-base independent review, final CI and signed-in
mixed-role activation evidence remain required. No cohort, provider, subscription
or production rollout follows from this checkpoint.
