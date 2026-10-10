# Form dialog closing consistency — 2026-10-10

Approved fluidity continuation: bounded adoption after the accepted dialog lifetime audit. Risk: workspace-state. References: accepted modal/drawer closing slice (#1557), canonical ModalLayer opacity exit, and executable Pattern Lab Dialog entry (`src/app/__ui/DialogEntryPattern.tsx`). No shared default changes.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Presence, focus, scroll, inertness and reduced motion | ModalLayer via ContentDialog/DialogPanel | reuse | Existing 200ms opacity contract |
| Guide options adoption | CourseGuideOptionsDialog and CourseGuidePanel | extend | Passive fields/buttons; parent selects immediate removal across owner/denial boundaries |
| Save Classroom as Course Blueprint adoption | TeacherSettingsTab inline DialogPanel | extend | Passive fields/buttons; parent selects immediate removal across classroom boundaries |

Teacher desktop 1440×900 and mobile 390×844, light/dark, normal/reduced motion. States: normal cancel/header/Escape/backdrop as available, outgoing draft/error, rapid reopen, busy dismissal, reduced-motion immediate removal, owner replacement, and settings-section unmount. Guide additionally covers denied access, student replacement, dirty overview import guard, options→import active focus and return provenance. Blueprint additionally covers failed retry/cancel operation reset and immediate success navigation. Student adopter: n/a, teacher-only controls; read-only absence/role-boundary guard is checked.

Primary signal: existing scrim and panel fade together without changing layout. Parent draft/error resets, operation invalidation, generation fencing and replacement/navigation remain synchronous. Guide uses currentOwnerWork; Blueprint uses formStateReady. No descendant effects, requests, subscriptions, timers or editors are retained. No primitive, cleanup, backend, migration, dependency, activation, QR or navigation edits. Privacy priority 1 and calendar 1217 remain held.

Composite accessibility checklist applies: accessible names and keyboard behavior preserved; focus/isolation/scroll end at logical close; outgoing commands are captured; replacement dialog becomes immediately active; reduced motion removes immediately. Focused semantic evidence is recorded separately; coordinator owns native matrix capture, policy/final checks and review. No new pattern promotion or extraction is warranted for these two feature-owned forms.

Composite checklist reviewed: yes. Keyboard and semantic state covered by focused tests: yes. Native verification passed for 8 teacher contexts/16 closing interactions and 8 student absence guards; 48 screenshots, 16 natural videos, and 4 same-viewport Pattern Lab references. Complete passing teacher cases were source/media-hash verified and reused from an interrupted capture; student reads were recaptured with synthetic fixtures. The existing intermittent ActionBarMenu streamed-ID hydration warning was reproduced on unchanged parent #1557 code (baseline 1/12, changed 0/12 paired load contexts); this separate accessibility follow-up remains open and does not establish production occurrence. Final focused policy and independent review checks are recorded with the candidate.
