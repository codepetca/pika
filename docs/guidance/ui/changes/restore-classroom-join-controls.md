# Restore classroom join controls

Surface: classroom Settings > Access and the classroom join QR dialog, plus the
student `/join/[code]` open-join profile state and Attendance join handoff. Reference: the Settings Pattern
Lab mockup, the shared `SettingsSwitchRow`, `DialogPanel`, `QrCode`, `FormField`,
and `Input` contracts, and the existing classroom join success/error card.
Roles: teacher and student. Viewports: 1440×900 and 390×844. Themes: light and
dark. States: roster-only, open join, joining disabled, QR open, profile required,
join success, and join errors.

Primary signal: the join code is readable beside the existing join actions and
inside the QR dialog; admission policy remains an explicit switch. Must not add
attendance actions or make the classroom join QR resemble the attendance poster.
No new design-system pattern or human promotion is required. The composite-widget
checklist was reviewed because the change extends a dialog: keyboard behavior is
covered, semantic state is covered by tests, and no manual follow-up remains. The
shared dialog keyboard and ARIA contracts are unchanged.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Join code in Settings | Settings Pattern Lab join-code action | reuse | The approved mockup already owns the visible, copyable code treatment |
| Roster-only policy | `SettingsSwitchRow` and the existing classroom PATCH field | reuse | The persisted policy and canonical switch behavior already exist |
| Join code in QR | `TeacherClassroomJoinQrDialog` | extend | The feature-local dialog already owns classroom join semantics |
| Open-join identity form | `/join/[code]`, `FormField`, and `Input` | extend | The join route already returns `profile_required` and the page owns join outcomes |
| Attendance code entry | existing `/join/[code]` profile flow | reuse | A profile-required response hands off to the canonical join page instead of duplicating identity fields |
