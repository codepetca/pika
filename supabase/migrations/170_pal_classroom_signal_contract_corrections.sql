-- Forward-only correction:169 is already applied to shared local Pika.
-- Date output depends on session settings, so the calendar cannot be IMMUTABLE.
-- The visit result is deliberately ignored; source capture remains atomic.
begin;
set local lock_timeout = '5s';

alter function private.pal_membership_term_calendar(text,date) stable;

create or replace function public.record_pal_classroom_visit(p_student_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_now timestamptz := clock_timestamp();
begin
  v_context := public.resolve_pal_classroom_context(p_student_id, p_classroom_id);
  if v_context->>'status' <> 'active' then return jsonb_build_object('status', v_context->>'status'); end if;
  perform private.enqueue_membership_pal_fact(p_student_id, p_classroom_id,
    'platform.session.started', (v_now at time zone 'America/Toronto')::date::text,
    v_now, '{}'::jsonb);
  return jsonb_build_object('status', 'recorded');
end;
$$;

commit;
