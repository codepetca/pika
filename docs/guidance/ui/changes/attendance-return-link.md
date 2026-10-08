# Attendance return navigation

Surface: the return link in the existing StudentAttendanceCheckIn outcome card, shared by individual and classroom token routes. Approved reference: live student Pattern Lab Buttons section and canonical src/ui/Button.tsx; measured baseline return target20px across24 desktop/mobile, light/dark and normal/reduced outcome captures. Native keyboard focus is already visible. Reuse the quiet ghost/sm buttonVariants treatment on the semantic Link to supply the canonical44px target and focus ring. Preserve mt-8, labels and destination selection.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Return link target, keyboard focus, colour transition | buttonVariants ghost/sm with existing Link | reuse | Shared control contract provides44×44 minimum and reduced-motion treatment without changing navigation semantics |
| Loading/result/unavailable acceptance | Existing real attendance fixture | extend | Measure target and keyboard ring, preserve successful/fallback href and uncertain retry attempt identity |

Role: student; teacher/individual route entry authentication is not dynamically exercised, though both routes use the same unchanged owner. States: loading, checked_in, already_checked_in, closed and unavailable with explicit retry. Primary signal: quiet return navigation with a predictable touch target. The existing buttonVariants factory is exposed through the approved @/ui barrel; its implementation and tokens are unchanged. No request, attempt-ID, attendance confirmation, cache, route-wrapper, auth, schema, dependency or shared control behavior changes. Ordinary anchor; composite-widget checklist n/a. Evidence under external product-fluidity/attendance-return-link; controlled fixture responses do not prove backend attendance outcomes or auth persistence.
