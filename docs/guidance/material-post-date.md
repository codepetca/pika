# Material post dates

Teachers can open an already-posted Classwork material, change **Post date
(Toronto)**, and click **Save** to move it to that day in both classroom
calendars. Today and earlier dates use the backdating operation. A future date
changes the primary action to **Schedule** and releases at midnight
America/Toronto on that day. The field explains that the material becomes
hidden from students until then. This uses the existing `scheduled_for`
operation, leaving the backdating API contract unchanged. The separate
Schedule picker remains available for a specific time. Drafts and scheduled
materials do not show the post-date field.

## Persistence and rollout

`PATCH /api/teacher/classrooms/:id/materials/:materialId` accepts `posted_on`
as a real `YYYY-MM-DD` date in years 0001–9999, no later than today in
America/Toronto. It cannot accompany `scheduled_for` (including null) or
`is_draft: true`. The locked owner operation rejects drafts, future releases,
nonowners, archived classrooms, and lifecycle conflicts.

Migration `289_material_post_date.sql` extends the existing JSON patch contract
of `update_classwork_material_for_owner_v1`. It stores Toronto midnight of the
chosen date in `released_at`. The existing calendars already read this field;
`created_at`, content, order, author, and artifact lineage retain their existing
contracts. Historical published rows with no release date display their creation
date until explicitly changed. Ordinary saves preserve the release timestamp.

Apply migration 289 before deploying this application change. Without it,
post-date changes fail closed; existing save and scheduling requests retain their
old contract. No column, table, RPC signature, generated type, background job,
or browser database access is added. Migration application still requires the
separate exact-target authorization in the schema rollout checklist.

Announcements have the same explicit post-date option; see
[announcement post dates](./announcement-post-date.md).

## UI brief and verification

- Surface/reference: existing Material dialog, assignment-style details/content
  panes, and `/pattern-lab` Material creation example.
- Primary signal: the standard labeled date field beside existing details.
- Roles: teacher editor; student calendar placement uses the unchanged reader.
- Viewports/themes: desktop and mobile, light and dark.
- States: published edit, focused/changed date, empty/future invalid date,
  saving/read-only, save failure, explicit Save, and draft/schedule transitions.
- Shared owners: reuse `FormField`, `Input`, and `SplitButton`; extend the
  material-owned dialog. No new shared component or experimental pattern.
- Composite review: retain the existing chooser keyboard/focus contract; its
  trigger stays available when only the primary Save has an invalid date.
- Exclusions: no new editor shell, due date, automatic save, announcement changes,
  or unrelated refactor. No additional shared extraction is justified here.

Focused API/server tests cover validation, returned date binding, and DST;
component tests cover the production editor, outgoing PATCH/cache invalidation,
and movement between calendar days for editable/read-only views. The Pattern Lab
browser case `changes a posted material calendar date on explicit Save` captures
valid/focused and invalid states across all four viewport/theme projects.
Student editor screenshots are n/a because students cannot edit material dates;
both calendar modes are covered by the day-placement regression.

Dev-flow risk profile: `none`. Review risk: standard application behavior and
routine JSON patch extension; authorization and immutable-row guards are retained.
