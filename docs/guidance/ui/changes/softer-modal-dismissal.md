# Softer modal dismissal — 2026-10-06

Owner direction in chat `01a10bfa-17e1-76d2-9483-af955a51a9fd`: closing a modal feels too sharp/fast; continue the product-wide fluidity goal after the consolidated landing. #1490 landed as `3a0b17d6a34848043ee2dc48b57f8ed832ea6d95` with matching reviewed tree and all required gates. This bounded phase implements that closing refinement; broader route coverage remains incomplete.

Risk profile: workspace-state. Model recommendation: GPT-6.1 Sol/high — nested focus, retained presentation, timer races and child-lifetime boundaries. No dependency or production deployment is authorized by this brief. The owner's task approval override waives workflow review-budget/elapsed/low-usage stops while preserving correctness and existing holds.

## Reference and scope

Reference: canonical `ModalLayer`/`Dialog`, semantic motion tokens, Pattern Lab Core controls and the real Dialog entry comparison. The first rollout covers static AlertDialog and ConfirmDialog owners plus an explicit generic opt-in exercised by the real ContentDialog fixture. Generic editors and mobile drawers retain immediate removal until individually audited; conditional parent unmounts remain immediate. No stable UI canon promotion is implied for those wider adopters.

Roles: teacher and student. Viewports: 1440×900 and 390×844. Themes: light/dark. Motion: normal/reduced. States: open, header/action/backdrop/Escape close, nested close in either order, all layers close, rapid reopen, owner unmount, retained draft/presentation, disabled asynchronous confirmation and reduced motion during exit. Composite-widget checklist required: yes.

Primary signal: one brief opacity fade on the existing layer root, coordinating panel and backdrop. Logical close, navigation, commands, request invalidation, focus return, background inertness and scroll restoration respond immediately. Closed visual content is inert, aria-hidden and pointer-disabled. Use existing standard duration/easing; reduced motion removes the visual delay. Reopening cancels stale removal and snaps active. Do not animate scale, text geometry, resize or decorative movement.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Portal, stack, focus, isolation, scroll | ModalLayer | reuse | One canonical environment owner |
| Bounded visual exit | ModalLayer | extend | Distinguish logical open from passive presence |
| Duration, easing, reduced motion | Semantic motion tokens | reuse | Existing foundation supplies exact values |
| Static production adopters | AlertDialog / ConfirmDialog | extend | No retained editor or child request lifecycle |
| Direct comparison | DialogEntryPattern | extend | Exercise real owners with fixed fixtures |
| Generic editor/request ownership | Existing feature owners | reuse | Keep immediate removal until an explicit adoption audit |

Stable guidance followed: semantic tokens, canonical overlay owner, immediate commands/focus and reduced motion. Experimental guidance introduced: generic retained-presentation adoption and the Pattern Lab comparison. Human promotion needed for wider generic/editor/drawer adoption, not for silently changing all existing descendants. Stable guidance is not edited by this phase.

## Lifetime boundary

Retaining React children for an exit postpones their unmount cleanup. Inertness does not cancel effects, requests or widgets. The generic owner therefore defaults to `none`; an individually reviewed caller can request `opacity`. Static alert/confirmation descendants can fade without delaying feature-editor cleanup. The last committed open presentation prevents cleared titles/bodies or mode changes from producing a blank exit. Parent callbacks and feature selection still close immediately.

Nearby legacy fixed overlays and parent-unmounted Test previews are later migration/adoption candidates, not coverage from this change. Do not introduce detached live-widget clones or another global portal to hide those differences.

## Verification and execution

Before implementation, the coordinator captured eight both-role viewport/theme normal-motion references on the exact landing commit, with natural videos and RAF observations. In every case the modal disappeared by the first recorded frame (16.4–21.7ms); focus had returned and scroll/isolation were restored. This is a historical baseline, not post-change evidence.

Require meaningful component tests for logical/physical close, default immediate child cleanup, nested focus in both orders, reopen races, unmount, duplicate callbacks, disabled confirmation, semantic token duration and reduced motion. Verify both-role desktop/mobile light/dark normal/reduced states with before/midpoint/after screenshots that allow animations, natural recordings, real opacity/frame measurements and focus/inert/scroll assertions. Do not fake intermediate opacity or claim production performance improvements from local fixture timing.

Run required focused/static gates, Pika audit, risk-matched independent review and the stable-SHA draft-first PR lifecycle. Source work is permitted during the temporary #1512 main-merge hold; merge waits for its owner's landing/checkpoint release. Keep the existing user preview until a verified replacement is ready. Record final results in the coordinator's existing handoff and PR; this brief itself does not certify implementation or goal completion.
