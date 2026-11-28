-- Discover the Test parent without a separate locked inspect transaction.
-- The existing workflow acquires all of its locks and rechecks that exact parent.
begin;
create function public.test_learner_self_mutation_v1(
  p_actor_id uuid, p_test_id uuid, p_operation text, p_payload jsonb, p_deadline timestamptz
) returns jsonb
language plpgsql volatile security invoker
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_deadline timestamptz := least(p_deadline, v_started + interval '8 seconds');
  v_classroom_id uuid;
begin
  if p_actor_id is null or p_test_id is null or p_operation is null
    or p_operation not in ('start','save','submit','focus')
    or p_payload is null or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload ? 'requested_student_id' or pg_catalog.octet_length(p_payload::text) > 2097152
    or p_deadline is null or not pg_catalog.isfinite(p_deadline) or p_deadline > v_started + interval '30 seconds' then
    raise exception using errcode = 'PT400', message = 'test_learner_invalid_input';
  end if;
  if v_started >= v_deadline then
    raise exception using errcode = 'PT503', message = 'test_learner_deadline';
  end if;

  begin
    select t.classroom_id into v_classroom_id from public.tests t where t.id = p_test_id;
  exception when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'PT409', message = 'test_learner_busy';
  end;
  if not found then
    raise exception using errcode = 'PT404', message = 'test_learner_not_found';
  end if;
  return public.test_learner_workflow_v1(p_actor_id, p_test_id, v_classroom_id, p_operation, p_payload, v_deadline);
end;
$function$;
alter function public.test_learner_self_mutation_v1(uuid,uuid,text,jsonb,timestamptz) owner to postgres;
revoke all on function public.test_learner_self_mutation_v1(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.test_learner_self_mutation_v1(uuid,uuid,text,jsonb,timestamptz) to service_role;
comment on function public.test_learner_self_mutation_v1(uuid,uuid,text,jsonb,timestamptz) is
  'Service-only self-member start/save/submit/focus. Binds the discovered parent to the existing locked mutation; no separate inspect.';
commit;
