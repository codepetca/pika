# Inactive classroom admission registry

This implements stage 0 of the [wider-admission plan](classroom-wider-admission-plan.md).
The exact [accepted 70 accounts](classroom-rollout-acceptance-2026-10-27.md) still use
version 1. Preparing or merging this code does not authorize migration application,
import, production release/configuration, wider admission or automatic signup.
All other provider, account, plan and billing holds remain unchanged.

## Source selection and request behavior

The existing version-1 payload, raw length bound and 100-UUID cap are unchanged.
Unset remains the legacy installation; a configured invalid value fails 503.
The reader is now asynchronous, and its SSR/API/job consumers await the decision.

The dormant version-2 contract is strict JSON with exactly these keys:

```json
{ "version": 2, "source": "registry", "bootstrapManifestSha256": "64-lowercase-hex-characters" }
```

This is a contract example, not a valid configuration or an instruction to apply
one. The digest must equal the future approved bootstrap manifest. Every read
validates the version, digest, exact canonical actor UUID, safe policy revision
and admission/bootstrap booleans. Missing initialization, database errors,
contradictory results and unknown fields fail 503 without a legacy fallback.
The service point read is bounded to five seconds and has no grant-on-read.

API invocations share the pending result within an AsyncLocalStorage request
scope. Server Components use React's request cache where that runtime exposes
it. Background calls outside those scopes read afresh. There is no persistent
positive/negative cache. Concurrent requests do not share decisions, and a
failed read is not retained for the next request. Relationship/resource checks
still run independently at their existing data boundaries.

In registry mode, Home's existing enabled switch remains required, and Home uses
the same registry decision. Its old 100-ID list is retained as bootstrap/recovery
evidence, rather than another active authority. In version 1 its existing list
and intersection behavior are unchanged. Independent page/pair flags are unchanged.

## Database contract and offline manifest tooling

Candidate migration `294_classroom_experience_admission_registry.sql` creates
four private tables: policy, batches, grants and exclusions. It seeds only an
uninitialized revision-zero policy with growth stopped. It contains no actual
account identities or grants. Direct application/browser-role access is revoked;
only service-role callers may execute the three public RPCs. The definer functions
use an empty search path and qualified relations.

`read_classroom_experience_admission_v2` is a stable, indexed actor point read.
`read_classroom_experience_admission_operation_v2` reconciles an operation without
creating or retrying it. `commit_classroom_experience_admission_batch_v2` serializes
all operations on one policy row and accepts an exact operation UUID, expected
revision, kind, UUID sets, manifest digest and opaque approval reference.

The offline `prepareClassroomAdmissionManifest` helper validates and canonicalizes
the complete payload; it performs no database or provider action. Its digest is
SHA256 of this UTF-8 sequence, with canonical UUIDs sorted lexically:

```text
classroom-admission-v2\n<KIND>\n<SORTED-USERS-JOINED-BY-NEWLINE>\n--excluded--\n<SORTED-EXCLUSIONS-JOINED-BY-NEWLINE>
```

The SQL writer recomputes this digest. It binds the full input, including approval
and expected revision, to an operation hash. An exact committed replay returns
the original result before checking the current revision; changing an input under
the same operation UUID refuses. Unknown outcomes require read-only reconciliation
before considering any replay.

| Kind | Preconditions and effect |
| --- | --- |
| `bootstrap` | Exactly 70 canonical existing users, optional disjoint protected exclusions, uninitialized registry. Records immutable bootstrap origins; growth stays stopped. |
| `growth_on` / `growth_off` | Initialized registry and empty user/exclusion sets. Advances the policy revision; existing grants remain. |
| `operator` | Initialized registry, growth enabled, current expected revision, nonempty entirely new/unexcluded users and no exclusion changes. Commits the whole set or none. |

Each operation is bounded to 5,000 combined input UUIDs; there is no global
100-user registry cap. Duplicate/null/multidimensional arrays, unknown users,
overlaps, stale revisions, invalid digests and malformed approval references
refuse without partial grants. No membership, quota, plan or provider state is
written. Batch/origin records are immutable; bootstrap policy binding cannot
be reset. This interface includes no admission-removal or account-deletion path.
Those operations require a separate explicit lifecycle design before any future
affected account deletion; a foreign-key failure must not be bypassed by a purge.

## Attendance compatibility boundary

General admission selects classroom routing; it does not select a broader Bara
protocol audience. In version 1, `resolveAttendanceProtocolCompatibility` returns
the existing exact cohort decision. In version 2, only immutable bootstrap-origin
accounts enter that set. New operator-batch grants remain on their prior protocol
path, including prior teacher/student identity guards. The worker's deactivating
expiry path and downstream entitlement/membership/generation checks remain.

This boundary covers worker owner selection, learner entry/check-in/QR identity
and generation selectors, and teacher sync/marks command selection. It grants
neither attendance entitlement nor a provider connection. Pal/AI/RepoLight/email/
billing controls are unchanged. PPZ remains Tests/native attendance off, without
native mappings/policies, and manual attendance stays `log`.

## Verification and subsequent approvals

Stage-0 acceptance requires the full source consumer inventory, version-1 and
registry error/negative decisions, Home beyond 100, provider equivalence, isolated
001–294 replay, ACL/rollback contracts, committed concurrency, generated public
types, focused checks and independent security plus integration review.
The disposable proof must preserve the canonical local schema/version and remove
only its owned containers. It is not a shared-local or production application.

Before registry activation, obtain separate exact migration/target and private
70-account import approvals, compare both live lists and canonical identities,
and retain growth stopped. A later compatible production release/configuration
cutover needs its own approval, recovery floor, retained-cohort canaries and fixed
observation window. Wider existing-user batches and automatic signup/new-joiner
policy remain separate later stages. Never restore an older list-only build,
delete retained grants or disable compatible routing to stop growth.
