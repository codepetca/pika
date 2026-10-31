# Named attendance schedules

QR attendance uses the classroom timing policy as its regular schedule. A teacher can save named alternatives and select one for a class day. An unassigned day uses the regular policy. Selection is scoped to the selected class date; changes to a named schedule affect its future, unfrozen assignments. Once an occurrence is due or opened, its recorded timing remains frozen. A newly selected schedule can already be in its check-in window, provided that the previous occurrence is not frozen and the selected window has not closed.

Schedule mutations advance the classroom policy revision and are included in the schedule source token. Sync materializes the selected policy per day and preserves stored frozen cutoffs. A saved selection is not confirmation of provider delivery: the client reports delivery failure and must retry sync. Manual/log attendance retains its separate timing settings.

## Rollout

Migration `296_attendance_named_schedules.sql` must be applied and verified before application code using the new schedule tables is deployed. Otherwise attendance schedule sync will fail closed. Migration application requires the repository's separate one-time, exact-target authorization. Do not reset the shared database. Validate the migration and decommission lifecycle with the repository's database test harness before release, and verify a local teacher selection, synced QR check-in, and unchanged regular-day behavior.
