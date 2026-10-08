# Grading poll recovery — 2026-10-08

Surface: teacher Assignment and Test grading after status is unavailable.
Reference: existing grading inline error banners and AppMessage loading owner;
stable teacher work-surface and feedback guidance. Desktop/mobile, light/dark.
Student: n/a; only teacher grading drivers change. States: active saved run,
unavailable status, reload recovery. Primary signal: existing error text and
removal of the blocking loading overlay. No new layout, controls, symbols,
composite interactions, experimental pattern, or canon promotion.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Status/recovery message | Assignment `error`, Test `gradingError` banner | reuse | Existing semantic error treatment fits unavailable status. |
| Loading feedback | Existing grading AppMessage overlay | reuse | Stop displaying a blocking spinner when browser retries end. |

Durable active-run state and mutation guards remain intact. Reload reconciles
with the saved run; a browser failure never marks server grading failed.

Visual evidence: eight Playwright captures of real fixture-route owners, with
synthetic API responses, at 1440×900 and 390×844 in both themes. Each verifies
the recovery banner after HTTP 403 and zero tick requests. Retained locally in
`output/playwright/`; screenshots and fixture code contain no real user data.
Focused component tests cover HTTP 401/403/404 and loading-overlay removal.
