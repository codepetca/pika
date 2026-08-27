# Classroom Feature Visibility

Teachers can tailor each classroom's navigation from **Settings → Features**. These controls hide unused workspaces without deleting their assignments, tests, grades, announcements, or other existing content.

## Sidebar Contract

| Feature preference | Teacher sidebar | Student sidebar | Hideable |
| --- | --- | --- | --- |
| Daily / Today | Daily | Today | No |
| Attendance | Attendance | — | Yes |
| Classwork | Assignments | Assignments | Yes |
| Tests | Tests | Tests | Yes |
| Gradebook | Gradebook | — | Yes, when Classwork or Tests is enabled |
| Calendar | Calendar | Calendar | Yes |
| Course Guide | Resources | Resources | Yes |
| Announcements | Announcements | Announcements | Yes |
| Achievements | — | Achievements | Yes, when Pal is available |
| Roster | Roster | — | No |
| Settings | Settings | — | No |

All preferences default to enabled so existing and newly created classrooms retain their current navigation after rollout. Missing keys are also treated as enabled for forward-compatible reads.

## Dependency Rules

- Gradebook is unavailable when both Classwork and Tests are hidden. Its stored preference is retained, so it returns automatically if either source feature is re-enabled.
- Achievements is shown only when both its classroom preference and the deployment's Pal integration are enabled.
- Daily/Today remains the safe fallback for invalid or newly hidden direct links.

## Enforcement Surfaces

One shared availability contract controls teacher and student sidebar items, mounted tab workspaces, direct-link redirects, tab prefetching, student notification counts, and assignment/announcement items embedded in Calendar. Hiding a feature does not authorize deletion and does not change its underlying API data or archive lifecycle.

## Rollout

Migration `128_classroom_feature_visibility.sql` adds the required `classrooms.feature_visibility` JSON object with a complete boolean shape constraint. Before the migration is applied, reads default safely to all features enabled and feature-setting writes return a migration-required service error instead of pretending to save.

The same migration extends the archive restore adapter: cold archives created before migration 128 receive the all-enabled default during restore, while archives created afterward preserve their saved classroom preference object.

Apply the migration through the schema rollout checklist, regenerate `src/types/database.generated.ts`, and run the database contract check before publishing.
