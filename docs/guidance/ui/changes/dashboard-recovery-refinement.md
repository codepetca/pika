# Dashboard recovery refinement

Surface: teacher Dashboard classroom choices, attendance loading, and surviving student-log dialog after retry. Reference: canonical Pattern Lab Button, PageState and ContentDialog, plus Dashboard's existing error/retry states. Teacher only; student n/a because this route and owner require teacher role. Desktop1440×900/mobile390×844, light/dark, actual normal/reduced motion. States: loading/error/retry/ready/empty, keyboard focus, user-moved focus, selected classroom, close/reopen and older read. Primary signal: existing semantic action/selection accents and named loading status. Do not add chrome, provider/auth changes, new dialogs, calendar/gradebook changes or new shared overlay contracts. Composite accessibility review: yes; native and meaningful component regressions required.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| 44px classroom actions | shared Button | reuse | Existing control minimum dimensions and keyboard focus apply unchanged |
| Attendance loading status | compact PageState | reuse | Existing feature-owned label, polite live status and busy semantics |
| Retry focus handoff | ContentDialog plus local content region | extend | Dashboard retires its retry child; a feature-local focus region preserves keyboard ownership without changing ModalLayer |

Before code: frozen baseline227eab768; accepted dashboard-owner-native-closure captured8/8 with measured BODY focus after retry, unlabeled attendance spinner and20/40px buttons. Shared contracts remain unchanged; no snapshot refresh or experimental promotion needed. Final native evidence uses an immutable commit and external harness with synthetic business reads and sanctioned local test session only.

Coordinator-authorized product remediation1: bad37ed268 captured8 semantic cases with ready/empty handoff, but its outside content-region focus ring was clipped by the dialog scroller. Preserve that complete evidence as pre-focus-ring-correction. The local content region now uses canonical inset ring plus constant p-1 clearance, keeping text legible without changing shared overlay semantics. Recheck meaningful tests/policies and freeze a new commit before rerunning the same corrected external native helper; no further product/native corrections authorized.
