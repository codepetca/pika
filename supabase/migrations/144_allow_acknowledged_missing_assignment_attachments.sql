-- Keep the student's missing-attachment acknowledgement inside the same locked
-- transaction that marks the assignment document submitted. Present invalid or
-- inaccessible artifacts remain blockers regardless of acknowledgement.

create or replace function private.validate_assignment_submission_requirements(
  p_doc public.assignment_docs,
  p_acknowledged_missing_requirement_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_missing_requirement_ids uuid[];
  v_distinct_acknowledgement_count integer;
begin
  if exists (
    select 1
    from public.assignment_submission_requirements r
    join public.assignment_submission_artifacts a
      on a.requirement_id = r.id
      and a.assignment_doc_id = p_doc.id
      and a.student_id = p_doc.student_id
      and a.type = r.type
    where r.assignment_id = p_doc.assignment_id
      and (
        case
          when r.type = 'image' then
            coalesce(nullif(btrim(a.storage_path), ''), nullif(btrim(a.url), '')) is null
          else nullif(btrim(coalesce(a.url, '')), '') is null
        end
        or a.validation_status in ('invalid', 'inaccessible')
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'assignment_submission_requirements_incomplete';
  end if;

  select coalesce(array_agg(r.id order by r.id), '{}'::uuid[])
  into v_current_missing_requirement_ids
  from public.assignment_submission_requirements r
  left join public.assignment_submission_artifacts a
    on a.requirement_id = r.id
    and a.assignment_doc_id = p_doc.id
    and a.student_id = p_doc.student_id
    and a.type = r.type
  where r.assignment_id = p_doc.assignment_id
    and (
      a.id is null
      or case
        when r.type = 'image' then
          coalesce(nullif(btrim(a.storage_path), ''), nullif(btrim(a.url), '')) is null
        else nullif(btrim(coalesce(a.url, '')), '') is null
      end
    );

  if p_acknowledged_missing_requirement_ids is not null then
    select count(distinct acknowledged_id)
    into v_distinct_acknowledgement_count
    from unnest(p_acknowledged_missing_requirement_ids) as acknowledged(acknowledged_id);

    if cardinality(p_acknowledged_missing_requirement_ids) <> v_distinct_acknowledgement_count
      or cardinality(p_acknowledged_missing_requirement_ids) <> cardinality(v_current_missing_requirement_ids)
      or exists (
        select 1
        from unnest(p_acknowledged_missing_requirement_ids) as acknowledged(acknowledged_id)
        where not (acknowledged_id = any(v_current_missing_requirement_ids))
      )
      or exists (
        select 1
        from unnest(v_current_missing_requirement_ids) as missing(missing_id)
        where not (missing_id = any(p_acknowledged_missing_requirement_ids))
      ) then
      raise exception using
        errcode = '23514',
        message = 'assignment_submission_requirements_missing';
    end if;
  end if;
end;
$$;

-- The trigger remains the final guard against present invalid artifacts. Missing
-- requirements are decided by the submission RPC below, where the acknowledgement
-- is evaluated while the assignment advisory lock and document row lock are held.
create or replace function public.validate_assignment_submission_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.validate_assignment_submission_requirements(new, null::uuid[]);
  return new;
end;
$$;

create or replace function private.submit_assignment_doc_atomic_v2(
  p_assignment_id uuid,
  p_student_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_word_count integer,
  p_char_count integer,
  p_acknowledged_missing_requirement_ids uuid[],
  p_emit_pal_event boolean,
  p_pal_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_doc public.assignment_docs;
  v_history public.assignment_doc_history;
begin
  if p_assignment_id is null or p_student_id is null or p_content is null
    or p_expected_updated_at is null then
    raise exception 'Invalid assignment document submission request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  select * into v_doc
  from public.assignment_docs
  where assignment_id = p_assignment_id and student_id = p_student_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_doc_missing',
      'error', 'No work to submit. Please save your work first.'
    );
  end if;

  if v_doc.is_submitted then
    if v_doc.content = p_content then
      select * into v_history
      from public.assignment_doc_history
      where assignment_doc_id = v_doc.id
        and trigger = 'submit'
        and created_at >= coalesce(v_doc.submitted_at, '-infinity'::timestamptz)
        and patch is null
        and snapshot = v_doc.content
      order by created_at desc, id desc
      limit 1;

      if not found then
        insert into public.assignment_doc_history (
          assignment_doc_id, patch, snapshot, word_count, char_count,
          paste_word_count, keystroke_count, trigger, created_at
        ) values (
          v_doc.id, null, v_doc.content, coalesce(p_word_count, 0), coalesce(p_char_count, 0),
          0, 0, 'submit', clock_timestamp()
        ) returning * into v_history;
      end if;

      return jsonb_build_object(
        'ok', true, 'idempotent', true, 'doc', to_jsonb(v_doc),
        'history_entry', to_jsonb(v_history)
      );
    end if;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_submitted',
      'error', 'This assignment is already submitted and cannot be changed.'
    );
  end if;

  if v_doc.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_revision_conflict',
      'error', 'Your saved draft changed before submission. Review it and try again.'
    );
  end if;

  perform private.validate_assignment_submission_requirements(
    v_doc,
    coalesce(p_acknowledged_missing_requirement_ids, '{}'::uuid[])
  );

  update public.assignment_docs
  set content = p_content,
      is_submitted = true,
      submitted_at = clock_timestamp()
  where id = v_doc.id and is_submitted is false
  returning * into v_doc;

  insert into public.assignment_doc_history (
    assignment_doc_id, patch, snapshot, word_count, char_count,
    paste_word_count, keystroke_count, trigger, created_at
  ) values (
    v_doc.id, null, p_content, coalesce(p_word_count, 0), coalesce(p_char_count, 0),
    0, 0, 'submit', clock_timestamp()
  ) returning * into v_history;

  if p_emit_pal_event then
    perform private.enqueue_pal_event(
      p_student_id,
      'assignment_first_completion',
      p_assignment_id::text,
      p_pal_event
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'doc', to_jsonb(v_doc),
    'history_entry', to_jsonb(v_history)
  );
end;
$$;

create or replace function public.submit_assignment_doc_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_word_count integer,
  p_char_count integer,
  p_acknowledged_missing_requirement_ids uuid[]
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select private.submit_assignment_doc_atomic_v2(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at,
    p_word_count, p_char_count, coalesce(p_acknowledged_missing_requirement_ids, '{}'::uuid[]),
    false, null
  );
$$;

-- Preserve the pre-migration call shape. Old app instances remain strict by default.
create or replace function public.submit_assignment_doc_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_word_count integer,
  p_char_count integer
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select public.submit_assignment_doc_atomic(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at,
    p_word_count, p_char_count, '{}'::uuid[]
  );
$$;

create or replace function public.submit_assignment_doc_with_pal_event_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_word_count integer,
  p_char_count integer,
  p_pal_event jsonb,
  p_acknowledged_missing_requirement_ids uuid[]
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select private.submit_assignment_doc_atomic_v2(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at,
    p_word_count, p_char_count, coalesce(p_acknowledged_missing_requirement_ids, '{}'::uuid[]),
    true, p_pal_event
  );
$$;

-- Preserve the pre-migration Pal call shape with the same strict default.
create or replace function public.submit_assignment_doc_with_pal_event_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_word_count integer,
  p_char_count integer,
  p_pal_event jsonb
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select public.submit_assignment_doc_with_pal_event_atomic(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at,
    p_word_count, p_char_count, p_pal_event, '{}'::uuid[]
  );
$$;

drop function if exists private.validate_assignment_submission_requirements(public.assignment_docs);

revoke all on function private.validate_assignment_submission_requirements(public.assignment_docs, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.submit_assignment_doc_atomic_v2(uuid, uuid, jsonb, timestamptz, integer, integer, uuid[], boolean, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, uuid[])
  from public, anon, authenticated;
revoke all on function public.submit_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, integer, integer)
  from public, anon, authenticated;
revoke all on function public.submit_assignment_doc_with_pal_event_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, jsonb, uuid[])
  from public, anon, authenticated;
revoke all on function public.submit_assignment_doc_with_pal_event_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, jsonb)
  from public, anon, authenticated;

grant execute on function public.submit_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, uuid[])
  to service_role;
grant execute on function public.submit_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, integer, integer)
  to service_role;
grant execute on function public.submit_assignment_doc_with_pal_event_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, jsonb, uuid[])
  to service_role;
grant execute on function public.submit_assignment_doc_with_pal_event_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, jsonb)
  to service_role;

comment on function private.validate_assignment_submission_requirements(public.assignment_docs, uuid[]) is
  'Validates present assignment artifacts and rejects every missing configured artifact not named in the transaction-bound acknowledgement set.';
comment on function private.submit_assignment_doc_atomic_v2(uuid, uuid, jsonb, timestamptz, integer, integer, uuid[], boolean, jsonb) is
  'Shared locked assignment submission implementation with scoped missing-requirement acknowledgements and optional Pal outbox enqueue.';
comment on function public.submit_assignment_doc_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, uuid[]) is
  'Atomically submits an assignment document and evaluates exact missing-requirement acknowledgements under the assignment lock.';
comment on function public.submit_assignment_doc_with_pal_event_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, jsonb, uuid[]) is
  'Atomically submits an assignment document, evaluates exact missing-requirement acknowledgements under lock, and enqueues the Pal completion event.';
