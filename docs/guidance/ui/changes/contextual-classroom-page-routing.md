# Contextual classroom page routing

Status: implemented behind an off-by-default server gate; not approved for rollout.
Risk profile: none. Independent review risk: high because relationship evidence selects
the owner or member classroom experience.

## Change brief

- Surface: classroom SSR entry plus its existing navigation and content shell.
- Reference: the current production owner and member classroom pages. This is a
  relationship-aware selection of those owners, not a redesign.
- Roles: legacy teacher/student plus teacher-valued member and student-valued owner.
- Viewports/themes: desktop 1440×900 and mobile 390×844, light and dark.
- States: owner default navigation, member default navigation, archived owner,
  denied/nonexistent classroom, invalid or unavailable gate configuration.
- Primary signal: the existing relationship-appropriate tabs and content.
- Must not add: account-role rewriting, new role labels or controls, onboarding,
  production activation, or additional reachable features.
- Composite widget review: no. The shared navigation behavior and keyboard model do
  not change; only its existing owner/member item set is selected contextually.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Relationship resolution | `resolveClassroomAccess` | reuse | It validates exact owner/member evidence and lifecycle state |
| Pilot admission | Exact user/classroom pair gate | extend | A separate SSR gate prevents API-only pilot settings from silently widening page access |
| Experience selection | `ClassroomPageClient` role branching | extend | A classroom-scoped role selects the existing experience while the real session role remains authoritative for session checks |
| Navigation and content | Existing teacher/student classroom shell | reuse | The relationship selects a proven experience instead of creating a third UI |

## Rollout boundary

`PIKA_CLASSROOM_PAGE_ACCESS_ENABLED=true` evaluates the strict server-only
`PIKA_CLASSROOM_PAGE_ACCESS_PAIRS` JSON list. Every other flag value preserves the
legacy global-role branch without relationship reads. Missing, malformed or oversized
enabled configuration fails closed. Unmatched exact pairs preserve legacy behavior.

For an admitted pair, ownership selects the teacher classroom experience and active
membership selects the student experience. `user.role` is not rewritten: AppShell and
`AuthSessionWatcher` continue to receive the authenticated session role. A contextual
owner page limits the classroom switcher to the current admitted classroom so the page
cannot strand the user on an unadmitted owner route.

This gate must remain disabled in production until every API, resource and workflow
reachable from the selected owner/member experience is relationship-compatible. This
slice does not make assignments, submissions, grading, attendance, files, archives,
Pal or other downstream domains contextual. It does not authorize the combined home,
neutral onboarding, new relationships, plan enforcement or a production cohort.

The separately gated announcement list-read slice is compatible for admitted exact
pairs, but announcement mutations/read receipts and the other reachable domains remain
legacy. That partial progress does not change this page gate's disabled rollout status.

The separately gated lesson-plan list-read slice is likewise compatible for admitted
exact pairs and preserves the member visibility window, but date/bulk/copy writes and
the other reachable domains remain legacy. This does not satisfy the page activation
precondition.

The separately gated material list-read slice is compatible for admitted exact pairs
and preserves owner drafts plus member published-only visibility. Material mutations
and the other reachable domains remain legacy, so the page gate must stay disabled.
