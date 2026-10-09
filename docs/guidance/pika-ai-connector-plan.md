# Connect Pika to your AI

Status: planning deliverable, 2026-10-08. No connector, provider activation,
student-data egress or grading write has been performed for this plan.
Source baseline: `e24d591abb53713e01d75a5c95fc418cf57592eb` on `origin/main`.
The coordinator owns phase advancement; this chat owns the connector design.
Model recommendation: retain the configured Codex model for boundary design and
verification; use one inherited-model read-only worker for bounded source mapping.
Planning risk: `none`; implementation risk: `async-grading` and `runtime-platform`.

## Outcome and execution model

A teacher connects their existing Codex or Claude assistant to Pika. The assistant
can eventually manage classrooms, curriculum, assignments, tests and grading
through authenticated, narrowly defined Pika tools. Pika remains the system of
record and enforces authorization, input/output validation and review workflows.
This is a general connector, with grading as the first complete vertical slice.

The teacher runs inference in their own assistant under that host's account,
usage limits and data settings. Pika neither receives the assistant's subscription
credentials nor promises unlimited inference. Calling the existing Pika
auto-grade endpoint still invokes DeepSeek; it is not subscription-funded grading.
Keep that option unchanged. Remote Gradex, billing and dormant access/usage flags
remain unchanged.

### Provider evidence, checked 2026-10-08

| Route | Supported evidence | Design consequence |
| --- | --- | --- |
| Codex acting on Pika | [Official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) describes local STDIO and remote Streamable HTTP with bearer/OAuth authentication. | A local tool process is a supported pilot transport. This is not an end-to-end Pika compatibility test. |
| Claude acting on Pika | [Desktop/web connector guide](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors) describes local extensions and remote connectors; [remote MCP guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) says remote calls originate from Anthropic infrastructure. | Start with Codex and Claude Code local MCP. Local Desktop, Cowork, web and mobile support must be verified separately; do not promise identical availability. Remote deployment is a later phase. |
| Embedded ChatGPT plan inference | [Sign in with ChatGPT overview](https://developers.openai.com/siwc/token-sharing-open-source) documents open-source/local clients and directs paid/remote apps to an interest form. | Not a prerequisite for this connector; do not assume hosted Pika has partner approval. |
| Embedded Claude subscription inference | [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) requires prior approval for third-party products offering Claude login or limits. [Subscription help](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), updated October 7, describes continuing SDK/subscription usage and Max/Team API credits. | User usage/billing support does not establish permission to embed subscription login in Pika. SDK embedding and API credits are separate future decisions. |

## General capability roadmap

Expose semantic tools with validated arguments, not an arbitrary URL/HTTP/RPC,
SQL, filesystem or shell tool. The same server services can later back remote MCP.

| Phase | Teacher outcome | Reusable current surface | Exit condition |
| --- | --- | --- | --- |
| 0: preparation contract | Retrieve one bounded sanitized assignment grading package; locally validate a synthetic result. | Teacher auth/CLI, assignment prompt/profile and sanitization helpers. | All preparation and pure validation tests below pass with zero provider calls and zero grading writes. |
| 1: assignment pilot | Grade a selected submission in Codex/Claude Code and save a reviewable suggestion. | AI persistence, teacher grading UI, process scoring and review snapshots. | Transactional stale/replay protection, draft-only persistence and synthetic client round-trip proven; live canary requires separate authorization. |
| 2: curriculum and assessment drafting | Read/edit Blueprint packages and propose assignment/test drafts. | `scripts/pika.ts`, Blueprint package/proposal services and teacher draft routes. | Exact version/identity checks and proposal review survive round-trip; each tool has explicit scope and separate write semantics. |
| 3: classroom management and reporting | Discover owned classrooms, inspect authorized summaries and perform selected reversible operations. | Teacher classroom routes and existing server helpers. | Minimal disclosure per tool, ownership/lifecycle checks and stale-write protections validated. |
| 4: tests and broader grading | Mark open responses using answer keys and existing score limits. | Test profiles, result validation and atomic test grading services. | Test-specific privacy, provenance, review and revision contracts pass; no assignment contract reused blindly. |
| 5: hosted connector | Connect without installing a local helper. | The accepted tool contracts from prior phases. | Approved deployment/auth design and verified OAuth interoperability; no assumed subscription embedding entitlement. |

Publication, returning grades, destructive management, messaging and unattended
automation are not granted by connecting an account. Their tools need their own
explicit action contracts. The first pilot exposes none of them.

## Repository reuse map and missing seams

Paths refer to the inspected source baseline, not proposed implementations.

| Responsibility | Existing contract | Required work |
| --- | --- | --- |
| Pika authentication | `src/lib/auth.ts`; `scripts/pika-api.ts`; `/api/auth/login`, `/api/auth/me`; `scripts/pika-cli-README.md` | Validate current teacher session on every request; use the existing Brevo/email-code/password direction. Local login stays outside model tool arguments. Audit CLI host binding and response redaction before reuse. No WorkOS revival. |
| Teacher authorization | Existing assignment teacher routes and `src/lib/server/contextual-assignment-grading-access.ts` | New connector routes retain legacy teacher/ownership authorization and active lifecycle checks. Dormant contextual manual-grade gates do not authorize external AI reads/writes or a global role-neutral connector. |
| Sanitized preparation | `loadClassroomAiSanitizationContext` in `src/lib/server/ai-sanitization.ts`; `buildAssignmentGradingRequest` in `src/lib/ai-grading.ts`; `parseContentField` | Require roster context before preparation; the existing prompt builder's optional context is not enough. Extract/reuse provider-neutral preparation without selecting DeepSeek or invoking `gradeStudentWork`. |
| Output and prompt | `src/lib/grading/profiles/pika-assignment.ts`, `src/lib/grading/engine.ts`, `src/lib/grading/contracts.ts` | Reuse strict parsing/normalization and versioned prompts. Split pure result validation from provider execution where necessary; no fake provider call or alternate rubric. |
| Process scoring | `src/lib/assignment-workflow-process.ts`; `gradeAssignmentDocWithAi` in `src/lib/server/assignment-ai-grading-runs.ts` | Server computes timing, session and authenticity contributions and reminders. Client supplies Presentation only (0–4), never process scores or history. |
| Atomic persistence | `saveAssignmentAiGradeAtomic` in `src/lib/server/assignment-grades.ts` and its service-only RPC | Its defaults mark work graded and apply feedback. Set `markGraded: false` explicitly; review feedback-draft behavior separately. Existing document revision checks do not prove complete assignment/source fingerprint or connector receipt idempotency. |
| Complete source fingerprint | `private.assignment_ai_grading_source_fingerprint_v1` in migration 204, used by metered run admission/finalization | Reuse the fingerprint semantics as design evidence, not the dormant metering admission/settlement transport. A connector requires its own reviewed transactional import boundary. |
| General operations | `scripts/pika.ts`, `src/lib/server/course-blueprint-proposals.ts`, teacher classrooms/assignments/tests APIs | Existing APIs are reusable services, not provider-safe MCP outputs. Add minimal tool-specific result mappers before exposing them. |

No MCP runtime or connector-specific prepared/import route exists at this baseline.
No new SDK, framework, dependency, database or OAuth service is selected by this plan.

## Assignment-only private pilot

### Teacher workflow and tool surface

The pilot uses one explicitly configured teacher and one selected owned active
Assignment. A teacher may select up to five eligible submitted documents per
invocation; preparation and import operate on one document at a time. A batch
must report independent successes/failures without silently widening selection.

1. The teacher signs into Pika through the local helper using the existing session
   flow; the AI host already owns its own login.
2. A local STDIO tool process advertises only the following narrow tools. There
   is no network listener, public tunnel or new hosted OAuth in the pilot.
3. The assistant gets the prepared grading instructions, sanitized text and result
   schema, grades the work, and submits the structured result for validation.
4. The teacher reviews suggestions in Pika and performs any publish/return action
   through existing explicit UI actions.

| Proposed tool | Inputs | Output/side effect |
| --- | --- | --- |
| `pika_assignment_grading_prepare` | Local selected-document handle for the configured Assignment. | Sanitized system/user instructions, exact profile/rubric/schema versions, result schema and a short-lived opaque prepared handle. No grade write/model call. |
| `pika_assignment_grading_validate` | Prepared handle and strict result JSON. | Validated normalized proposal or bounded field errors. Does not save grades. |
| `pika_assignment_grading_save_suggestion` | Prepared handle, validated result JSON and stable receipt reference. | Draft suggestion and minimal receipt after server revalidation. Only phase 1 advertises it; phase 0 must not expose a write capability. |

Preparation requires server admission, not just a local config setting. Proposed
pilot admission is an off-by-default switch plus exact teacher/Assignment pairs,
independent of existing dormant classroom/usage flags. Define final names in
implementation. Missing/malformed configuration denies preparation and import;
the current phase neither creates nor activates those flags.

### Data boundaries

- The local process retains the Pika session in the existing private session file;
  reject unapproved origins/redirects and never emit cookies, passwords or raw
  login/API response objects as tool results. No Supabase secret goes to the host.
- Inside Pika: raw documents, student IDs, roster/profile names, ownership,
  artifacts, workflow history, receipt mappings and fingerprints. Load only the
  selected authorized document and necessary classroom sanitization context.
- At the AI boundary: allow-listed sanitized title/instructions/submission text,
  image/artifact markers supported by the existing text-only profile, schema and
  random refs. No raw rows, Pika UUIDs, names, artifact URLs, history or process
  metrics. Pseudonym maps remain server-side or sealed in an opaque encrypted
  server-verifiable handle; a readable signed token containing IDs is insufficient.
- Enforce payload bounds before egress; proposed ceiling 100 KiB serialized UTF-8
  per prepared response and 16 KiB feedback. Reject oversized content explicitly,
  rather than silently truncate student work or prompts. Final caps require tests.
- Initials are linkable pseudonyms and narrative text may remain identifying.
  Assistant history/retention is governed by the selected host/account. MCP does
  not inherit API `store: false`, guarantee anonymity, or erase chat history.
- Submission text and imported feedback are untrusted content. Tool instructions
  require the assistant to treat student text as grading evidence, not commands;
  server authorization/validation must withstand the assistant ignoring guidance.
- Re-sanitize feedback before persistence using the current roster context and
  direct-identifier output sanitizer. Errors and logs contain categories/refs,
  never student text, arbitrary API bodies or transport/parser causes.

### Prepared and imported contracts

The server-issued handle must bind authenticated actor, Assignment/Classroom,
exact document, complete source fingerprint, document/grade revision, delivered
contract versions, purpose, issuance/expiry and a random receipt reference. Use
existing crypto primitives only after a concrete design review. Proposed lifetime:
15 minutes. Revalidate current session, exact pilot admission, enrollment and
active ownership/lifecycle on each preparation/import; changed/deleted work wins.

Result fields are the existing strict assignment profile: Completion 0–10,
Thinking 0–10, Presentation 0–4 and bounded nonempty feedback. Reject extra fields,
non-integers, NaN, missing/duplicate refs and unsupported versions. The server
recomputes total Workflow and process reminders. Empty/blank submissions retain
the current deterministic rules without requiring an assistant call.

Do not let the assistant supply trusted identity, process scores, reviewed status,
publish/return flags or authoritative provenance. Host/model attribution is
reported, not cryptographically attested; use an explicit external-assistant
policy/label and preserve unknown telemetry as unknown. Pika made zero inference
calls; do not invent token usage, reasoning effort or provider request counts.
Before phase 1, settle how the existing bounded provenance records that distinction
without presenting delivered prompt versions as proof the assistant followed them.

Persistence must compare the complete current source fingerprint and grade
revision under the same transaction fences as the write. A JavaScript check
followed by an RPC is insufficient. Identical replay returns the original receipt;
changed result replay conflicts. A retry cannot overwrite a teacher edit or newer
suggestion, and expiry/revocation must be enforced inside admission/finalization.

Draft-only is an observable behavior, not merely `markGraded: false`: inspect the
current RPC's score-field mutations and student Grades eligibility, then prove
that unreviewed suggestions do not affect released marks or feedback. If separate
proposal storage is needed, design a minimal bounded service-only contract rather
than reuse live grade fields unsafely. Never bypass durable run/usage rules by
making the assistant call auto-grade or finalization endpoints directly.

The full pilot therefore has a persistence gate. A new narrow service-only wrapper
or proposal/receipt contract may need a migration to provide these guarantees.
Do not claim a schema-free end-to-end pilot. Migration authoring/review and exact
target/application permission are separate; no migration is applied in this phase.

## Next implementation slice and file ownership

Next: **phase 0, provider-free preparation and pure validation**, with synthetic
fixtures only. Complete it before selecting/installing a transport dependency or
implementing persistence. It produces a reusable contract for the general connector.

| Owner | Proposed paths | Responsibility |
| --- | --- | --- |
| Connector implementation owner | `src/lib/validations/ai-connector.ts`; `src/lib/server/ai-connector-assignment.ts`; `src/app/api/teacher/ai-connector/assignments/[id]/prepare/route.ts` | Strict input/output contracts, authenticated bounded preparation, sealed handle and exact pilot admission. No import/save route yet. |
| Same owner, sequential shared edits | `src/lib/ai-grading.ts`; `src/lib/grading/engine.ts` or focused new pure helper | Extract shared preparation/normalization with regression coverage; preserve current DeepSeek behavior byte-for-byte where possible. |
| Same owner | `tests/unit/ai-connector-assignment.test.ts`; `tests/lib/grading/ai-connector-output.test.ts`; existing grading tests | Synthetic boundaries, authorization failures, stale/expired/tampered handle and parsing tests. |
| Coordinator | This plan and normal session handoff | Verify delivery, preserve phase gates and authorize the next slice within existing scope. |

Later phase 1 owns a narrow import route/service, reviewed transaction contract,
receipt/idempotency tests and `scripts/pika-mcp.ts` (proposed). Do not add generic
agent orchestration infrastructure. Use the accepted preparation/results API
as the transport seam; choose standards-compliant MCP packaging with separately
approved dependency changes if needed, rather than build an ad hoc protocol.

## Acceptance evidence required

| Stage | Required behavior and proof |
| --- | --- |
| Preparation | Teacher/owner/active enrollment checks; other teacher/student denied; malformed or unmatched gate denied; roster failure aborts; bounded request/output; sentinels for names/emails/IDs/URLs absent; raw history/IDs/credentials absent. |
| Pure validation | Strict existing score ranges and schema; malformed/extra result rejected; feedback sanitized; opaque handle tamper/actor swap/expiry/version mismatch denied; no network model call or grading write. |
| Existing behavior | Assignment grading profile, blank/artifact rules and workflow scoring regressions pass; existing DeepSeek option unchanged; all dormant flags remain off. |
| Transactional import, phase 1 | Complete source/grade revisions rechecked atomically; archive/removal/purge and concurrent teacher edit reject stale results; identical replay idempotent, changed replay conflicts; expired/revoked handle cannot write. Requires later assigned DB execution slot. |
| Review semantics, phase 1 | Explicit draft-only result leaves graded/returned/review status appropriate; pre-existing returned work cannot expose a replacement suggestion prematurely; student marks/feedback unchanged until teacher action. Requires later UI and database proof, both affected roles. |
| Transport, phase 1 | Synthetic STDIO initialize/list/call round-trip in Codex and Claude Code separately; tools only expose allow-listed behavior; session-expiry recovery is content-free; unsupported hosts are reported honestly. Requires later assigned runtime slot. |
| Calibration/canary, later | Separately authorized live model/student egress; small selected cohort, compare reviewed outcomes, report limits/failures and preserve model attribution uncertainty. No quality claim from synthetic tests. |

Implementation must complete focused checks, risk-matched independent review and
stable-SHA CI. No main merge or heavy browser/database/runtime proof runs until the
coordinator assigns the shared execution slot. Production release, provider/OAuth
activation, feature enablement and migrations remain separate gates.

## Planning delivery receipt

The source mapping uses one read-only native worker with inherited model/reasoning;
effective runtime settings and token attribution are unknown. Codex weekly usage
at planning start was 46% used (54% remaining); DeepSeek delegation was paused.
Coordinator verifies source claims and official docs, retains all edits and
records check/review results in the normal session log. This artifact establishes
the plan, not completion of any connector capability.
