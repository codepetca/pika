# Stable classroom attendance QR

The teacher's Daily menu exposes a printable classroom QR, separate from the
existing occurrence-specific display. Rotation invalidates the previous poster;
teachers must print and replace it. The live display remains occurrence-specific.

## Security and rollout

- The public URL contains a random handle authenticated with a domain-separated
  MAC using `BARA_ATTENDANCE_ENTRY_TOKEN_SECRET`. It is a locator, not authorization.
  Rotating that environment secret also invalidates existing posters.
- Pika requires a student session, an enabled classroom, current enrollment and
  an active attendance participant mapping. It resolves an eligible scheduled
  window and its open projection, verifies enabled attendance policy and an active
  class day even while provider cancellation is syncing, then uses Bara presentation/check-in
  operations entirely server-side. Bara remains authoritative for check-in.
- No raw classroom UUID or reusable Bara token appears in the poster URL. Existing
  occurrence entry routes and their authorization contracts remain in place.
- Teacher view/create and rotate routes require classroom ownership and attendance
  access. Rotation uses an expected generation to reject concurrent stale writes.
  A failed/uncertain rotation removes the old preview and requires a fresh read
  before printing, downloading or rotating again.
- Handles are explicitly classified as non-portable locator state, excluded from
  classroom archives and Gradex. Soft archive retains them but disables resolution;
  authorized classroom deletion cascades them. A recreated/restored classroom
  requires a fresh poster rather than reviving a previously deleted locator.
- Apply migration `151_stable_classroom_attendance_qr.sql` before enabling use of
  the poster feature. Applied to local and Pika production on 2026-09-02 with
  explicit user approval. Both histories and read-only schema/access checks
  confirm migration 151. Preserve its applied filename and version during rebases;
  any future numbering collision requires coordinated history handling, not a rename.
  Without it, poster requests return a setup-unavailable error; there is no
  alternate storage fallback. Existing occurrence QR behavior remains available.
- The generated database contract was regenerated from local migration 151 and
  verified on 2026-09-02. Read-only database checks confirmed the table, constraints,
  row-level security and service-role-only application grants. Migration history
  was independently checked because the current CLI's formatted/JSON output is
  not reliably recognized by the existing pipe-table drift guard. A fresh full
  migration replay and real-stack smoke remain final PR verification requirements.

## UI acceptance and ownership

Reference: Daily attendance, the shared ContentDialog/ConfirmDialog contracts,
and Pattern Lab Controls. Primary signal: a large, square, dark-on-light code
with a quiet zone; do not add new attendance statuses, raw theme colors, or new
overlay behavior. No experimental shared pattern or human promotion is proposed.

| Need | Candidate | Decision | Reason |
|---|---|---|---|
| Modal frame and rotation warning | ContentDialog / ConfirmDialog | reuse | Shared focus, Escape and dismissal |
| Large QR rendering | QrCode | extend | Opt-in full-size SVG, unchanged default consumers |
| Full display panel | ContentDialog | extend | Opt-in panel classes, unchanged default sizing |
| Student feedback | StudentAttendanceCheckIn | reuse | Existing status and retry presentation |

The print-only body portal is not an interactive overlay; it isolates the poster
from the application during printing. Printable and downloaded codes resolve to
dark-on-white independently of the active theme. Feature state stays outside
`src/ui`. QR viewport geometry is registered under the attendance design owner.

## Verification scope

Teacher and student fixtures cover desktop 1440×900 and mobile 390×844 in light
and dark. Browser contracts cover live QR sizing, poster view, rotation warning,
download, print isolation, and student loading/success/closed/revoked/roster/error
states. Focus and Escape contracts are tested through shared dialog owners.
Fixtures do not prove live Bara operation or real authenticated redirection;
API/server tests cover authorization boundaries separately. A real-stack smoke
test remains required after rollout. No new animation is introduced.

Screenshot provenance: 2026-09-02, feature worktree on main `cb797436`,
`test-results/experience-matrix-*` (fixture routes) and
`output/playwright/qr-gallery-*` (Pattern Lab). Artifacts are local, not product data.

After rebasing onto main `a068a846` (#1138), the teacher/student fixture matrix
was rerun: all eight role/viewport/theme cases passed. Refreshed poster and
student closed-state screenshots in `test-results/experience-matrix-*` were
visually inspected; the earlier Pattern Lab evidence remains unchanged.

Final integration review identified that the QR example also changes the frozen
teacher Pattern Lab contracts region. All eight teacher contracts references
(desktop/mobile, light/dark, Darwin/Linux) were refreshed from source `445f6a46`
on 2026-09-02 and visually inspected. Linux capture used Playwright 1.58.0 Noble
with `fonts-dejavu-core`, matching the existing reference setup. The intentional
difference is the Open QR example button (and its mobile row); assertions and
tolerances are unchanged. Student contract references are unchanged.
