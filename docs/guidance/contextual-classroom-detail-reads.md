# Shared classroom-detail reads

This dormant batch-1 slice adds early shared-admission branches to the existing
owner and member detail GET routes. It changes no metadata PATCH, Course Guide
assembly, SSR/home routing, UI, SQL, generated types, billing or cohort settings.
It is not completion or activation of the classroom experience.

## Authorization and persistence boundary

Configured shared admission authenticates before route parameters and resolves
the actor cohort exactly once. Absent or unmatched admission retains the literal
existing pair-pilot/legacy handlers. Admission grants no classroom relationship.

Either global account-role label can own or join a classroom. A narrow preflight
classifies missing (404) and forbidden (403) classrooms, but never authorizes the
payload. The owner payload binds classroom and current owner in the same query;
archived owners may read. The member payload binds active classroom, nonownership
and the exact actor/classroom enrollment through its genuine foreign-key inner
join. Owner self-participation is denied even when an enrollment exists.
Relationship removal, transfer, archive or deletion before the payload query
cannot disclose a record using stale preflight authority. This is statement-time
authorization, not a transaction snapshot or permission to mutate metadata.

Named schemas validate request UUIDs, SDK envelope/cardinality and all 30 explicit
persisted fields. Missing/substituted/malformed evidence or transport errors
returns generic 503 without fallback. A lost relationship yields 403. There is no
select-star payload, unbound enrollment requery, SDK retry or schema shim.
Existing hydration retains historical JSON defaults and all four manual-attendance
fields. Members receive no enrollment evidence or authoring-guidance version ID;
raw overview/outline markdown is blanked as in the existing contextual projection.
Visible guide content remains the separately guarded Course Guide endpoint.

## Verification and release state

Implementation TDD reproduced the missing-path failures; 111 new source/API
assertions and 64 existing core/admission regressions pass. TypeScript, scoped
lint and architecture checks pass. The local SDK proof exercises all 30 fields,
both account-role labels, actual FK response arrays, malformed results and real
post-preflight relationship changes. Its normal and two forced-failure modes
require exact synthetic teardown, enabled generation guards and whole-row
public/private/storage fingerprints checked before commit and confirmed afterward.
The CI-hook regression was reproduced RED. Actual SDK runs, independent full
review and exact-head CI are still pending; do not infer completion from source.

No migration belongs to this slice. Local schema 001–236 includes other prepared
work; production remains 001–225. Installed SQL is not regenerated or changed here.
Shared admission stays off until the roadmap's whole-experience release gates pass.
