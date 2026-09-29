-- Keep the first-Start boundary. One MC option string may be corrected per save,
-- while the choice count, question identity, grading fields and all other authored
-- fields remain frozen. The parent locks still serialize this write with attempts.
create or replace function public.lock_test_parent_for_child_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_classroom_ids uuid[];
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

  -- Archive restore and compaction run only inside owner-scoped maintenance
  -- transactions. They must be able to recreate an archived locked Test's
  -- question identities without opening the same path to API callers.
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- The owner-run Classroom finalizer already holds the Classroom lifecycle
  -- lock and verifies the snapshotted deletion membership. Its direct reverse-
  -- graph delete reaches questions before attempts, so permit that exact
  -- operation without weakening the student-work freeze for ordinary callers.
  if tg_op = 'DELETE'
    and current_user = 'postgres'
    and coalesce(
      current_setting('pika.classroom_purge_finalize', true),
      'off'
    ) = 'on'
  then
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

  select array_agg(test.classroom_id order by test.classroom_id)
  into v_classroom_ids
  from public.tests test
  where test.id = any(v_test_ids);

  perform 1
  from public.classrooms classroom
  where classroom.id = any(v_classroom_ids)
  order by classroom.id
  for update;

  perform 1
  from public.tests test
  where test.id = any(v_test_ids)
  order by test.id
  for update;

  -- Blueprint capture records immutable Version membership on the source
  -- question; it does not change authored Test content or student work. Permit
  -- that provenance-only write after taking the normal parent locks, but only
  -- inside the owner-run identity-mapping or Blueprint-purge finalization
  -- routines. An API caller can set a custom GUC, so the owner check and the
  -- exact changed-column allowlist are both part of this trust boundary.
  if tg_table_name = 'test_questions'
    and tg_op = 'UPDATE'
    and current_user = 'postgres'
    and (
      coalesce(
        current_setting('pika.identity_mapping', true),
        'off'
      ) = 'on'
      or coalesce(
        current_setting('pika.course_blueprint_purge_finalize', true),
        'off'
      ) = 'on'
    )
    and (
      to_jsonb(new) - array[
        'source_blueprint_version_id',
        'updated_at'
      ]::text[]
    ) is not distinct from (
      to_jsonb(old) - array[
        'source_blueprint_version_id',
        'updated_at'
      ]::text[]
    )
  then
    return new;
  end if;

  if tg_table_name = 'test_questions'
    and exists (
      select 1
      from public.tests test
      where test.id = any(v_test_ids)
        and test.questions_locked_at is not null
    )
    and not (
      tg_op = 'UPDATE'
      and (to_jsonb(new) - array['question_text', 'options', 'updated_at',
        'ai_reference_cache_key', 'ai_reference_cache_answers',
        'ai_reference_cache_model', 'ai_reference_cache_generated_at']::text[])
        is not distinct from
        (to_jsonb(old) - array['question_text', 'options', 'updated_at',
        'ai_reference_cache_key', 'ai_reference_cache_answers',
        'ai_reference_cache_model', 'ai_reference_cache_generated_at']::text[])
      and (
        new.options is not distinct from old.options
        or (
          old.question_type = 'multiple_choice'
          and new.question_type = 'multiple_choice'
          and case
            when jsonb_typeof(old.options) = 'array'
              and jsonb_typeof(new.options) = 'array'
            then jsonb_array_length(new.options) = jsonb_array_length(old.options)
              and (
                select count(*)
                from jsonb_array_elements_text(old.options)
                  with ordinality as old_choice(value, position)
                join jsonb_array_elements_text(new.options)
                  with ordinality as new_choice(value, position)
                  using (position)
                where old_choice.value is distinct from new_choice.value
              ) <= 1
            else false
          end
        )
      )
    )
  then
    raise exception using
      errcode = '55000',
      message = 'test_questions_locked: Only question wording and existing choice text can change after a student starts';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
