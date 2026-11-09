begin;

-- An edit snapshot is private even when its Classwork item is visible.
-- The three references bind it to the lifetime of exactly one source item.
create table private.classwork_authoring_drafts (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  kind text not null check (kind in ('assignment', 'material', 'survey')),
  item_id uuid not null,
  assignment_id uuid generated always as (case when kind = 'assignment' then item_id end) stored
    references public.assignments(id) on delete cascade,
  material_id uuid generated always as (case when kind = 'material' then item_id end) stored
    references public.classwork_materials(id) on delete cascade,
  survey_id uuid generated always as (case when kind = 'survey' then item_id end) stored
    references public.surveys(id) on delete cascade,
  creation_request_id uuid,
  revision uuid,
  base_fingerprint text,
  content jsonb,
  unique (kind, item_id),
  unique (classroom_id, kind, creation_request_id),
  check (content is null or (
    jsonb_typeof(content) = 'object' and octet_length(content::text) <= 2000000
    and revision is not null and base_fingerprint is not null
  ))
);
create index classwork_authoring_drafts_assignment on private.classwork_authoring_drafts(assignment_id) where assignment_id is not null;
create index classwork_authoring_drafts_material on private.classwork_authoring_drafts(material_id) where material_id is not null;
create index classwork_authoring_drafts_survey on private.classwork_authoring_drafts(survey_id) where survey_id is not null;
alter table private.classwork_authoring_drafts enable row level security;
revoke all on table private.classwork_authoring_drafts from public, anon, authenticated, service_role;

-- The existing cold archive format cannot serialize private authoring snapshots.
-- Preserve unsaved-to-public work until the classroom is restored and resolved.
create function private.keep_classwork_draft_during_compaction()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.content is not null and public.is_classroom_archive_maintenance_mode('compaction') then
    raise exception using errcode = 'PT409', message = 'Classroom has pending Classwork drafts.';
  end if;
  return old;
end;
$$;
revoke all on function private.keep_classwork_draft_during_compaction() from public, anon, authenticated, service_role;
create trigger preserve_classwork_authoring_draft_on_compaction
  before delete on private.classwork_authoring_drafts
  for each row execute function private.keep_classwork_draft_during_compaction();

alter table public.teacher_authoring_image_references
  drop constraint teacher_authoring_image_references_owner_table_check,
  add constraint teacher_authoring_image_references_owner_table_check check (owner_table in (
    'assignments', 'classwork_materials', 'tests', 'test_questions',
    'survey_questions', 'assessment_drafts', 'test_ai_grading_run_items', 'classwork_authoring_drafts'
  ));
create or replace function public.sync_teacher_authoring_image_references()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
  v_classroom_id uuid;
  v_owner_id uuid;
  v_id uuid;
  v_object public.managed_storage_objects;
begin
  v_owner_id := case when tg_op = 'DELETE' then old.id else new.id end;
  if tg_op <> 'DELETE' then
    v_payload := case when tg_table_name = 'test_ai_grading_run_items'
      then pg_catalog.jsonb_build_object('question_grading_snapshot',pg_catalog.to_jsonb(new)->'question_grading_snapshot')
      else pg_catalog.to_jsonb(new) end;
  end if;
  -- Markdown is authoritative; stale compatibility nodes cannot keep a removed
  -- image live or grant reader access after an AI/source-only edit.
  if tg_table_name = 'classwork_materials'
    and pg_catalog.jsonb_typeof(v_payload->'content'->'attrs'->'authoring_markdown') = 'string' then
    v_payload := pg_catalog.jsonb_build_object('source',v_payload->'content'->'attrs'->'authoring_markdown');
  elsif tg_table_name = 'assignments'
    and pg_catalog.jsonb_typeof(v_payload->'instructions_markdown') = 'string' then
    v_payload := pg_catalog.jsonb_build_object('source',v_payload->'instructions_markdown');
  end if;
  if coalesce(v_payload::text, '') not like '%/api/storage/authoring-images?object_id=%'
    and not exists (select 1 from public.teacher_authoring_image_references
      where owner_table = tg_table_name and owner_id = v_owner_id)
  then return case when tg_op = 'DELETE' then old else new end; end if;
  perform public.lock_managed_storage_protocol();
  delete from public.teacher_authoring_image_references
    where owner_table = tg_table_name and owner_id = v_owner_id;
  if tg_op <> 'DELETE' then
    if tg_table_name in ('assignments','classwork_materials','tests','assessment_drafts','classwork_authoring_drafts') then
      v_classroom_id := new.classroom_id;
    elsif tg_table_name in ('test_questions','test_ai_grading_run_items') then
      select classroom_id into v_classroom_id from public.tests where id = new.test_id;
    elsif tg_table_name = 'survey_questions' then
      select classroom_id into v_classroom_id from public.surveys where id = new.survey_id;
    end if;
    for v_id in
      select distinct (matches)[1]::uuid from pg_catalog.regexp_matches(
        v_payload::text,
        '/api/storage/authoring-images\?object_id=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})',
        'g'
      ) matches order by 1
    loop
      select * into v_object from public.managed_storage_objects where id = v_id for update;
      if not found or v_classroom_id is null or v_object.classroom_id is distinct from v_classroom_id
        or v_object.purpose <> 'teacher_authoring_image'
        or v_object.storage_bucket <> 'test-documents' then
        raise exception using errcode = '23514', message = 'authoring_image_reference_not_attachable';
      end if;
      -- Sequential question saves and Undo may restore the last removed source
      -- reference. Revive only this feature's unclaimed one-hour retention state;
      -- the protocol and exact object row remain locked for the entire adoption.
      if v_object.status = 'cleanup_pending'
        and v_object.cleanup_reason_code = 'authoring_image_reference_removed'
        and v_object.next_attempt_at > pg_catalog.clock_timestamp()
        and v_object.attempt_count = 0
        and v_object.lease_token is null and v_object.lease_expires_at is null
        and v_object.verified_at is not null and v_object.ready_at is not null then
        update public.managed_storage_objects
          set status = 'ready', cleanup_reason_code = null, last_error_code = null,
            updated_at = pg_catalog.clock_timestamp()
          where id = v_id returning * into v_object;
      end if;
      if v_object.status not in ('verified','ready') then
        raise exception using errcode = '23514', message = 'authoring_image_reference_not_attachable';
      end if;
      perform public.managed_storage_mark_ready(v_id);
      insert into public.teacher_authoring_image_references(owner_table,owner_id,classroom_id,managed_object_id)
        values (tg_table_name,v_owner_id,v_classroom_id,v_id);
    end loop;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger classwork_authoring_drafts_image_references
  after insert or update or delete on private.classwork_authoring_drafts
  for each row execute function public.sync_teacher_authoring_image_references();

-- Resource mutations and the draft revision check share the existing owner
-- locks. Ignore list position and timestamp changes when detecting stale edits.
create function private.lock_classwork_authoring_item(
  p_actor_id uuid, p_classroom_id uuid, p_kind text, p_item_id uuid
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_owner uuid;
  v_archived timestamptz;
  v_questions jsonb;
begin
  if p_kind = 'assignment' then
    v_item := to_jsonb(private.lock_assignment_owner_mutation_context_v1(p_actor_id, p_item_id));
    perform public.guard_classroom_purge_lifecycle(p_classroom_id);
    v_item := v_item || jsonb_build_object('submission_requirements', coalesce((
      select jsonb_agg(to_jsonb(requirement) order by requirement.position, requirement.id)
        from public.assignment_submission_requirements requirement where assignment_id = p_item_id
    ), '[]'::jsonb));
  elsif p_kind = 'material' then
    perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:' || p_classroom_id::text, 0));
    perform public.guard_classroom_purge_lifecycle(p_classroom_id);
    select teacher_id, archived_at into v_owner, v_archived
      from public.classrooms where id = p_classroom_id for update nowait;
    if not found then raise exception using errcode = 'PT404', message = 'Classroom not found'; end if;
    if v_owner is distinct from p_actor_id or v_archived is not null then
      raise exception using errcode = 'PT403', message = 'Classroom is read-only';
    end if;
    select to_jsonb(material) into v_item from public.classwork_materials material
      where id = p_item_id and classroom_id = p_classroom_id for update nowait;
  elsif p_kind = 'survey' then
    perform private.lock_survey_context_v1(p_actor_id, p_classroom_id, p_item_id, false, true);
    select to_jsonb(survey) into v_item from public.surveys survey where id = p_item_id;
    select coalesce(jsonb_agg(to_jsonb(question) order by position, id), '[]'::jsonb)
      into v_questions from public.survey_questions question where survey_id = p_item_id;
    v_item := v_item || jsonb_build_object('questions', v_questions);
  end if;
  if v_item is null or (v_item->>'classroom_id')::uuid is distinct from p_classroom_id then
    raise exception using errcode = 'PT404', message = 'Classwork item not found';
  end if;
  return v_item;
end;
$$;
revoke all on function private.lock_classwork_authoring_item(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

create function private.classwork_authoring_fingerprint(p_item jsonb)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to((p_item - 'position' - 'updated_at')::text, 'UTF8')), 'hex')
$$;
revoke all on function private.classwork_authoring_fingerprint(jsonb) from public, anon, authenticated, service_role;

create function private.classwork_authoring_edit_fingerprint(p_item jsonb)
returns text language sql immutable set search_path = '' as $$
  select private.classwork_authoring_fingerprint(
    p_item - array['status', 'is_draft', 'released_at', 'opens_at']::text[]
  )
$$;
revoke all on function private.classwork_authoring_edit_fingerprint(jsonb) from public, anon, authenticated, service_role;

create function private.classwork_authoring_snapshot(p_draft private.classwork_authoring_drafts, p_live_content text default null)
returns jsonb language sql stable set search_path = '' as $$
  select case when p_draft.content is null then null
    else jsonb_build_object('revision', p_draft.revision, 'content', p_draft.content,
      'stale', p_live_content is not null and p_draft.base_fingerprint is distinct from p_live_content) end
$$;
revoke all on function private.classwork_authoring_snapshot(private.classwork_authoring_drafts, text) from public, anon, authenticated, service_role;

create function public.create_classwork_authoring_draft(
  p_actor_id uuid, p_classroom_id uuid, p_kind text, p_request_id uuid, p_content jsonb, p_projection jsonb
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '2s' set statement_timeout = '8s' as $$
declare
  v_draft private.classwork_authoring_drafts;
  v_result jsonb;
  v_item jsonb;
  v_item_id uuid;
begin
  if p_request_id is null or p_kind not in ('assignment', 'material', 'survey') then
    raise exception using errcode = 'PT400', message = 'Invalid Classwork draft request';
  end if;

  -- Serialize retries before creating an item. The normal create functions
  -- separately serialize classwork positions and enforce classroom ownership.
  perform pg_advisory_xact_lock(hashtextextended('pika-classwork-create:' || p_request_id::text, 0));
  select * into v_draft from private.classwork_authoring_drafts
    where classroom_id = p_classroom_id and kind = p_kind and creation_request_id = p_request_id;
  if found then
    v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, p_kind, v_draft.item_id);
    select * into v_draft from private.classwork_authoring_drafts where id = v_draft.id;
    return jsonb_build_object('item', v_item - 'questions',
      'sourceRevision', private.classwork_authoring_fingerprint(v_item),
      'draft', private.classwork_authoring_snapshot(v_draft));
  end if;

  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  if p_kind = 'assignment' then
    v_result := public.create_assignment_for_owner_v1(
      p_actor_id, p_classroom_id, p_projection->>'title', p_projection->>'description',
      p_projection->>'instructions_markdown', p_projection->'rich_instructions',
      (p_projection->>'due_at')::timestamptz, p_projection->'submission_requirements'
    );
    v_item := v_result->'assignment' || jsonb_build_object('submission_requirements', v_result->'submission_requirements');
  elsif p_kind = 'material' then
    v_result := public.create_classwork_material_for_owner_v4(
      p_actor_id, p_classroom_id, p_projection->>'title', p_projection->'content', true,
      null, (p_projection->>'posted_on')::date
    );
    v_item := v_result->'material';
  else
    v_result := public.create_survey_for_owner_v1(
      p_actor_id, p_classroom_id, p_projection->>'title',
      (p_content->>'show_results')::boolean, (p_content->>'dynamic_responses')::boolean
    );
    v_item := v_result->'survey';
  end if;
  v_item_id := (v_item->>'id')::uuid;
  if v_item_id is null or (p_kind <> 'material' and (v_result->>'ok')::boolean is distinct from true) then
    raise exception using errcode = 'PT503', message = 'Unable to create Classwork draft';
  end if;
  v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, p_kind, v_item_id);
  if p_kind = 'survey' then
    perform private.apply_classwork_survey_draft(v_item_id, p_projection, false, true);
    v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, p_kind, v_item_id);
  end if;
  insert into private.classwork_authoring_drafts
    (classroom_id, kind, item_id, creation_request_id, revision, content, base_fingerprint)
  values (
    p_classroom_id, p_kind, v_item_id, p_request_id,
    case when p_kind = 'survey' then p_request_id end,
    case when p_kind = 'survey' then p_content end,
    case when p_kind = 'survey' then
      private.classwork_authoring_edit_fingerprint(v_item)
    end
  ) returning * into v_draft;
  return jsonb_build_object('item', v_item,
    'sourceRevision', private.classwork_authoring_fingerprint(v_item),
    'draft', private.classwork_authoring_snapshot(v_draft));
end;
$$;

create function public.read_classwork_authoring_draft(
  p_actor_id uuid, p_classroom_id uuid, p_kind text, p_item_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '2s' set statement_timeout = '8s' as $$
declare
  v_draft private.classwork_authoring_drafts;
  v_item jsonb;
begin
  v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, p_kind, p_item_id);
  select * into v_draft from private.classwork_authoring_drafts
    where kind = p_kind and item_id = p_item_id and classroom_id = p_classroom_id;
  return jsonb_build_object('item', v_item,
    'sourceRevision', private.classwork_authoring_fingerprint(v_item),
    'draft', private.classwork_authoring_snapshot(v_draft, private.classwork_authoring_edit_fingerprint(v_item)));
end;
$$;

create function private.apply_classwork_assignment_values(
  p_actor_id uuid, p_item_id uuid, v_item jsonb, v_values jsonb
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_requirements jsonb;
  v_result jsonb;
begin
  -- Compare the editable requirement fields, excluding database metadata.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', value->'id', 'type', value->'type', 'label', value->'label',
    'instructions', value->'instructions', 'required', value->'required',
    'position', value->'position', 'validation_policy_json', value->'validation_policy_json'
  ) order by ordinality), '[]'::jsonb) into v_requirements
    from jsonb_array_elements(v_item->'submission_requirements') with ordinality;
  if v_requirements is not distinct from v_values->'submission_requirements' then
    v_requirements := null;
  else
    v_requirements := v_values->'submission_requirements';
  end if;
  v_result := public.update_assignment_for_owner_v1(
    p_actor_id, p_item_id, v_values - 'submission_requirements', v_requirements
  );
  if (v_result->>'ok')::boolean is distinct from true then
    raise exception using errcode = case when v_result->>'status' = '400' then 'PT400' else 'PT409' end,
      message = coalesce(v_result->>'error', 'Unable to apply assignment changes');
  end if;
  return v_result->'assignment' || jsonb_build_object('submission_requirements', v_result->'submission_requirements');
end;
$$;
revoke all on function private.apply_classwork_assignment_values(uuid, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;

create function public.save_classwork_authoring_draft(
  p_actor_id uuid, p_classroom_id uuid, p_kind text, p_item_id uuid,
  p_request_id uuid, p_content jsonb, p_expected_source_revision text, p_expected_revision uuid default null,
  p_save_as_draft boolean default false, p_projection jsonb default null
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '2s' set statement_timeout = '8s' as $$
declare
  v_item jsonb;
  v_draft private.classwork_authoring_drafts;
  v_fingerprint text;
  v_edit_fingerprint text;
begin
  if p_request_id is null or p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception using errcode = 'PT400', message = 'Invalid edit draft';
  end if;
  v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, p_kind, p_item_id);
  v_fingerprint := private.classwork_authoring_fingerprint(v_item);
  v_edit_fingerprint := private.classwork_authoring_edit_fingerprint(v_item);
  select * into v_draft from private.classwork_authoring_drafts
    where kind = p_kind and item_id = p_item_id and classroom_id = p_classroom_id for update;
  if p_save_as_draft and p_kind in ('assignment', 'material') then
    if (v_item->>'is_draft')::boolean is distinct from true then
      raise exception using errcode = 'PT409', message = 'This item was posted in another editor. Reopen it to save privately.';
    end if;
    if v_draft.revision = p_request_id and v_draft.content is null then
      return jsonb_build_object('item', v_item, 'sourceRevision', v_fingerprint, 'draft', null);
    end if;
    if v_fingerprint is distinct from p_expected_source_revision or v_draft.content is not null then
      raise exception using errcode = 'PT409', message = 'The Classwork item changed in another editor. Reopen it before saving.';
    end if;
    if p_kind = 'assignment' then
      v_item := private.apply_classwork_assignment_values(p_actor_id, p_item_id, v_item, p_projection);
    else
      v_item := public.update_classwork_material_for_owner_v1(p_actor_id, p_classroom_id, p_item_id, p_projection)->'material';
    end if;
    if (v_item->>'id')::uuid is distinct from p_item_id or (v_item->>'is_draft')::boolean is distinct from true then
      raise exception using errcode = 'PT503', message = 'Unable to verify saved Classwork draft.';
    end if;
    insert into private.classwork_authoring_drafts (classroom_id, kind, item_id, revision)
      values (p_classroom_id, p_kind, p_item_id, p_request_id)
    on conflict (kind, item_id) do update set revision = excluded.revision;
    v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, p_kind, p_item_id);
    return jsonb_build_object('item', v_item, 'sourceRevision', private.classwork_authoring_fingerprint(v_item), 'draft', null);
  end if;
  if v_draft.revision = p_request_id and v_draft.content = p_content then
    return jsonb_build_object('item', v_item, 'sourceRevision', v_fingerprint,
      'draft', private.classwork_authoring_snapshot(v_draft, v_edit_fingerprint));
  end if;
  if v_fingerprint is distinct from p_expected_source_revision then
    raise exception using errcode = 'PT409', message = 'The Classwork item changed in another editor. Reopen it before saving.';
  end if;
  if (case when v_draft.content is not null then v_draft.revision end) is distinct from p_expected_revision then
    raise exception using errcode = 'PT409', message = 'This draft changed in another editor. Reopen it before saving.';
  end if;
  if v_draft.content is not null and v_draft.base_fingerprint is distinct from v_edit_fingerprint then
    raise exception using errcode = 'PT409', message = 'The Classwork item changed since this draft was saved.';
  end if;
  if p_kind = 'survey' and v_item->>'status' = 'draft' then
    perform private.apply_classwork_survey_draft(p_item_id, p_projection, false, true);
    v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, p_kind, p_item_id);
    v_fingerprint := private.classwork_authoring_fingerprint(v_item);
    v_edit_fingerprint := private.classwork_authoring_edit_fingerprint(v_item);
  end if;
  insert into private.classwork_authoring_drafts (classroom_id, kind, item_id, revision, content, base_fingerprint)
    values (p_classroom_id, p_kind, p_item_id, p_request_id, p_content, v_edit_fingerprint)
  on conflict (kind, item_id) do update set
    revision = excluded.revision, content = excluded.content, base_fingerprint = excluded.base_fingerprint
  returning * into v_draft;
  return jsonb_build_object('item', v_item, 'sourceRevision', v_fingerprint,
    'draft', private.classwork_authoring_snapshot(v_draft));
end;
$$;

create function private.apply_classwork_survey_draft(
  p_survey_id uuid, p_content jsonb, p_publish boolean, p_save_draft boolean default false
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_survey public.surveys;
  v_question record;
  v_replaced_question public.survey_questions;
  v_question_id uuid;
begin
  select * into strict v_survey from public.surveys where id = p_survey_id;
  if (p_save_draft and v_survey.status <> 'draft')
    or (not p_save_draft and p_publish is distinct from (v_survey.status = 'draft')) then
    raise exception using errcode = 'PT409', message = 'The survey publication status changed. Reopen it and try again.';
  end if;
  if p_publish and jsonb_array_length(p_content->'questions') = 0 then
    raise exception using errcode = 'PT400', message = 'Add a question before publishing.';
  end if;
  if exists (
    select 1 from public.survey_questions current_question
    join public.survey_responses response on response.question_id = current_question.id
    left join jsonb_array_elements(p_content->'questions') edited(value)
      on (edited.value->>'id')::uuid = current_question.id
    where current_question.survey_id = p_survey_id
      and (edited.value is null
        or edited.value->>'question_type' is distinct from current_question.question_type
        or edited.value->'options' is distinct from current_question.options)
  ) then
    raise exception using errcode = 'PT409',
      message = 'Questions with student responses must keep their question type and options and cannot be removed.';
  end if;

  delete from public.survey_questions where survey_id = p_survey_id and id not in (
    select (value->>'id')::uuid from jsonb_array_elements(p_content->'questions')
  );
  for v_question in
    select value, (ordinality - 1)::integer as position
      from jsonb_array_elements(p_content->'questions') with ordinality
  loop
    v_question_id := (v_question.value->>'id')::uuid;
    -- Rotate the response key while preserving the question's Blueprint identity.
    -- Existing responses were checked under the survey/classroom lock.
    delete from public.survey_questions current_question
      where v_survey.status <> 'draft'
        and current_question.id = v_question_id and current_question.survey_id = p_survey_id
        and (current_question.question_type is distinct from v_question.value->>'question_type'
          or current_question.options is distinct from v_question.value->'options')
      returning * into v_replaced_question;
    if found then
      v_question_id := gen_random_uuid();
    end if;
    insert into public.survey_questions
      (id, survey_id, question_type, question_text, options, response_max_chars, position,
        artifact_id, source_artifact_id, source_blueprint_version_id, created_at)
    values (
      v_question_id, p_survey_id,
      v_question.value->>'question_type', v_question.value->>'question_text',
      v_question.value->'options', (v_question.value->>'response_max_chars')::integer,
      v_question.position, coalesce(v_replaced_question.artifact_id, gen_random_uuid()),
      v_replaced_question.source_artifact_id, v_replaced_question.source_blueprint_version_id,
      coalesce(v_replaced_question.created_at, now())
    )
    on conflict (id) do update set
      question_type = excluded.question_type,
      question_text = excluded.question_text,
      options = excluded.options,
      response_max_chars = excluded.response_max_chars,
      position = excluded.position
    where survey_questions.survey_id = p_survey_id;
    if not found then
      raise exception using errcode = 'PT409', message = 'A survey question no longer belongs to this survey.';
    end if;
  end loop;
  update public.surveys set
    title = p_content->>'title',
    show_results = (p_content->>'show_results')::boolean,
    dynamic_responses = (p_content->>'dynamic_responses')::boolean,
    status = case when p_publish then 'active' else status end
  where id = p_survey_id returning * into v_survey;
  return to_jsonb(v_survey);
end;
$$;
revoke all on function private.apply_classwork_survey_draft(uuid, jsonb, boolean, boolean) from public, anon, authenticated, service_role;

create function public.apply_classwork_authoring_draft(
  p_actor_id uuid, p_classroom_id uuid, p_kind text, p_item_id uuid,
  p_revision uuid, p_publish boolean, p_projection jsonb, p_discard boolean default false
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '2s' set statement_timeout = '8s' as $$
declare
  v_item jsonb;
  v_draft private.classwork_authoring_drafts;
  v_result jsonb;
  v_values jsonb := p_projection->'values';
begin
  v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, p_kind, p_item_id);
  select * into v_draft from private.classwork_authoring_drafts
    where kind = p_kind and item_id = p_item_id and classroom_id = p_classroom_id for update;
  if p_revision is null or v_draft.revision is distinct from p_revision then
    raise exception using errcode = 'PT409', message = 'This draft changed in another editor. Reopen it before applying.';
  end if;
  if p_discard then
    update private.classwork_authoring_drafts set content = null, base_fingerprint = null where id = v_draft.id;
  end if;
  if v_draft.content is null or p_discard then
    return jsonb_build_object('item', v_item, 'sourceRevision', private.classwork_authoring_fingerprint(v_item));
  end if;
  if v_draft.content is distinct from p_projection->'source' then
    raise exception using errcode = 'PT409', message = 'This draft changed in another editor. Reopen it before applying.';
  end if;
  if v_draft.base_fingerprint is distinct from private.classwork_authoring_edit_fingerprint(v_item) then
    raise exception using errcode = 'PT409', message = 'The Classwork item changed since this draft was saved.';
  end if;
  if p_kind = 'assignment' then
    v_item := private.apply_classwork_assignment_values(p_actor_id, p_item_id, v_item, v_values);
  elsif p_kind = 'material' then
    v_result := public.update_classwork_material_for_owner_v1(p_actor_id, p_classroom_id, p_item_id, v_values);
    v_item := v_result->'material';
  else
    if (v_draft.content->'editor'->>'unresolved')::boolean is true
      or (v_draft.content->'editor'->>'markdownDirty')::boolean is true then
      raise exception using errcode = 'PT400', message = 'Finish or discard the unfinished survey edit before applying.';
    end if;
    v_item := private.apply_classwork_survey_draft(p_item_id, v_values, p_publish);
  end if;
  if v_item is null or (v_item->>'id')::uuid is distinct from p_item_id then
    raise exception using errcode = 'PT503', message = 'Unable to apply Classwork changes';
  end if;
  -- Keep the revision as an apply receipt so an interrupted response can retry.
  -- The student-facing writes and removal of the private content commit together.
  update private.classwork_authoring_drafts set content = null, base_fingerprint = null where id = v_draft.id;
  v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, p_kind, p_item_id);
  return jsonb_build_object('item', v_item, 'sourceRevision', private.classwork_authoring_fingerprint(v_item));
end;
$$;

create function public.publish_classwork_authoring_material(
  p_actor_id uuid, p_classroom_id uuid, p_item_id uuid, p_expected_source_revision text, p_publication jsonb
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '2s' set statement_timeout = '8s' as $$
declare v_item jsonb;
begin
  if jsonb_typeof(p_publication) is distinct from 'object'
    or jsonb_typeof(p_publication->'is_draft') is distinct from 'boolean'
    or (p_publication - array['is_draft', 'scheduled_for']::text[]) <> '{}'::jsonb then
    raise exception using errcode = 'PT400', message = 'Invalid material publication request';
  end if;
  v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, 'material', p_item_id);
  if private.classwork_authoring_fingerprint(v_item) is distinct from p_expected_source_revision
    or exists (select 1 from private.classwork_authoring_drafts where kind = 'material' and item_id = p_item_id and content is not null) then
    raise exception using errcode = 'PT409', message = 'This material changed. Reopen it before posting or scheduling.';
  end if;
  perform public.update_classwork_material_for_owner_v1(p_actor_id, p_classroom_id, p_item_id, p_publication);
  v_item := private.lock_classwork_authoring_item(p_actor_id, p_classroom_id, 'material', p_item_id);
  return jsonb_build_object('item', v_item, 'sourceRevision', private.classwork_authoring_fingerprint(v_item));
end;
$$;
revoke all on function public.publish_classwork_authoring_material(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.publish_classwork_authoring_material(uuid, uuid, uuid, text, jsonb) to service_role;

revoke all on function public.create_classwork_authoring_draft(uuid, uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.read_classwork_authoring_draft(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_classwork_authoring_draft(uuid, uuid, text, uuid, uuid, jsonb, text, uuid, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.apply_classwork_authoring_draft(uuid, uuid, text, uuid, uuid, boolean, jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.create_classwork_authoring_draft(uuid, uuid, text, uuid, jsonb, jsonb) to service_role;
grant execute on function public.read_classwork_authoring_draft(uuid, uuid, text, uuid) to service_role;
grant execute on function public.save_classwork_authoring_draft(uuid, uuid, text, uuid, uuid, jsonb, text, uuid, boolean, jsonb) to service_role;
grant execute on function public.apply_classwork_authoring_draft(uuid, uuid, text, uuid, uuid, boolean, jsonb, boolean) to service_role;

commit;
