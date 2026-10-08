# Calendar day interaction — 2026-10-07

Surface: existing LessonCalendar day presentation in the actual teacher/student Calendar lesson tab. Reference: the existing day layout, canonical DialogPanel/ModalLayer opacity exit, and semantic focus treatment for named reading regions. Pattern Lab real ContentDialog quiet entry/exit captured before implementation at `product-fluidity/calendar-day-interaction/pattern-reference.png`. Baseline investigative day captures may be compared only where source dependencies match; their programmatic scrolling is layout evidence, not native keyboard proof.

Risk: workspace-state. Roles teacher/student; viewports 1440×900 and 390×844; light/dark; normal/reduced motion (16 cases). States: open, reading focus, native PageDown/Space/ArrowDown, final reading line, Previous/Next and Left/Right, Escape/backdrop close, inert/hidden retained exit, immediate focus return, rapid reopening before the old deadline. Primary signal: canonical focus-visible ring on reading content and existing standard opacity dismissal.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Dialog environment and passive exit | DialogPanel / ModalLayer | reuse | Existing 200ms opacity contract preserves logical close and retained committed children |
| Keyboard reading access | Feature reading scroller | extend | Named explicit tab stop lets the canonical trap include native scrolling |
| Focus appearance | Semantic foundation focus tokens | reuse | Existing canonical focus-visible ring |
| Day movement and parent tabs | LessonCalendar / ClassroomPageClient | reuse | Existing feature navigation and selection stay immediate |

Composite checklist required/reviewed: yes. Test dialog naming, contained forward/reverse tab order, reading-region name, native scrolling without date changes, immediate logical close/retired day shortcuts, focus return, hidden inert exit and stale timer fence. No shared API, motion token, pattern promotion, dependency, business/save/auth/provider/schema/cache/read changes. Preserve heading, density, grid, parent tabs and day navigation. No broader icon/layout refactor. Nearby legacy small arrow targets remain a separate candidate.

Verification must distinguish jsdom semantic/lifetime tests from real browser native scrolling. Use the existing gated teacher-student fixture with synthetic lesson/event responses; abort and record every unexpected mutation. Settled screenshots require opacity1 and no closing state, animations allowed. Natural recordings/observations describe local Chromium only; no hardware performance, authenticated persistence, or whole Calendar-family coverage claim.

## Local result

Native Chromium matrix passed all16 cases (teacher/student × desktop/mobile × light/dark × normal/reduced). Native Tab and reverse Tab reach the region; PageDown, Home/Space and Home/ArrowDown scroll without changing the date, and repeated PageDown exposes the final lesson and event lines. Left/Right retain day navigation. Escape/backdrop restore focus immediately; normal frames retain inert/hidden presentation, reduced frames remove it immediately, and native rapid reopen reuses the retained normal root across the obsolete deadline. Settled focus/end/reopen screenshots use animations allowed; recordings and media/viewport/geometry/API/RAF records are external in `product-fluidity/calendar-day-interaction`. Both-role visual review passed; no panel/document overflow. Synthetic writes0 and pageerrors0.

Focused component suites49PASS, final semantic listener-retirement suite13PASS; required focused workflow386PASS and architecture/UI/design/TypeScript/lint gates passed. Staged TS audit passed. Before binding:14/15 audit paths byte-match base a2d70efa8; the only difference is the unused Course Guide fixture opt-in branch in d058. Production Calendar/dialog dependencies match. Failed pre-hydration asset runs and the pointerdown observer failure remain retained, with two bounded correction batches. This verifies this scoped adopter in local Chromium; it does not certify hardware timing, real authentication persistence, or the whole Calendar family. Coordinator owns independent review, publication and integration.
