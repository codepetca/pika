-- Keep the authoritative 334 mutation and its optional history seed in the same
-- transaction. No second history-plan RPC or second acquisition of parent locks.
begin;
create function public.test_learner_save_with_history_v1(
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
  v_mutation jsonb;
  v_result jsonb;
  v_plan jsonb;
  v_last jsonb;
  v_attempt_id uuid;
  v_revision bigint;
  v_attempt public.test_attempts%rowtype;
  v_history public.test_attempt_history%rowtype;
begin
  if p_operation is null or p_operation not in ('save','submit') then
    raise exception using errcode = 'PT400', message = 'test_learner_invalid_input';
  end if;
  -- 334 owns input validation, contextual authority, all mutation locks and CAS.
  -- Never catch/retry that call: a failed core write must remain a failed write.
  v_mutation := public.test_learner_self_mutation_v1(p_actor_id,p_test_id,p_operation,p_payload,p_deadline);
  v_result := pg_catalog.jsonb_build_object('mutation',v_mutation,'history',null);
  if v_mutation #> '{result,conflict}' = 'true'::jsonb
    or pg_catalog.clock_timestamp() >= v_deadline then
    return v_result;
  end if;
  if p_operation = 'save' and v_mutation #> '{result,created}' = 'false'::jsonb
    and v_mutation #> '{result,previous_responses}' = v_mutation #> '{result,attempt,responses}' then
    return v_result;
  end if;

  -- Only the optional read lives in this subtransaction. Cancellation, unavailable
  -- history, excess bytes or an expired phase may omit history, never undo or
  -- replay the successful core write. Its transaction locks are still held here.
  begin
    if p_operation = 'save' then
      v_attempt_id := (v_mutation #>> '{result,attempt,id}')::uuid;
      v_revision := (v_mutation #>> '{result,attempt,draft_revision}')::bigint;
      -- The authoritative under-lock save witness already contains this row.
      -- Do not fetch a second copy of its responses or acquire another lock.
      v_attempt.id := v_attempt_id;
      v_attempt.draft_revision := v_revision;
      v_attempt.responses := v_mutation #> '{result,attempt,responses}';
    else
      v_attempt_id := (v_mutation #>> '{result,attempt_id}')::uuid;
      v_revision := (v_mutation #>> '{result,draft_revision}')::bigint;
      select * into strict v_attempt from public.test_attempts
        where id = v_attempt_id and test_id = p_test_id and student_id = p_actor_id
          and draft_revision = v_revision;
    end if;
    select * into v_history from public.test_attempt_history
      where test_attempt_id = v_attempt.id order by created_at desc,id desc limit 1;
    -- Explicitly mirror private.test_learner_history_projection. service_role
    -- intentionally cannot execute that private helper. Do not widen its ACL.
    v_last := case when v_history.id is null then 'null'::jsonb else pg_catalog.jsonb_build_object(
      'id',v_history.id,'test_attempt_id',v_history.test_attempt_id,'patch',v_history.patch,'snapshot',v_history.snapshot,
      'word_count',v_history.word_count,'char_count',v_history.char_count,'paste_word_count',v_history.paste_word_count,
      'keystroke_count',v_history.keystroke_count,'trigger',v_history.trigger,'created_at',v_history.created_at) end;
    if pg_catalog.octet_length(v_last::text) > 2097152
      or pg_catalog.octet_length(v_attempt.responses::text) > 2097152
      or pg_catalog.clock_timestamp() >= v_deadline then
      return v_result;
    end if;
    v_plan := pg_catalog.jsonb_build_object('attempt_id',v_attempt.id,'draft_revision',v_attempt.draft_revision,'last_history',v_last);
    if p_operation = 'submit' then
      v_plan := v_plan || pg_catalog.jsonb_build_object('responses',v_attempt.responses);
    end if;
    -- Save already carries the exact responses in its unchanged mutation witness.
    -- Respect 257's complete-result wire cap, including this envelope's overhead.
    v_plan := pg_catalog.jsonb_build_object('mutation',v_mutation,'history',v_plan);
    if pg_catalog.octet_length(v_plan::text) <= 8388608
      and pg_catalog.clock_timestamp() < v_deadline then
      v_result := v_plan;
    end if;
  exception when query_canceled or others then
    null;
  end;
  return v_result;
end;
$function$;
alter function public.test_learner_save_with_history_v1(uuid,uuid,text,jsonb,timestamptz) owner to postgres;
revoke all on function public.test_learner_save_with_history_v1(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.test_learner_save_with_history_v1(uuid,uuid,text,jsonb,timestamptz) to service_role;
comment on function public.test_learner_save_with_history_v1(uuid,uuid,text,jsonb,timestamptz) is
  'Service-only own save/submit. Unchanged 334 mutation plus best-effort exact own history seed under its existing locks; subsequent history-write CAS is unchanged.';
commit;
