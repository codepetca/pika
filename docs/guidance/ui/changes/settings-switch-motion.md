# Settings switch motion consistency

Surface: production `SettingsSwitch` / `SettingsSwitchRow`, including the
Teacher Settings rows and `TeacherGradebookVisibilityControl`.

Reference: existing production switch geometry and the shared fast color-response
contract in `src/ui/README.md`; semantic duration/easing in tokens.css. The actual
grade-visibility owner in Pattern Lab is baseline evidence. SettingsMockup's local
lookalike is excluded from proof and left as a later reuse candidate.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Native switch commands and checked state | SettingsSwitch | reuse | Existing button semantics, labels, focus and callbacks fit. |
| Track color and decorative knob movement | SettingsSwitch | extend | Use fast duration, standard easing and immediate reduced motion. |
| State examples | Actual switch row and grade-visibility owner | reuse | Fixed local state demonstrates both production variants. |

Primary signal: the existing track color and knob position. Labels stay stationary.
Do not add scale, text translation, delayed callbacks, timers, dependencies,
business rules, real grade visibility writes or a new shared primitive.

Teacher interaction is affected. Student result presentation is unchanged; both
Pattern Lab roles retain reference coverage. Verify desktop1440×900/mobile390×844,
light/dark, normal/reduced motion, off/on, keyboard activation, disabled/saving and
live preference changes. Composite accessibility review: preserve the existing
native button with role=switch, aria-checked, disabled and keyboard/focus contract.

Baseline on main8543543d9: the real mobile grade-visibility switch retains150ms
track/thumb transitions with both normal and reduced motion, using Tailwind's
default easing. Baseline driver/captures are retained privately. Existing semantic
and disabled/icon tests cover the unchanged command contract; browser measurements
must demonstrate150ms/standard easing normally, zero motion when reduced, immediate
checked state, stationary labels and unchanged geometry. No snapshot baseline or
threshold update is required. The independent state fixture sits outside the
stable catalog composition.
