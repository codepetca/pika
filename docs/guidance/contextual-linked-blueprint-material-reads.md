# Shared linked Blueprint material reads

Status: locally verified preparation; independent review and exact-head CI remain.
This batch-1 API slice stays dormant while shared admission is disabled. It changes
neither the classroom UI nor the Blueprint authoring, adoption or publishing flows.
No schema migration or generated database-type change is required.

## Current permission boundary

Only GET `/api/teacher/classrooms/[id]/blueprint-materials` gains an early shared
admission branch. Authenticate before configuration and strict named parameters.
An admitted account must currently own both the classroom and its linked Blueprint,
regardless of its global teacher/student label. Membership alone never permits
this owner-only source view. Archived owners retain read access.

The identity preflight distinguishes missing classrooms from nonownership; it
never authorizes the payload. One classroom-rooted PostgREST statement filters the
current classroom owner and embeds the current linked Blueprint, filtered by its
current owner. The explicitly named FK embeds its latest saved version with nested
descending version-number ordering and a one-row limit. Strict SDK evidence checks
independently bind the classroom, current source, Blueprint owner and version parent.
No captured-Blueprint-only follow-up query or admitted legacy fallback is allowed.
This is statement-time authorization, not a claim of post-statement revocation.

## Source and response compatibility

The source is the latest saved Blueprint version, not the classroom's frozen
content version or an unsaved Draft. A currently unlinked classroom returns
`{ materials: null }`. A historical saved snapshot without a materials field
returns an empty list; a present null or malformed field fails closed with503.
Keeping the snapshot object internally preserves absence-versus-null evidence.

Only version ID, version number and material records escape the server. Materials
retain their artifact identity, title, Markdown and position, sorted by position,
with the existing500-record bound. Private guidance, answers and other snapshot
fields are never returned. Missing current Blueprint ownership denies access;
untrusted identities, envelope/cardinality failures or SDK errors return generic503.

Absent/unmatched admission leaves the existing global-teacher helper and its
compatibility behavior unchanged. Malformed configured admission fails closed.
Blueprint guidance, adoption, previews, material mutations and roster access are
separate boundaries, not implicitly authorized by this read.

## Observed local verification

Unit/API tests cover authentication ordering, both global-role owners, denied
relationships, current binding checks, strict SDK envelopes, historical snapshots,
ordering, limits and unchanged legacy routing. The local actual SDK proof uses
1,001 saved versions to verify nested server-side latest ordering/limit rather than
assuming default row limits. It proves saved-versus-frozen/Draft selection, current
classroom and Blueprint owner changes, unlink/rebind, purge-shaped detachment,
malformed/synthetic SDK evidence and the500/501 boundary.

Normal execution exits0. Intentional post-fixture failure exits1 with the expected
error and cleanup sentinel. Both restore all tracked global table counts and leave
zero exact synthetic fixtures. The corruption facade targets the actual GET wire
array before the SDK's maybeSingle unwrapping. The script never applies schema or
contacts a hosted API. CI runs both normal and forced-cleanup proofs.

Production application, cohort activation and the full shell cutover remain separate.
