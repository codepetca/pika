-- Establish one portable Test-question identity from draft creation onward.
--
-- TestDraftQuestion intentionally has no persisted position field. Migrations 112
-- and 114 treated a missing position as zero while attaching stable identities,
-- so a multi-question Test repeatedly updated question zero and collided with the
-- per-Test artifact-id uniqueness constraint. Keep the public managed-storage
-- wrapper from migration 117 intact and replace its private implementation plus
-- the archived-Classroom reuse RPC with stable-identity validation. Persisted question
-- positions can contain gaps after deletion, and saved drafts can add, remove,
-- or reorder questions before test_questions is synchronized on activation.
-- Backfill legacy draft row IDs once, preferring their exact historical row
-- identity before portable-identity fallback, and tolerate draft-only questions.
-- Capture validates source identity without assigning or rewriting it.

do $$
declare
  v_draft record;
  v_question jsonb;
  v_question_id uuid;
  v_question_row_id uuid;
  v_question_row_ids uuid[];
  v_portable_id uuid;
  v_questions jsonb;
  v_changed boolean;
  v_is_portable boolean;
  v_claimed_row_ids uuid[];
  v_seen_portable_ids uuid[];
begin
  -- Backfill and version fencing must be one atomic schema operation. Application
  -- saves lock the Draft row before writing questions, so fence Draft writers
  -- first with a mode that conflicts with SELECT FOR UPDATE. This waits behind
  -- any in-flight save before holding the question-table fence and prevents a
  -- Draft-row/question-table lock-upgrade deadlock. Plain readers remain allowed.
  lock table public.assessment_drafts in exclusive mode;
  lock table public.test_questions in share row exclusive mode;

  -- Rewriting a legacy draft row ID to its portable question identity does not
  -- change the authored Test. Suppress the structural-revision trigger while
  -- the migration owns both fences so a concurrent save cannot hold Classroom
  -- and wait on Draft while this backfill waits on that same Classroom.
  perform set_config('pika.identity_mapping', 'on', true);

  for v_draft in
    select id, assessment_id, content
    from public.assessment_drafts
    where assessment_type = 'test'
  loop
    v_questions := '[]'::jsonb;
    if v_draft.content ? 'question_identity_version'
      and v_draft.content->'question_identity_version' is distinct from '1'::jsonb
    then
      raise exception 'Unsupported Test question identity version'
        using errcode = '22023';
    end if;
    v_is_portable := coalesce(
      v_draft.content->'question_identity_version' = '1'::jsonb,
      false
    );
    v_changed := not v_is_portable;
    v_claimed_row_ids := array[]::uuid[];
    v_seen_portable_ids := array[]::uuid[];

    for v_question in
      select question.value
      from jsonb_array_elements(
        coalesce(v_draft.content->'questions', '[]'::jsonb)
      ) with ordinality as question(value, ordinal)
      order by question.ordinal
    loop
      if coalesce(v_question->>'id', '') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then
        raise exception 'Legacy Test draft question identity is not UUIDv4'
          using errcode = '22023';
      end if;
      v_question_id := (v_question->>'id')::uuid;
      v_portable_id := v_question_id;
      v_question_row_id := null;
      v_question_row_ids := null;

      -- Before portable draft identities existed, draft question IDs were the
      -- persisted row IDs. Preserve that exact contract first. Migrations 112
      -- and 114 could stamp question zero with a later row's ID as portable
      -- identity, so combining row and portable matches in one set makes valid
      -- legacy data look ambiguous. This precedence is identity-based: it does
      -- not inspect position or content.
      if not v_is_portable then
        select source_question.id
        into v_question_row_id
        from public.test_questions as source_question
        where source_question.test_id = v_draft.assessment_id
          and source_question.id = v_question_id;
      end if;

      if v_question_row_id is null then
        select array_agg(source_question.id order by source_question.id)
        into v_question_row_ids
        from public.test_questions as source_question
        where source_question.test_id = v_draft.assessment_id
          and (
          source_question.artifact_id = v_question_id
          or source_question.source_artifact_id = v_question_id
          );

        if coalesce(cardinality(v_question_row_ids), 0) > 1 then
          raise exception 'Legacy Test draft question identity backfill is ambiguous'
            using errcode = '22023';
        elsif coalesce(cardinality(v_question_row_ids), 0) = 1 then
          v_question_row_id := v_question_row_ids[1];
        end if;
      end if;

      if v_question_row_id is not null then
        if v_question_row_id = any(v_claimed_row_ids) then
          raise exception 'Legacy Test draft question identity backfill reuses one row'
            using errcode = '22023';
        end if;
        v_claimed_row_ids := array_append(v_claimed_row_ids, v_question_row_id);

        select coalesce(
          source_question.source_artifact_id,
          source_question.artifact_id,
          source_question.id
        )
        into v_portable_id
        from public.test_questions as source_question
        where source_question.id = v_question_row_id;

        if v_portable_id::text !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then
          raise exception 'Legacy Test draft resolved portable identity is not UUIDv4'
            using errcode = '22023';
        end if;

        if v_is_portable and v_question_id is distinct from v_portable_id then
          raise exception 'Portable Test draft question identity does not match persisted lineage'
            using errcode = '22023';
        elsif v_question_id is distinct from v_portable_id then
          v_question := jsonb_set(
            v_question,
            '{id}',
            to_jsonb(v_portable_id),
            false
          );
          v_changed := true;
        end if;
      end if;

      if v_portable_id = any(v_seen_portable_ids) then
        raise exception 'Legacy Test draft question identity backfill produces duplicate portable identity'
          using errcode = '22023';
      end if;
      v_seen_portable_ids := array_append(v_seen_portable_ids, v_portable_id);

      v_questions := v_questions || jsonb_build_array(v_question);
    end loop;

    if v_changed then
      update public.assessment_drafts
      set
        content = jsonb_set(
          jsonb_set(content, '{questions}', v_questions, false),
          '{question_identity_version}',
          '1'::jsonb,
          true
        ),
        version = public.assessment_drafts.version + 1
      where id = v_draft.id;
    end if;
  end loop;

  perform set_config('pika.identity_mapping', 'off', true);
end;
$$;

-- Question rows are the student-facing source of truth after activation. Keep
-- them editable while an active/closed Test has no student work, but freeze the
-- set as soon as an attempt exists. Locking the Test first makes this check
-- serialize with the attempt RPCs from migration 088.
create or replace function public.lock_test_parent_for_child_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_test_id uuid;
  v_test_ids uuid[];
begin
  if tg_op = 'DELETE' then
    v_test_id := old.test_id;
  else
    v_test_id := new.test_id;
  end if;

  -- Parent cascades already own the Test row and must remain recoverable.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  -- Generated AI references are operational cache data, not authored Test
  -- content. They remain reusable after student work exists and do not belong
  -- in Blueprint revisions. Compare the complete records minus that explicit
  -- allowlist (and the automatic timestamp) so every current or future
  -- authored/identity field remains frozen by default.
  if tg_table_name = 'test_questions'
    and tg_op = 'UPDATE'
    and (
      to_jsonb(new) - array[
        'ai_reference_cache_key',
        'ai_reference_cache_answers',
        'ai_reference_cache_model',
        'ai_reference_cache_generated_at',
        'updated_at'
      ]::text[]
    ) is not distinct from (
      to_jsonb(old) - array[
        'ai_reference_cache_key',
        'ai_reference_cache_answers',
        'ai_reference_cache_model',
        'ai_reference_cache_generated_at',
        'updated_at'
      ]::text[]
    )
  then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.test_id is distinct from new.test_id then
    v_test_ids := array[old.test_id, new.test_id];
  else
    v_test_ids := array[v_test_id];
  end if;

  perform 1
  from public.tests test
  where test.id = any(v_test_ids)
  order by test.id
  for update;

  if tg_table_name = 'test_questions'
    and exists (
      select 1
      from public.tests test
      where test.id = any(v_test_ids)
        and test.status in ('active', 'closed')
        and (
          exists (
            select 1
            from public.test_attempts attempt
            where attempt.test_id = test.id
          )
          or exists (
            select 1
            from public.test_responses response
            where response.test_id = test.id
          )
        )
    )
  then
    raise exception using
      errcode = '55000',
      message = 'test_questions_locked: Test questions cannot be changed after student work exists';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Test authoring writes and activation share the same parent-row lock. This
-- makes their order explicit: a draft save that owns the lock first is included
-- in activation, while stale activation fails its draft-version fence. Saves
-- after activation synchronize the already-materialized rows instead.
create or replace function public.save_test_draft_atomic(
  p_teacher_id uuid,
  p_test_id uuid,
  p_expected_draft_version integer,
  p_content jsonb,
  p_update_documents boolean,
  p_expected_documents jsonb,
  p_documents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived_at timestamptz;
  v_cleanup_paths jsonb := '[]'::jsonb;
  v_draft public.assessment_drafts%rowtype;
  v_matched_row_id uuid;
  v_matched_row_ids uuid[];
  v_owner_id uuid;
  v_portable_id uuid;
  v_question jsonb;
  v_question_id uuid;
  v_retained_row_ids uuid[] := array[]::uuid[];
  v_seen_question_ids uuid[] := array[]::uuid[];
  v_test public.tests%rowtype;
begin
  if p_expected_draft_version is null or p_expected_draft_version < 1 then
    raise exception using errcode = '22023', message = 'invalid_draft_version';
  end if;
  if jsonb_typeof(p_content) is distinct from 'object'
    or jsonb_typeof(p_content->'questions') is distinct from 'array'
    or jsonb_typeof(p_content->'show_results') is distinct from 'boolean'
    or (
      p_content ? 'question_identity_version'
      and p_content->'question_identity_version' is distinct from '1'::jsonb
    )
    or nullif(btrim(p_content->>'title'), '') is null
  then
    raise exception using errcode = '22023', message = 'invalid_draft_content';
  end if;
  if p_update_documents and (
    jsonb_typeof(coalesce(p_expected_documents, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_documents, '[]'::jsonb)) <> 'array'
  ) then
    raise exception using errcode = '22023', message = 'invalid_documents';
  end if;

  select test.* into v_test
  from public.tests test
  where test.id = p_test_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_not_found';
  end if;

  -- Keep archive and authoring mutually exclusive through commit. Draft and
  -- question triggers update this Classroom's structural revision, so take the
  -- update lock now instead of upgrading a shared lock after another Test save
  -- in the same Classroom has acquired it.
  select classroom.teacher_id, classroom.archived_at
    into v_owner_id, v_archived_at
  from public.classrooms classroom
  where classroom.id = v_test.classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_classroom_not_found';
  end if;
  if v_owner_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  if v_archived_at is not null or v_test.blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'test_archived';
  end if;
  if v_test.status not in ('draft', 'active', 'closed') then
    raise exception using errcode = '22023', message = 'invalid_test_status';
  end if;

  select draft.*
    into v_draft
  from public.assessment_drafts draft
  where draft.assessment_type = 'test'
    and draft.assessment_id = p_test_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_draft_not_found';
  end if;
  if v_draft.version is distinct from p_expected_draft_version then
    raise exception using errcode = '40001', message = 'draft_version_conflict';
  end if;
  if p_update_documents and coalesce(v_test.documents, '[]'::jsonb)
    is distinct from coalesce(p_expected_documents, '[]'::jsonb)
  then
    raise exception using errcode = '40001', message = 'document_conflict';
  end if;

  -- Portable identity is a draft-document invariant, not merely a
  -- materialization invariant. Validate it before either draft-only persistence
  -- or active/closed row synchronization so activation can never inherit an
  -- identity that this function itself accepted but cannot later consume.
  for v_question in
    select question.value
    from jsonb_array_elements(p_content->'questions')
      with ordinality as question(value, ordinality)
    order by question.ordinality
  loop
    if coalesce(v_question->>'id', '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception using errcode = '22023', message = 'invalid_draft_content';
    end if;
    v_question_id := (v_question->>'id')::uuid;
    if v_question_id = any(v_seen_question_ids) then
      raise exception using errcode = '22023', message = 'duplicate_question_identity';
    end if;
    v_seen_question_ids := array_append(v_seen_question_ids, v_question_id);
  end loop;

  if p_update_documents then
    select coalesce(jsonb_agg(path order by path), '[]'::jsonb)
      into v_cleanup_paths
    from (
      select distinct old_document.value->>'snapshot_path' as path
      from jsonb_array_elements(coalesce(v_test.documents, '[]'::jsonb)) old_document(value)
      where old_document.value->>'snapshot_path' like 'link-docs/%/snapshots/%'
        and not exists (
          select 1
          from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) new_document(value)
          where new_document.value->>'snapshot_path'
            = old_document.value->>'snapshot_path'
        )
    ) obsolete;
  end if;

  if v_test.status in ('active', 'closed') then
    if jsonb_array_length(p_content->'questions') < 1 then
      raise exception using errcode = '22023', message = 'invalid_draft_content';
    end if;

    -- Reopening an already materialized Test uses the same portable identity
    -- contract as activation. No position/content heuristic is permitted.
    perform question.id
    from public.test_questions question
    where question.test_id = p_test_id
    order by question.id
    for update;

    for v_question in
      select question.value || jsonb_build_object('position', question.ordinality - 1)
      from jsonb_array_elements(p_content->'questions')
        with ordinality as question(value, ordinality)
      order by question.ordinality
    loop
      v_question_id := (v_question->>'id')::uuid;
      if nullif(btrim(v_question->>'question_text'), '') is null then
        raise exception using errcode = '22023', message = 'invalid_draft_content';
      end if;

      select array_agg(question.id order by question.id)
        into v_matched_row_ids
      from public.test_questions question
      where question.test_id = p_test_id
        and (
          question.artifact_id = v_question_id
          or question.source_artifact_id = v_question_id
        );

      if coalesce(cardinality(v_matched_row_ids), 0) > 1 then
        raise exception using errcode = '22023', message = 'question_identity_ambiguous';
      end if;

      v_matched_row_id := v_matched_row_ids[1];
      -- Two distinct incoming ids (one matching a row's artifact_id, the
      -- other its source_artifact_id) can each independently resolve to a
      -- single row and pass the ambiguity check above. Reject that here,
      -- mirroring resolveTestQuestionIdentities' matchedRowIds guard, so a
      -- second question can't silently collapse into an already-claimed row.
      if v_matched_row_id is not null and v_matched_row_id = any(v_retained_row_ids) then
        raise exception using errcode = '22023', message = 'question_identity_ambiguous';
      end if;

      if v_matched_row_id is null then
        insert into public.test_questions (
          test_id,
          artifact_id,
          question_type,
          question_text,
          options,
          correct_option,
          answer_key,
          sample_solution,
          points,
          response_max_chars,
          response_monospace,
          position
        ) values (
          p_test_id,
          v_question_id,
          v_question->>'question_type',
          btrim(v_question->>'question_text'),
          coalesce(v_question->'options', '[]'::jsonb),
          (v_question->>'correct_option')::integer,
          nullif(btrim(v_question->>'answer_key'), ''),
          nullif(btrim(v_question->>'sample_solution'), ''),
          (v_question->>'points')::numeric,
          (v_question->>'response_max_chars')::integer,
          coalesce((v_question->>'response_monospace')::boolean, false),
          (v_question->>'position')::integer
        )
        returning id into v_matched_row_id;
      else
        select coalesce(question.source_artifact_id, question.artifact_id, question.id)
          into v_portable_id
        from public.test_questions question
        where question.id = v_matched_row_id;
        if v_portable_id is distinct from v_question_id then
          raise exception using errcode = '22023', message = 'question_identity_mismatch';
        end if;

        update public.test_questions question
        set
          question_type = v_question->>'question_type',
          question_text = btrim(v_question->>'question_text'),
          options = coalesce(v_question->'options', '[]'::jsonb),
          correct_option = (v_question->>'correct_option')::integer,
          answer_key = nullif(btrim(v_question->>'answer_key'), ''),
          sample_solution = nullif(btrim(v_question->>'sample_solution'), ''),
          points = (v_question->>'points')::numeric,
          response_max_chars = (v_question->>'response_max_chars')::integer,
          response_monospace = coalesce((v_question->>'response_monospace')::boolean, false),
          position = (v_question->>'position')::integer
        where question.id = v_matched_row_id
          and (
            question.question_type is distinct from v_question->>'question_type'
            or question.question_text is distinct from btrim(v_question->>'question_text')
            or question.options is distinct from coalesce(v_question->'options', '[]'::jsonb)
            or question.correct_option is distinct from (v_question->>'correct_option')::integer
            or question.answer_key is distinct from nullif(btrim(v_question->>'answer_key'), '')
            or question.sample_solution is distinct from nullif(btrim(v_question->>'sample_solution'), '')
            or question.points is distinct from (v_question->>'points')::numeric
            or question.response_max_chars is distinct from (v_question->>'response_max_chars')::integer
            or question.response_monospace is distinct from coalesce((v_question->>'response_monospace')::boolean, false)
            or question.position is distinct from (v_question->>'position')::integer
          );
      end if;

      v_retained_row_ids := array_append(v_retained_row_ids, v_matched_row_id);
    end loop;

    delete from public.test_questions question
    where question.test_id = p_test_id
      and not (question.id = any(v_retained_row_ids));
  end if;

  update public.assessment_drafts draft
  set
    content = jsonb_set(
      p_content,
      '{question_identity_version}',
      '1'::jsonb,
      true
    ),
    version = draft.version + 1,
    updated_by = p_teacher_id
  where draft.id = v_draft.id
    and draft.version = p_expected_draft_version
  returning draft.* into strict v_draft;

  update public.tests test
  set
    title = btrim(p_content->>'title'),
    show_results = (p_content->>'show_results')::boolean,
    documents = case
      when p_update_documents then coalesce(p_documents, '[]'::jsonb)
      else test.documents
    end
  where test.id = p_test_id
    and test.status = v_test.status
  returning test.* into strict v_test;

  return jsonb_build_object(
    'cleanup_paths', v_cleanup_paths,
    'draft', to_jsonb(v_draft),
    'test', to_jsonb(v_test)
  );
end;
$$;

create or replace function public.activate_test_from_draft_atomic(
  p_teacher_id uuid,
  p_test_id uuid,
  p_expected_draft_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived_at timestamptz;
  v_draft public.assessment_drafts%rowtype;
  v_matched_row_id uuid;
  v_matched_row_ids uuid[];
  v_owner_id uuid;
  v_portable_id uuid;
  v_question jsonb;
  v_question_id uuid;
  v_retained_row_ids uuid[] := array[]::uuid[];
  v_seen_question_ids uuid[] := array[]::uuid[];
  v_test public.tests%rowtype;
begin
  if p_expected_draft_version is null or p_expected_draft_version < 1 then
    raise exception using errcode = '22023', message = 'invalid_draft_version';
  end if;

  select test.* into v_test
  from public.tests test
  where test.id = p_test_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_not_found';
  end if;

  -- Activation uses the same Test -> Classroom -> draft -> questions lock
  -- order as saving. The update lock both prevents activation from completing
  -- after a concurrent archive wins and serializes structural-revision writes
  -- from different Tests in the same Classroom.
  select classroom.teacher_id, classroom.archived_at
    into v_owner_id, v_archived_at
  from public.classrooms classroom
  where classroom.id = v_test.classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_classroom_not_found';
  end if;
  if v_owner_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  if v_archived_at is not null or v_test.blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'test_archived';
  end if;
  if v_test.status is distinct from 'draft' then
    raise exception using errcode = '40001', message = 'test_not_draft';
  end if;

  select draft.*
    into v_draft
  from public.assessment_drafts draft
  where draft.assessment_type = 'test'
    and draft.assessment_id = p_test_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_draft_not_found';
  end if;
  if v_draft.version is distinct from p_expected_draft_version then
    raise exception using errcode = '40001', message = 'draft_version_conflict';
  end if;
  if jsonb_typeof(v_draft.content) is distinct from 'object'
    or jsonb_typeof(v_draft.content->'questions') is distinct from 'array'
    or jsonb_array_length(v_draft.content->'questions') < 1
    or jsonb_typeof(v_draft.content->'show_results') is distinct from 'boolean'
    or nullif(btrim(v_draft.content->>'title'), '') is null
  then
    raise exception using errcode = '22023', message = 'invalid_draft_content';
  end if;

  -- Lock existing question rows only after the parent Test and draft. Every
  -- writer follows this order so activation cannot observe a partial save.
  perform question.id
  from public.test_questions question
  where question.test_id = p_test_id
  order by question.id
  for update;

  for v_question in
    select question.value || jsonb_build_object('position', question.ordinality - 1)
    from jsonb_array_elements(v_draft.content->'questions')
      with ordinality as question(value, ordinality)
    order by question.ordinality
  loop
    if coalesce(v_question->>'id', '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception using errcode = '22023', message = 'invalid_draft_content';
    end if;
    v_question_id := (v_question->>'id')::uuid;
    if v_question_id = any(v_seen_question_ids) then
      raise exception using errcode = '22023', message = 'duplicate_question_identity';
    end if;
    if nullif(btrim(v_question->>'question_text'), '') is null then
      raise exception using errcode = '22023', message = 'invalid_draft_content';
    end if;
    v_seen_question_ids := array_append(v_seen_question_ids, v_question_id);

    select array_agg(question.id order by question.id)
      into v_matched_row_ids
    from public.test_questions question
    where question.test_id = p_test_id
      and (
        question.artifact_id = v_question_id
        or question.source_artifact_id = v_question_id
      );

    if coalesce(cardinality(v_matched_row_ids), 0) > 1 then
      raise exception using errcode = '22023', message = 'question_identity_ambiguous';
    end if;

    v_matched_row_id := v_matched_row_ids[1];
    -- Two distinct incoming ids (one matching a row's artifact_id, the
    -- other its source_artifact_id) can each independently resolve to a
    -- single row and pass the ambiguity check above. Reject that here,
    -- mirroring resolveTestQuestionIdentities' matchedRowIds guard, so a
    -- second question can't silently collapse into an already-claimed row.
    if v_matched_row_id is not null and v_matched_row_id = any(v_retained_row_ids) then
      raise exception using errcode = '22023', message = 'question_identity_ambiguous';
    end if;

    if v_matched_row_id is null then
      insert into public.test_questions (
        test_id,
        artifact_id,
        question_type,
        question_text,
        options,
        correct_option,
        answer_key,
        sample_solution,
        points,
        response_max_chars,
        response_monospace,
        position
      ) values (
        p_test_id,
        v_question_id,
        v_question->>'question_type',
        btrim(v_question->>'question_text'),
        coalesce(v_question->'options', '[]'::jsonb),
        (v_question->>'correct_option')::integer,
        nullif(btrim(v_question->>'answer_key'), ''),
        nullif(btrim(v_question->>'sample_solution'), ''),
        (v_question->>'points')::numeric,
        (v_question->>'response_max_chars')::integer,
        coalesce((v_question->>'response_monospace')::boolean, false),
        (v_question->>'position')::integer
      )
      returning id into v_matched_row_id;
    else
      select coalesce(question.source_artifact_id, question.artifact_id, question.id)
        into v_portable_id
      from public.test_questions question
      where question.id = v_matched_row_id;
      if v_portable_id is distinct from v_question_id then
        raise exception using errcode = '22023', message = 'question_identity_mismatch';
      end if;

      update public.test_questions question
      set
        question_type = v_question->>'question_type',
        question_text = btrim(v_question->>'question_text'),
        options = coalesce(v_question->'options', '[]'::jsonb),
        correct_option = (v_question->>'correct_option')::integer,
        answer_key = nullif(btrim(v_question->>'answer_key'), ''),
        sample_solution = nullif(btrim(v_question->>'sample_solution'), ''),
        points = (v_question->>'points')::numeric,
        response_max_chars = (v_question->>'response_max_chars')::integer,
        response_monospace = coalesce((v_question->>'response_monospace')::boolean, false),
        position = (v_question->>'position')::integer
      where question.id = v_matched_row_id
        and (
          question.question_type is distinct from v_question->>'question_type'
          or question.question_text is distinct from btrim(v_question->>'question_text')
          or question.options is distinct from coalesce(v_question->'options', '[]'::jsonb)
          or question.correct_option is distinct from (v_question->>'correct_option')::integer
          or question.answer_key is distinct from nullif(btrim(v_question->>'answer_key'), '')
          or question.sample_solution is distinct from nullif(btrim(v_question->>'sample_solution'), '')
          or question.points is distinct from (v_question->>'points')::numeric
          or question.response_max_chars is distinct from (v_question->>'response_max_chars')::integer
          or question.response_monospace is distinct from coalesce((v_question->>'response_monospace')::boolean, false)
          or question.position is distinct from (v_question->>'position')::integer
        );
    end if;

    v_retained_row_ids := array_append(v_retained_row_ids, v_matched_row_id);
  end loop;

  delete from public.test_questions question
  where question.test_id = p_test_id
    and not (question.id = any(v_retained_row_ids));

  update public.tests test
  set
    title = btrim(v_draft.content->>'title'),
    show_results = (v_draft.content->>'show_results')::boolean,
    status = 'active'
  where test.id = p_test_id
    and test.status = 'draft'
  returning test.* into strict v_test;

  return jsonb_build_object(
    'draft_version', v_draft.version,
    'test', to_jsonb(v_test)
  );
end;
$$;

revoke all on function public.save_test_draft_atomic(
  uuid,
  uuid,
  integer,
  jsonb,
  boolean,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.save_test_draft_atomic(
  uuid,
  uuid,
  integer,
  jsonb,
  boolean,
  jsonb,
  jsonb
) to service_role;

revoke all on function public.activate_test_from_draft_atomic(
  uuid,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.activate_test_from_draft_atomic(
  uuid,
  uuid,
  integer
) to service_role;

create or replace function public.create_course_blueprint_atomic_v2_pre_managed_storage(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_operation_type text,
  p_request_sha256 text,
  p_source_classroom_id uuid,
  p_expected_source_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.course_blueprint_operations;
  v_result jsonb;
  v_blueprint_id uuid;
  v_item jsonb;
  v_child jsonb;
  v_parent_id uuid;
  v_position integer;
  v_question_row_ids uuid[];
  v_source_test_status text;
  v_updated integer;
  v_error_code text;
  v_error_sqlstate text;
  v_resource_counts jsonb := '{}'::jsonb;
begin
  if p_operation_type not in ('import', 'capture') then
    raise exception 'Invalid blueprint creation operation type'
      using errcode = '22023';
  end if;

  -- The base RPC owns its own domain-write savepoint, but this wrapper performs
  -- additional identity writes after the base RPC returns. Seed the ledger
  -- outside a wider savepoint so a wrapper failure can roll back the complete
  -- Blueprint graph while retaining durable failure evidence.
  insert into public.course_blueprint_operations (
    id,
    teacher_id,
    operation_type,
    request_sha256,
    status,
    source_classroom_id
  )
  values (
    p_operation_id,
    p_teacher_id,
    p_operation_type,
    p_request_sha256,
    'running',
    p_source_classroom_id
  )
  on conflict (id) do nothing;

  -- This wrapper has a wider exception savepoint than the base RPC. Hold the
  -- ledger lock outside that savepoint so an identity-mapping rollback cannot
  -- release it before the failure handler records its result. Otherwise two
  -- retries of the same failed capture can overwrite a completed operation.
  select *
  into v_operation
  from public.course_blueprint_operations
  where id = p_operation_id
  for update;

  if v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type <> p_operation_type
    or v_operation.request_sha256 <> p_request_sha256
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', p_operation_type,
      'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for a different blueprint request',
      'retryable', false
    );
  end if;

  if v_operation.status = 'completed' and v_operation.result is not null then
    return jsonb_set(v_operation.result, '{replayed}', 'true'::jsonb, true);
  end if;

  begin
  perform set_config('pika.identity_mapping', 'on', true);
  v_result := public.create_course_blueprint_atomic(
    p_operation_id,
    p_teacher_id,
    p_operation_type,
    p_request_sha256,
    p_source_classroom_id,
    p_expected_source_revision,
    p_plan
  );
  if coalesce((v_result->>'ok')::boolean, false) is false then
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end if;
  if coalesce((v_result->>'replayed')::boolean, false) then
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end if;
  v_resource_counts := coalesce(v_result->'counts', '{}'::jsonb);

  v_blueprint_id := (v_result->>'blueprint_id')::uuid;
  update public.course_blueprints
  set
    gradebook_use_weights = coalesce(
      (p_plan->'blueprint'->>'gradebook_use_weights')::boolean,
      false
    ),
    gradebook_assignments_weight = coalesce(
      (p_plan->'blueprint'->>'gradebook_assignments_weight')::smallint,
      70
    ),
    gradebook_tests_weight = coalesce(
      (p_plan->'blueprint'->>'gradebook_tests_weight')::smallint,
      30
    )
  where id = v_blueprint_id;

  for v_item in select value from jsonb_array_elements(p_plan->'assignments')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.course_blueprint_assignments
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      track_authenticity = coalesce(
        (v_item->>'track_authenticity')::boolean,
        false
      )
    where course_blueprint_id = v_blueprint_id
      and position = v_position;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Assignment positions must be unique for identity mapping'
        using errcode = '22023';
    end if;
    if p_operation_type = 'capture' then
      update public.assignments
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and blueprint_archived_at is null
        and position = v_position
      returning id into v_parent_id;
      if not found then
        raise exception 'Captured assignment identity mapping failed'
          using errcode = '22023';
      end if;
      for v_child in
        select value
        from jsonb_array_elements(
          coalesce(v_item->'submission_requirements_json', '[]'::jsonb)
        )
      loop
        update public.assignment_submission_requirements
        set
          artifact_id = (v_child->>'id')::uuid,
          source_artifact_id = (v_child->>'id')::uuid
        where assignment_id = v_parent_id
          and position = coalesce((v_child->>'position')::integer, 0);
        get diagnostics v_updated = row_count;
        if v_updated <> 1 then
          raise exception 'Captured assignment requirement identity mapping failed'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_plan->'assessments')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.course_blueprint_assessments
    set artifact_id = (v_item->>'artifact_id')::uuid
    where course_blueprint_id = v_blueprint_id
      and assessment_type = 'test'
      and position = v_position;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Test positions must be unique for identity mapping'
        using errcode = '22023';
    end if;
    if p_operation_type = 'capture' then
      select array_agg(source_test.id order by source_test.id)
      into v_question_row_ids
      from public.tests as source_test
      where source_test.classroom_id = p_source_classroom_id
        and source_test.blueprint_archived_at is null
        and (
          source_test.artifact_id = (v_item->>'artifact_id')::uuid
          or source_test.source_artifact_id = (v_item->>'artifact_id')::uuid
        );
      if coalesce(cardinality(v_question_row_ids), 0) <> 1 then
        raise exception 'Captured Test identity mapping failed'
          using errcode = '22023';
      end if;
      v_parent_id := v_question_row_ids[1];

      -- Draft-status Tests have no materialized test_questions rows yet
      -- (activation is what writes them); their content comes from the draft
      -- JSON instead. Zero matches is expected there. For an active/closed
      -- Test, every captured question must resolve to a real row, matching
      -- how every sibling artifact type in this function treats zero matches.
      select source_test.status into v_source_test_status
      from public.tests as source_test
      where source_test.id = v_parent_id;

      for v_child in
        select question.value
        from jsonb_array_elements(
          coalesce(v_item->'content'->'questions', '[]'::jsonb)
        ) as question(value)
      loop
        select array_agg(source_question.id order by source_question.id)
        into v_question_row_ids
        from public.test_questions as source_question
        where source_question.test_id = v_parent_id
          and (
            source_question.artifact_id = (v_child->>'id')::uuid
            or source_question.source_artifact_id = (v_child->>'id')::uuid
          );

        if coalesce(cardinality(v_question_row_ids), 0) > 1 then
          v_error_code := 'test_question_identity_ambiguous';
          raise exception 'Captured Test question identity mapping is ambiguous'
            using errcode = '22023';
        elsif coalesce(cardinality(v_question_row_ids), 0) = 0
          and v_source_test_status is distinct from 'draft'
        then
          v_error_code := 'test_question_identity_not_found';
          raise exception 'Captured Test question identity mapping failed'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_plan->'lesson_templates')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.course_blueprint_lesson_templates
    set artifact_id = (v_item->>'artifact_id')::uuid
    where course_blueprint_id = v_blueprint_id
      and position = v_position;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Lesson positions must be unique for identity mapping'
        using errcode = '22023';
    end if;
    if p_operation_type = 'capture' then
      update public.lesson_plans
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where id = (
        select lesson.id
        from public.lesson_plans lesson
        where lesson.classroom_id = p_source_classroom_id
          and lesson.blueprint_archived_at is null
        order by lesson.date, lesson.id
        offset v_position
        limit 1
      );
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Captured lesson identity mapping failed'
          using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'materials', '[]'::jsonb))
  loop
    insert into public.course_blueprint_materials (
      course_blueprint_id,
      artifact_id,
      title,
      content_markdown,
      position
    )
    values (
      v_blueprint_id,
      (v_item->>'artifact_id')::uuid,
      v_item->>'title',
      coalesce(v_item->>'content_markdown', ''),
      coalesce((v_item->>'position')::integer, 0)
    );
    if p_operation_type = 'capture' then
      update public.classwork_materials
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and blueprint_archived_at is null
        and position = coalesce((v_item->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Captured material identity mapping failed'
          using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'surveys', '[]'::jsonb))
  loop
    insert into public.course_blueprint_surveys (
      course_blueprint_id,
      artifact_id,
      title,
      show_results,
      dynamic_responses,
      questions_json,
      position
    )
    values (
      v_blueprint_id,
      (v_item->>'artifact_id')::uuid,
      v_item->>'title',
      coalesce((v_item->>'show_results')::boolean, true),
      coalesce((v_item->>'dynamic_responses')::boolean, false),
      coalesce(v_item->'questions_json', '[]'::jsonb),
      coalesce((v_item->>'position')::integer, 0)
    );
    if p_operation_type = 'capture' then
      update public.surveys
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and blueprint_archived_at is null
        and position = coalesce((v_item->>'position')::integer, 0)
      returning id into v_parent_id;
      if not found then
        raise exception 'Captured survey identity mapping failed'
          using errcode = '22023';
      end if;
      for v_child in
        select value
        from jsonb_array_elements(coalesce(v_item->'questions_json', '[]'::jsonb))
      loop
        update public.survey_questions
        set
          artifact_id = (v_child->>'id')::uuid,
          source_artifact_id = (v_child->>'id')::uuid
        where survey_id = v_parent_id
          and position = coalesce((v_child->>'position')::integer, 0);
        get diagnostics v_updated = row_count;
        if v_updated <> 1 then
          raise exception 'Captured survey question identity mapping failed'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  v_result := jsonb_set(
    v_result,
    '{counts}',
    coalesce(v_result->'counts', '{}'::jsonb) || jsonb_build_object(
      'materials', jsonb_array_length(coalesce(p_plan->'materials', '[]'::jsonb)),
      'surveys', jsonb_array_length(coalesce(p_plan->'surveys', '[]'::jsonb))
    ),
    true
  );
  update public.course_blueprint_operations
  set
    result = v_result,
    resource_counts = v_result->'counts',
    updated_at = now()
  where id = p_operation_id;

  perform set_config('pika.identity_mapping', 'off', true);
  return v_result;
  exception when others then
    get stacked diagnostics
      v_error_sqlstate = returned_sqlstate;
    v_error_code := coalesce(v_error_code, 'blueprint_identity_mapping_failed');
    v_result := jsonb_build_object(
      'ok', false,
      'status', case
        when v_error_code in ('test_question_identity_ambiguous', 'test_question_identity_not_found')
          then 409
        else 500
      end,
      'operation_id', p_operation_id,
      'operation_type', p_operation_type,
      'error_code', v_error_code,
      'error', case
        when v_error_code = 'test_question_identity_ambiguous'
          then 'Test question identity mapping is ambiguous'
        when v_error_code = 'test_question_identity_not_found'
          then 'Test question identity mapping failed'
        else 'Blueprint identity mapping failed'
      end,
      'retryable', true
    );
    update public.course_blueprint_operations
    set
      status = 'failed',
      attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
      result_blueprint_id = null,
      result_classroom_id = null,
      result = v_result,
      resource_counts = v_resource_counts,
      error_code = v_error_code,
      error_sqlstate = v_error_sqlstate,
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end;
end;
$$;

alter function public.instantiate_course_blueprint_atomic_v2_pre_managed_storage(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) rename to instantiate_course_blueprint_atomic_v2_pre_question_identity;

-- Migration 112 assigned freshly instantiated Test-question identities by
-- position after the base RPC inserted rows. Keep that compatibility RPC for
-- the rest of the graph, but suppress its question creation/mapping branch and
-- materialize questions here from explicit Version artifact IDs. The parent
-- Test is resolved by its established source_artifact_id, never by title or
-- position.
create or replace function public.instantiate_course_blueprint_atomic_v2_pre_managed_storage(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_blueprint_version_id uuid,
  p_request_sha256 text,
  p_expected_content_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.course_blueprint_operations;
  v_result jsonb;
  v_classroom_id uuid;
  v_compatibility_plan jsonb;
  v_parent_id uuid;
  v_item jsonb;
  v_child jsonb;
  v_error_code text;
  v_error_sqlstate text;
  v_question_count integer := 0;
  v_resource_counts jsonb := '{}'::jsonb;
begin
  -- Retain the operation row outside the materialization savepoint. The
  -- compatibility RPC completes its own ledger before this wrapper creates
  -- question rows, so a later identity failure must roll back the complete
  -- Classroom graph without erasing durable failure evidence.
  insert into public.course_blueprint_operations (
    id,
    teacher_id,
    operation_type,
    request_sha256,
    status,
    source_blueprint_id
  )
  values (
    p_operation_id,
    p_teacher_id,
    'instantiate',
    p_request_sha256,
    'running',
    p_blueprint_id
  )
  on conflict (id) do nothing;

  select *
  into v_operation
  from public.course_blueprint_operations
  where id = p_operation_id
  for update;

  if v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type <> 'instantiate'
    or v_operation.request_sha256 <> p_request_sha256
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', 'instantiate',
      'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for a different blueprint request',
      'retryable', false
    );
  end if;

  if v_operation.status = 'completed' and v_operation.result is not null then
    return jsonb_set(v_operation.result, '{replayed}', 'true'::jsonb, true);
  end if;

  -- The compatibility implementation still creates the rest of the Classroom
  -- graph, but its Test-question branch assigns identity by position. Give it
  -- an empty questions array for every Test so it creates neither temporary
  -- question rows nor positional identities. The canonical loop below then
  -- materializes each question exactly once from its explicit Version ID. Mark
  -- draft_content as portable even for immutable Versions created before this
  -- discriminator existed; Version question IDs are already canonical.
  select coalesce(
    sum(jsonb_array_length(coalesce(source_test.value->'questions', '[]'::jsonb))),
    0
  )::integer
  into v_question_count
  from jsonb_array_elements(coalesce(p_plan->'tests', '[]'::jsonb)) source_test(value);

  select p_plan || jsonb_build_object(
    'tests',
    coalesce(
      jsonb_agg(
        source_test.value || jsonb_build_object(
          'questions',
          '[]'::jsonb,
          'draft_content',
          jsonb_set(
            coalesce(source_test.value->'draft_content', '{}'::jsonb),
            '{question_identity_version}',
            '1'::jsonb,
            true
          )
        )
        order by source_test.ordinality
      ),
      '[]'::jsonb
    )
  )
  into v_compatibility_plan
  from jsonb_array_elements(coalesce(p_plan->'tests', '[]'::jsonb))
    with ordinality as source_test(value, ordinality);

  begin
  v_result := public.instantiate_course_blueprint_atomic_v2_pre_question_identity(
    p_operation_id,
    p_teacher_id,
    p_blueprint_id,
    p_blueprint_version_id,
    p_request_sha256,
    p_expected_content_revision,
    v_compatibility_plan
  );
  if coalesce((v_result->>'ok')::boolean, false) is false
    or coalesce((v_result->>'replayed')::boolean, false)
  then
    return v_result;
  end if;
  v_result := jsonb_set(
    v_result,
    '{counts,questions}',
    to_jsonb(v_question_count),
    true
  );
  v_resource_counts := coalesce(v_result->'counts', '{}'::jsonb);

  v_classroom_id := (v_result->>'classroom_id')::uuid;
  perform set_config('pika.identity_mapping', 'on', true);
  v_error_code := 'test_question_identity_mapping_failed';

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'tests', '[]'::jsonb))
  loop
    select source_test.id
    into v_parent_id
    from public.tests as source_test
    where source_test.classroom_id = v_classroom_id
      and source_test.source_artifact_id = (v_item->>'artifact_id')::uuid
      and source_test.blueprint_archived_at is null;
    if not found then
      raise exception 'Instantiated Test identity mapping failed'
        using errcode = '22023';
    end if;

    for v_child in
      select value from jsonb_array_elements(coalesce(v_item->'questions', '[]'::jsonb))
    loop
      insert into public.test_questions (
        test_id,
        artifact_id,
        source_artifact_id,
        source_blueprint_version_id,
        question_type,
        question_text,
        options,
        correct_option,
        answer_key,
        sample_solution,
        points,
        response_max_chars,
        response_monospace,
        position
      )
      values (
        v_parent_id,
        (v_child->>'artifact_id')::uuid,
        (v_child->>'artifact_id')::uuid,
        p_blueprint_version_id,
        v_child->>'question_type',
        coalesce(v_child->>'question_text', ''),
        coalesce(v_child->'options', '[]'::jsonb),
        (v_child->>'correct_option')::integer,
        v_child->>'answer_key',
        v_child->>'sample_solution',
        coalesce((v_child->>'points')::numeric, 1),
        coalesce((v_child->>'response_max_chars')::integer, 5000),
        coalesce((v_child->>'response_monospace')::boolean, false),
        coalesce((v_child->>'position')::integer, 0)
      );
    end loop;
  end loop;

  update public.course_blueprint_operations
  set
    result = v_result,
    resource_counts = v_resource_counts,
    updated_at = now()
  where id = p_operation_id;

  perform set_config('pika.identity_mapping', 'off', true);
  return v_result;
  exception when others then
    get stacked diagnostics
      v_error_sqlstate = returned_sqlstate;
    if v_error_sqlstate = '23505' then
      v_error_code := 'test_question_identity_conflict';
    else
      v_error_code := coalesce(
        v_error_code,
        'test_question_identity_mapping_failed'
      );
    end if;
    v_result := jsonb_build_object(
      'ok', false,
      'status', case when v_error_sqlstate = '23505' then 409 else 500 end,
      'operation_id', p_operation_id,
      'operation_type', 'instantiate',
      'error_code', v_error_code,
      'error', case
        when v_error_sqlstate = '23505'
          then 'Test question identity conflicts with another Version question'
        else 'Test question identity mapping failed'
      end,
      'retryable', v_error_sqlstate <> '23505'
    );
    update public.course_blueprint_operations
    set
      status = 'failed',
      attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
      result_blueprint_id = null,
      result_classroom_id = null,
      result = v_result,
      resource_counts = v_resource_counts,
      error_code = v_error_code,
      error_sqlstate = v_error_sqlstate,
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end;
end;
$$;

revoke all on function public.instantiate_course_blueprint_atomic_v2_pre_question_identity(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.instantiate_course_blueprint_atomic_v2_pre_managed_storage(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) from public, anon, authenticated, service_role;

create or replace function public.create_archived_classroom_blueprint_atomic(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_request_sha256 text,
  p_source_classroom_id uuid,
  p_expected_source_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms;
  v_operation public.course_blueprint_operations;
  v_result jsonb;
  v_blueprint_id uuid;
  v_blueprint_revision bigint;
  v_version public.course_blueprint_versions;
  v_version_snapshot jsonb;
  v_version_sha256 text;
  v_item jsonb;
  v_child jsonb;
  v_parent_id uuid;
  v_position integer;
  v_question_row_ids uuid[];
  v_source_test_status text;
  v_updated integer;
  v_error_code text;
  v_error_sqlstate text;
  v_resource_counts jsonb := '{}'::jsonb;
begin
  select *
  into v_classroom
  from public.classrooms
  where id = p_source_classroom_id
    and teacher_id = p_teacher_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'error_code', 'source_classroom_not_found',
      'error', 'Archived classroom not found',
      'retryable', false
    );
  end if;

  if v_classroom.archived_at is null then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'error_code', 'source_classroom_not_archived',
      'error', 'Only archived classrooms can be used again',
      'retryable', false
    );
  end if;

  -- Reserve every operation key before any winner replay. A replay against an
  -- already-linked classroom is still a completed operation and must retain
  -- its teacher/type/hash contract for future idempotency checks.
  insert into public.course_blueprint_operations (
    id,
    teacher_id,
    operation_type,
    request_sha256,
    status,
    source_classroom_id
  )
  values (
    p_operation_id,
    p_teacher_id,
    'import',
    p_request_sha256,
    'running',
    p_source_classroom_id
  )
  on conflict (id) do nothing;

  select *
  into v_operation
  from public.course_blueprint_operations
  where id = p_operation_id
  for update;

  if v_operation.id is not null and (
    v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type <> 'import'
    or v_operation.request_sha256 <> p_request_sha256
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for a different blueprint request',
      'retryable', false
    );
  end if;

  if v_operation.status = 'completed' and v_operation.result is not null then
    return jsonb_set(v_operation.result, '{replayed}', 'true'::jsonb, true);
  end if;

  -- A distinct concurrent request that waited on this row reuses the winner.
  -- No second Blueprint is created; this operation's ledger converges on it.
  if v_classroom.source_blueprint_id is not null then
    select content_revision
    into v_blueprint_revision
    from public.course_blueprints
    where id = v_classroom.source_blueprint_id
      and teacher_id = p_teacher_id;

    if not found then
      raise exception 'Archived classroom Blueprint lineage is invalid'
        using errcode = '23503';
    end if;

    v_result := jsonb_build_object(
      'ok', true,
      'status', 201,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'replayed', true,
      'blueprint_id', v_classroom.source_blueprint_id,
      'source_revision', v_classroom.blueprint_source_revision,
      'result_content_revision', v_blueprint_revision,
      'counts', jsonb_build_object(
        'assignments', 0,
        'assessments', 0,
        'lesson_templates', 0
      )
    );

    -- Operation A can fail durably before operation B establishes the
    -- classroom winner. A compatible retry of A, or a fresh operation that
    -- arrives after B, must converge both the result and its ledger row.
    update public.course_blueprint_operations
    set
      status = 'completed',
      attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
      source_classroom_id = p_source_classroom_id,
      result_blueprint_id = v_classroom.source_blueprint_id,
      result_classroom_id = p_source_classroom_id,
      result = v_result,
      resource_counts = v_result->'counts',
      error_code = null,
      error_sqlstate = null,
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;

    return v_result;
  end if;

  if v_classroom.blueprint_source_revision <> p_expected_source_revision then
    v_result := jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'error_code', 'source_classroom_changed',
      'error', 'The archived classroom changed while preparing this course',
      'retryable', true
    );
    update public.course_blueprint_operations
    set
      status = 'failed',
      attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
      source_classroom_id = p_source_classroom_id,
      result_blueprint_id = null,
      result_classroom_id = null,
      result = v_result,
      resource_counts = '{}'::jsonb,
      error_code = 'source_classroom_changed',
      error_sqlstate = null,
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
    return v_result;
  end if;

  begin

  -- The nested RPC participates in this savepoint. Any failure after it
  -- returns rolls back its Blueprint graph while preserving the outer ledger.
  v_result := public.create_course_blueprint_atomic_v2(
    p_operation_id,
    p_teacher_id,
    'import',
    p_request_sha256,
    null,
    null,
    p_plan
  );
  if coalesce((v_result->>'ok')::boolean, false) is false then
    return v_result;
  end if;
  v_resource_counts := coalesce(v_result->'counts', '{}'::jsonb);

  v_blueprint_id := (v_result->>'blueprint_id')::uuid;
  v_blueprint_revision := (v_result->>'result_content_revision')::bigint;

  perform set_config('pika.identity_mapping', 'on', true);

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'assignments', '[]'::jsonb)
    )
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.assignments
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid
    where classroom_id = p_source_classroom_id
      and blueprint_archived_at is null
      and position = v_position
    returning id into v_parent_id;
    if not found then
      raise exception 'Archived assignment identity mapping failed'
        using errcode = '22023';
    end if;

    for v_child in
      select value from jsonb_array_elements(
        coalesce(v_item->'submission_requirements_json', '[]'::jsonb)
      )
    loop
      update public.assignment_submission_requirements
      set
        artifact_id = (v_child->>'id')::uuid,
        source_artifact_id = (v_child->>'id')::uuid
      where assignment_id = v_parent_id
        and position = coalesce((v_child->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Archived assignment requirement identity mapping failed'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'assessments', '[]'::jsonb)
    )
  loop
    select array_agg(source_test.id order by source_test.id)
    into v_question_row_ids
    from public.tests as source_test
    where source_test.classroom_id = p_source_classroom_id
      and source_test.blueprint_archived_at is null
      and (
        source_test.artifact_id = (v_item->>'artifact_id')::uuid
        or source_test.source_artifact_id = (v_item->>'artifact_id')::uuid
      );
    if coalesce(cardinality(v_question_row_ids), 0) <> 1 then
      raise exception 'Archived Test identity mapping failed'
        using errcode = '22023';
    end if;
    v_parent_id := v_question_row_ids[1];

    -- Draft-status Tests have no materialized test_questions rows yet
    -- (activation is what writes them); their content comes from the draft
    -- JSON instead. Zero matches is expected there. For an active/closed
    -- Test, every captured question must resolve to a real row, matching
    -- how every sibling artifact type in this function treats zero matches.
    select source_test.status into v_source_test_status
    from public.tests as source_test
    where source_test.id = v_parent_id;

    for v_child in
      select question.value
      from jsonb_array_elements(
        coalesce(v_item->'content'->'questions', '[]'::jsonb)
      ) as question(value)
    loop
      select array_agg(source_question.id order by source_question.id)
      into v_question_row_ids
      from public.test_questions as source_question
      where source_question.test_id = v_parent_id
        and (
          source_question.artifact_id = (v_child->>'id')::uuid
          or source_question.source_artifact_id = (v_child->>'id')::uuid
        );

      if coalesce(cardinality(v_question_row_ids), 0) > 1 then
        v_error_code := 'test_question_identity_ambiguous';
        raise exception 'Archived Test question identity mapping is ambiguous'
          using errcode = '22023';
      elsif coalesce(cardinality(v_question_row_ids), 0) = 0
        and v_source_test_status is distinct from 'draft'
      then
        v_error_code := 'test_question_identity_not_found';
        raise exception 'Archived Test question identity mapping failed'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'lesson_templates', '[]'::jsonb)
    )
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.lesson_plans
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid
    where id = (
      select lesson.id
      from public.lesson_plans lesson
      where lesson.classroom_id = p_source_classroom_id
        and lesson.blueprint_archived_at is null
      order by lesson.date, lesson.id
      offset v_position
      limit 1
    );
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Archived lesson identity mapping failed'
        using errcode = '22023';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'materials', '[]'::jsonb)
    )
  loop
    update public.classwork_materials
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid
    where classroom_id = p_source_classroom_id
      and blueprint_archived_at is null
      and position = coalesce((v_item->>'position')::integer, 0);
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Archived material identity mapping failed'
        using errcode = '22023';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'surveys', '[]'::jsonb)
    )
  loop
    update public.surveys
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid
    where classroom_id = p_source_classroom_id
      and blueprint_archived_at is null
      and position = coalesce((v_item->>'position')::integer, 0)
    returning id into v_parent_id;
    if not found then
      raise exception 'Archived survey identity mapping failed'
        using errcode = '22023';
    end if;

    for v_child in
      select value from jsonb_array_elements(
        coalesce(v_item->'questions_json', '[]'::jsonb)
      )
    loop
      update public.survey_questions
      set
        artifact_id = (v_child->>'id')::uuid,
        source_artifact_id = (v_child->>'id')::uuid
      where survey_id = v_parent_id
        and position = coalesce((v_child->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Archived survey question identity mapping failed'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  v_version_snapshot :=
    public.archived_classroom_blueprint_snapshot_from_plan(
      v_blueprint_id,
      v_blueprint_revision,
      p_plan
    );
  v_version_sha256 := encode(
    extensions.digest(
      convert_to(
        public.course_blueprint_canonical_jsonb_text(v_version_snapshot),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  select *
  into v_version
  from public.save_course_blueprint_version_atomic(
    p_teacher_id,
    v_blueprint_id,
    v_blueprint_revision,
    2,
    v_version_snapshot,
    v_version_sha256,
    'classroom',
    jsonb_build_object(
      'classroom_id', p_source_classroom_id,
      'operation_id', p_operation_id,
      'reuse_source', 'archived_classroom'
    )
  );

  update public.assignments
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.assignment_submission_requirements requirement
  set source_blueprint_version_id = v_version.id
  where exists (
    select 1
    from public.assignments assignment
    where assignment.id = requirement.assignment_id
      and assignment.classroom_id = p_source_classroom_id
      and assignment.blueprint_archived_at is null
  ) and requirement.source_artifact_id is not null;
  update public.tests
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.test_questions question
  set source_blueprint_version_id = v_version.id
  where exists (
    select 1
    from public.tests test
    where test.id = question.test_id
      and test.classroom_id = p_source_classroom_id
      and test.blueprint_archived_at is null
  ) and question.source_artifact_id is not null;
  update public.lesson_plans
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.classwork_materials
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.surveys
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.survey_questions question
  set source_blueprint_version_id = v_version.id
  where exists (
    select 1
    from public.surveys survey
    where survey.id = question.survey_id
      and survey.classroom_id = p_source_classroom_id
      and survey.blueprint_archived_at is null
  ) and question.source_artifact_id is not null;

  update public.classrooms
  set
    source_blueprint_id = v_blueprint_id,
    source_blueprint_version_id = v_version.id,
    source_blueprint_origin = jsonb_build_object(
      'blueprint_id', v_blueprint_id,
      'blueprint_title', p_plan->'blueprint'->>'title',
      'blueprint_content_revision', v_blueprint_revision,
      'blueprint_version_id', v_version.id,
      'blueprint_version_number', v_version.version_number,
      'package_manifest_version', p_plan->>'manifest_version',
      'package_exported_at', now(),
      'operation_id', p_operation_id,
      'reuse_source', 'archived_classroom'
    )
  where id = p_source_classroom_id;

  v_result := v_result || jsonb_build_object(
    'source_blueprint_version_id',
    v_version.id
  );
  update public.course_blueprint_operations
  set
    source_classroom_id = p_source_classroom_id,
    result_classroom_id = p_source_classroom_id,
    result = v_result,
    updated_at = now()
  where id = p_operation_id;

  perform set_config('pika.identity_mapping', 'off', true);
  return v_result;
  exception when others then
    get stacked diagnostics
      v_error_sqlstate = returned_sqlstate;
    v_error_code := coalesce(v_error_code, 'blueprint_identity_mapping_failed');
    v_result := jsonb_build_object(
      'ok', false,
      'status', case
        when v_error_code in ('test_question_identity_ambiguous', 'test_question_identity_not_found')
          then 409
        else 500
      end,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'error_code', v_error_code,
      'error', case
        when v_error_code = 'test_question_identity_ambiguous'
          then 'Test question identity mapping is ambiguous'
        when v_error_code = 'test_question_identity_not_found'
          then 'Test question identity mapping failed'
        else 'Blueprint identity mapping failed'
      end,
      'retryable', true
    );
    update public.course_blueprint_operations
    set
      status = 'failed',
      attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
      source_classroom_id = p_source_classroom_id,
      result_blueprint_id = null,
      result_classroom_id = null,
      result = v_result,
      resource_counts = v_resource_counts,
      error_code = v_error_code,
      error_sqlstate = v_error_sqlstate,
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end;
end;
$$;

revoke all on function public.create_course_blueprint_atomic_v2_pre_managed_storage(
  uuid,
  uuid,
  text,
  text,
  uuid,
  bigint,
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.create_archived_classroom_blueprint_atomic(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  jsonb
) from public, anon, authenticated;
grant execute on function public.create_archived_classroom_blueprint_atomic(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  jsonb
) to service_role;
