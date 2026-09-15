# Classroom Pal context — Phase 2 UI brief

Reference: the existing student Achievements, companion and reward surfaces in
`StudentPalExperience`, with Pika's theme boundary and `ModalLayer`. Pattern Lab
was inspected locally on 2026-09-12; its Controls/dialog and PageState owners are
the executable shared references. No visual pattern or control API is changed.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Pet, world, achievements, rewards | Published Pal widget + theme boundary | reuse | Existing feature owners |
| Tokens, refresh, classroom switch | StudentPalExperience + Pal client | extend | Bind state to current generation |
| Celebration overlay | ModalLayer | reuse | Preserve focus, Escape and dismissal |

Primary signal: the selected classroom's own pet and progression. The server
supplies an opaque widget scope; changing generation resets the entire provider.
Academic content remains available if the optional integration fails.

Verification: teacher and student, 1440×900 desktop and 390×844 mobile, light and
dark. States: ordinary disabled path, active classroom A/B, delayed A response
after switching to B, pending celebration, reload, logout, denied membership and
provider failure. Teacher regression checks cover the shared classroom shell;
teachers do not receive membership tokens. Composite review preserves the
existing reward dialog's keyboard/focus contract.

Excluded: layout redesign, new dashboard, legacy-profile UI, cutover notices,
new icons or controls. No nearby duplication warrants extraction in this slice.
Verification on 2026-09-12: `e2e/pal-classroom-isolation.spec.ts` passed 14 tests
(two auth setup, four synthetic widget contracts, eight ordinary teacher/student
classroom regressions). All 12 screenshots in `output/playwright/pal-phase2/`
were visually inspected after waiting for classroom data to settle. Desktop and
mobile, both themes: legible content, no horizontal overflow and the existing
shell/widget layout preserved. Screenshots are local ignored artifacts.

Active widget evidence uses intercepted synthetic v1 responses and pinned local
badge assets; the real local rollout gates remain disabled. Unit/API tests cover
denied membership and provider failure. Actual database-backed active classroom
end-to-end evidence remains pending controlled rollout test authority; this fixture does not claim live provider compatibility.

Composite checklist reviewed: yes. Existing semantic dialog, Escape and focus
tests remain passing, with new scope/remount and late-refresh coverage. Keyboard
and semantic state covered: yes. Manual follow-up: the controlled active
classroom/provider integration evidence described above.
