# Participant erasure contract

Copied without changes from Bara `lib/attendance-contract/participant-erasure.ts`
at merged commit `39660c0e207f087cf96923a975ea0f55e6472943` (PR #60).
Change provider behavior in Bara first. This contract is separate from ordinary
attendance command caches and whole-roster decommission.

The same commit supplies the optional `participant_ref` field in v1 `types.ts`
and `validate.ts`; those two files are copied unchanged. Existing actor-only
messages retain their original wire interpretation.
