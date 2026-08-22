-- Retire the unscoped attendance worker/event capabilities superseded by
-- migration 129. The functions remain for migration compatibility and for
-- calls made inside scoped SECURITY DEFINER wrappers, but service-role callers
-- must enter through the teacher/classroom-bound variants.

revoke all on function public.list_attendance_sync_targets_v1(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.list_attendance_reconciliation_targets_v1(
  timestamptz, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.claim_attendance_outbox_batch_v1(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.attendance_outbox_health_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.apply_attendance_event_v1(jsonb, text)
  from public, anon, authenticated, service_role;
