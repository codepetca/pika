#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi

if [[ -z "$DB_CONTAINER" ]]; then
  echo "Local Supabase database container is not running." >&2
  exit 1
fi

{
  printf 'begin;\n'
  sed 's/^/ /' "$ROOT/supabase/migrations/099_assignment_submission_integrity_guards.sql"
  cat <<'SQL'

create temporary table assignment_integrity_ids (
  teacher_id uuid,
  student_id uuid,
  classroom_id uuid,
  assignment_id uuid,
  requirement_id uuid,
  doc_id uuid
) on commit drop;

do $$
declare
  v_table text;
  v_guard text;
  v_archive text;
  v_function text;
begin
  if (
    select count(*)
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'save_assignment_doc_atomic'
  ) <> 1 then
    raise exception 'Obsolete assignment save RPC overload survived migration replay';
  end if;

  foreach v_table in array array[
    'assignment_docs',
    'assignment_doc_history',
    'assignment_submission_requirements',
    'assignment_submission_artifacts'
  ] loop
    select min(tgname) filter (where tgname like 'aaa_%'),
           min(tgname) filter (where tgname = 'car_' || v_table)
    into v_guard, v_archive
    from pg_trigger
    where tgrelid = ('public.' || v_table)::regclass and not tgisinternal;
    if v_guard is null or v_archive is null or v_guard >= v_archive then
      raise exception 'Assignment guard trigger does not precede archive trigger on %', v_table;
    end if;
  end loop;

  foreach v_function in array array[
    'public.save_assignment_doc_atomic(uuid,uuid,jsonb,timestamp with time zone,text,integer,integer,jsonb,jsonb,integer,integer,uuid,bigint,uuid)',
    'public.submit_assignment_doc_atomic(uuid,uuid,jsonb,timestamp with time zone,integer,integer)',
    'public.unsubmit_assignment_doc_atomic(uuid,uuid)',
    'public.delete_assignment_submission_artifact_atomic(uuid,uuid,uuid)',
    'public.claim_assignment_artifact_storage_cleanup(uuid,integer,integer)',
    'public.claim_assignment_artifact_storage_cleanup_path(text,uuid,integer)',
    'public.complete_assignment_artifact_storage_cleanup(uuid,uuid)',
    'public.fail_assignment_artifact_storage_cleanup(uuid,uuid,text)',
    'public.enqueue_assignment_artifact_storage_cleanup_path(text,integer)',
    'public.cleanup_assignment_doc_save_operations(timestamp with time zone)',
    'public.update_assignment_with_submission_requirements_atomic(uuid,jsonb,jsonb)'
  ] loop
    if has_function_privilege('anon', v_function, 'execute')
      or has_function_privilege('authenticated', v_function, 'execute')
      or not has_function_privilege('service_role', v_function, 'execute') then
      raise exception 'Assignment RPC privilege contract is invalid for %', v_function;
    end if;
  end loop;

  if to_regprocedure('public.complete_assignment_artifact_storage_cleanup_path(text)') is not null then
    raise exception 'Unfenced assignment artifact cleanup path completion RPC survived migration replay';
  end if;

  if has_table_privilege('anon', 'public.assignment_artifact_storage_cleanup', 'select')
    or has_table_privilege('authenticated', 'public.assignment_artifact_storage_cleanup', 'insert')
    or not has_table_privilege('service_role', 'public.assignment_artifact_storage_cleanup', 'select')
    or not has_table_privilege('service_role', 'public.assignment_artifact_storage_cleanup', 'insert')
    or not has_table_privilege('service_role', 'public.assignment_artifact_storage_cleanup', 'delete') then
    raise exception 'Assignment artifact cleanup table privilege contract is invalid';
  end if;

  foreach v_function in array array[
    'public.guard_assignment_submission_requirement_mutation()',
    'public.guard_assignment_submission_artifact_mutation()',
    'public.validate_assignment_submission_transition()',
    'public.guard_assignment_doc_history_after_submit()',
    'public.guard_submitted_assignment_doc_content()',
    'public.enqueue_deleted_assignment_artifact_storage_cleanup()',
    'public.ensure_current_assignment_submit_history()'
  ] loop
    if has_function_privilege('anon', v_function, 'execute')
      or has_function_privilege('authenticated', v_function, 'execute')
      or has_function_privilege('service_role', v_function, 'execute') then
      raise exception 'Assignment trigger function is externally executable: %', v_function;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_path text := 'atomic/cleanup-lease.png';
  v_first_lease uuid := gen_random_uuid();
  v_second_lease uuid := gen_random_uuid();
  v_claim public.assignment_artifact_storage_cleanup%rowtype;
begin
  perform public.enqueue_assignment_artifact_storage_cleanup_path(v_path, 0);
  select * into v_claim
  from public.claim_assignment_artifact_storage_cleanup_path(v_path, v_first_lease, 120);
  if v_claim.id is null or v_claim.lease_token is distinct from v_first_lease then
    raise exception 'Exact-path cleanup claim did not acquire its lease';
  end if;

  perform public.enqueue_assignment_artifact_storage_cleanup_path(v_path, 0);
  if not exists (
    select 1 from public.assignment_artifact_storage_cleanup
    where id = v_claim.id and status = 'processing' and lease_token = v_first_lease
  ) then
    raise exception 'Re-enqueue revoked an active cleanup lease';
  end if;
  if exists (
    select 1 from public.claim_assignment_artifact_storage_cleanup_path(v_path, v_second_lease, 120)
  ) then
    raise exception 'A second worker stole an active exact-path cleanup lease';
  end if;
  if public.complete_assignment_artifact_storage_cleanup(v_claim.id, v_second_lease) then
    raise exception 'A stale cleanup lease completed another worker claim';
  end if;
  if not public.complete_assignment_artifact_storage_cleanup(v_claim.id, v_first_lease) then
    raise exception 'The owning cleanup lease could not complete its claim';
  end if;
end;
$$;

do $$
declare
  v_row jsonb;
begin
  v_row := public.normalize_classroom_archive_restore_row(
    gen_random_uuid(),
    'assignment_docs',
    '{"id":"10000000-0000-4000-8000-000000000001"}'::jsonb
  );
  if not (v_row ? 'save_session_id')
    or not (v_row ? 'save_sequence')
    or jsonb_typeof(v_row->'save_session_id') <> 'null'
    or jsonb_typeof(v_row->'save_sequence') <> 'null' then
    raise exception 'Pre-099 assignment archive row was not normalized: %', v_row;
  end if;
end;
$$;

insert into assignment_integrity_ids
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

insert into public.users (id, email, role, email_verified_at)
select teacher_id, 'assignment-integrity-teacher@example.invalid', 'teacher', clock_timestamp()
from assignment_integrity_ids
union all
select student_id, 'assignment-integrity-student@example.invalid', 'student', clock_timestamp()
from assignment_integrity_ids;

insert into public.classrooms (id, teacher_id, title, class_code)
select classroom_id, teacher_id, 'Assignment integrity check', upper(substr(replace(classroom_id::text, '-', ''), 1, 8))
from assignment_integrity_ids;

insert into public.assignments (id, classroom_id, title, description, due_at, created_by)
select assignment_id, classroom_id, 'Atomic assignment', '', clock_timestamp() + interval '1 day', teacher_id
from assignment_integrity_ids;

do $$
declare
  v_ids assignment_integrity_ids%rowtype;
  v_result jsonb;
  v_revision timestamptz;
  v_base_revision timestamptz;
  v_doc_id uuid;
  v_content jsonb;
  v_session_id uuid := gen_random_uuid();
  v_other_session_id uuid := gen_random_uuid();
  v_metric_session_id uuid := gen_random_uuid();
  v_initial_metric_session_id uuid := gen_random_uuid();
  v_chain_session_id uuid := gen_random_uuid();
  v_chain_metric_session_id uuid := gen_random_uuid();
  v_before_retry_keys bigint;
  v_before_cross_keys bigint;
begin
  select * into v_ids from assignment_integrity_ids;

  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Initial"}]}]}'::jsonb,
    null, 'autosave', 0, 7, '[]'::jsonb, null, 1, 7,
    v_session_id, 1, v_initial_metric_session_id
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Initial atomic save failed: %', v_result;
  end if;

  v_doc_id := (v_result->'doc'->>'id')::uuid;
  update assignment_integrity_ids set doc_id = v_doc_id;
  select updated_at into v_revision from public.assignment_docs where id = v_doc_id;

  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Initial"}]}]}'::jsonb,
    null, 'autosave', 0, 7, '[]'::jsonb, null, 1, 7,
    v_session_id, 1, v_initial_metric_session_id
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Lost create response was not exactly replayable: %', v_result;
  end if;
  if (select sum(keystroke_count) from public.assignment_doc_history where assignment_doc_id = v_doc_id)
    is distinct from 7::bigint then
    raise exception 'Create replay duplicated input metrics';
  end if;

  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Older in flight"}]}]}'::jsonb,
    v_revision, 'blur', 1, 4,
    '[{"op":"replace","path":"/content/0/content/0/text","value":"Older in flight"}]'::jsonb,
    null, 3, 15, v_session_id, 2, v_metric_session_id
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Older atomic save failed: %', v_result;
  end if;
  v_base_revision := v_revision;

  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Latest"}]}]}'::jsonb,
    v_base_revision, 'blur', 2, 6, '[]'::jsonb, null, 1, 6,
    v_session_id, 3, v_metric_session_id
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Superseding pagehide save failed: %', v_result;
  end if;

  select content, updated_at into v_content, v_revision
  from public.assignment_docs where id = v_doc_id;
  if v_content #>> '{content,0,content,0,text}' <> 'Latest' then
    raise exception 'Superseding save did not preserve the latest content';
  end if;
  if (select sum(keystroke_count) from public.assignment_doc_history where assignment_doc_id = v_doc_id)
    is distinct from 13::bigint then
    raise exception 'Superseding save did not de-duplicate in-flight input metrics';
  end if;

  v_base_revision := v_revision;
  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id, v_content,
    v_base_revision, 'blur', 0, 0, '[]'::jsonb, null, 1, 6,
    v_session_id, 4, gen_random_uuid()
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Pagehide fence save failed: %', v_result;
  end if;

  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Late older write"}]}]}'::jsonb,
    v_base_revision, 'autosave', 0, 1, '[]'::jsonb, null, 3, 16,
    v_session_id, 3, v_metric_session_id
  );
  if (v_result->>'status')::integer is distinct from 409 then
    raise exception 'Fenced older save was not rejected: %', v_result;
  end if;

  select updated_at into v_revision from public.assignment_docs where id = v_doc_id;
  select coalesce(sum(keystroke_count), 0) into v_before_cross_keys
  from public.assignment_doc_history where assignment_doc_id = v_doc_id;
  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id, v_content,
    v_revision, 'autosave', 0, 7, '[]'::jsonb, null, 1, 6,
    v_other_session_id, 1, v_metric_session_id
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Intervening editor save failed: %', v_result;
  end if;
  if (select coalesce(sum(keystroke_count), 0) from public.assignment_doc_history
      where assignment_doc_id = v_doc_id) <> v_before_cross_keys + 1 then
    raise exception 'Cross-session supersession did not de-duplicate input metrics';
  end if;
  select coalesce(sum(keystroke_count), 0) into v_before_retry_keys
  from public.assignment_doc_history where assignment_doc_id = v_doc_id;

  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Latest"}]}]}'::jsonb,
    v_base_revision, 'blur', 2, 6, '[]'::jsonb, null, 1, 6,
    v_session_id, 3, v_metric_session_id
  );
  if v_result->>'error_code' <> 'assignment_doc_save_replayed' then
    raise exception 'Committed save retry was not recognized after an intervening editor save: %', v_result;
  end if;
  if (select coalesce(sum(keystroke_count), 0) from public.assignment_doc_history
      where assignment_doc_id = v_doc_id) <> v_before_retry_keys then
    raise exception 'Committed save retry duplicated input metrics';
  end if;

  select updated_at into v_base_revision from public.assignment_docs where id = v_doc_id;
  select coalesce(sum(keystroke_count), 0) into v_before_retry_keys
  from public.assignment_doc_history where assignment_doc_id = v_doc_id;
  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id, v_content,
    v_base_revision, 'autosave', 0, 2, '[]'::jsonb, null, 1, 6,
    v_chain_session_id, 1, v_chain_metric_session_id
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Metric ancestry base save failed: %', v_result;
  end if;
  -- Sequence 2 (four cumulative keystrokes) is intentionally absent.
  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id, v_content,
    v_base_revision, 'autosave', 0, 6, '[]'::jsonb, null, 1, 6,
    v_chain_session_id, 3, v_chain_metric_session_id
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Metric ancestry save after a missing attempt failed: %', v_result;
  end if;
  if (select coalesce(sum(keystroke_count), 0) from public.assignment_doc_history
      where assignment_doc_id = v_doc_id) <> v_before_retry_keys + 6 then
    raise exception 'Missing intermediate save duplicated committed metric ancestry';
  end if;

  select updated_at into v_base_revision from public.assignment_docs where id = v_doc_id;
  update public.assignment_docs
  set content = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Legacy direct write"}]}]}'::jsonb
  where id = v_doc_id;
  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Atomic overwrite"}]}]}'::jsonb,
    v_base_revision, 'autosave', 0, 0, '[]'::jsonb, null, 2, 16,
    v_chain_session_id, 4, gen_random_uuid()
  );
  if (v_result->>'error_code') is distinct from 'assignment_doc_revision_conflict' then
    raise exception 'Legacy direct write bypassed the atomic revision fence: %', v_result;
  end if;

  if not exists (
    select 1 from public.assignment_doc_history
    where assignment_doc_id = v_doc_id
  ) then
    raise exception 'Atomic saves did not create history evidence';
  end if;
end;
$$;

do $$
declare
  v_doc_id uuid;
  v_deleted integer;
begin
  select doc_id into v_doc_id from assignment_integrity_ids;
  update public.assignment_doc_save_operations
  set completed_at = clock_timestamp() - interval '40 days'
  where id = (
    select id from public.assignment_doc_save_operations
    where assignment_doc_id = v_doc_id and save_sequence = 1
    order by completed_at, id
    limit 1
  );

  v_deleted := public.cleanup_assignment_doc_save_operations(
    clock_timestamp() - interval '35 days'
  );
  if v_deleted <> 1 then
    raise exception 'Assignment save operation retention cleanup deleted % rows', v_deleted;
  end if;
  if not exists (
    select 1 from public.assignment_doc_save_operations
    where assignment_doc_id = v_doc_id and save_sequence = 3
  ) then
    raise exception 'Assignment save operation cleanup removed recent replay evidence';
  end if;
end;
$$;

do $$
declare
  v_ids assignment_integrity_ids%rowtype;
  v_result jsonb;
  v_revision timestamptz;
  v_before_count bigint;
  v_after_count bigint;
  v_before_keys bigint;
  v_content jsonb;
  v_session_id uuid;
begin
  select * into v_ids from assignment_integrity_ids;
  select content, updated_at, save_session_id
  into v_content, v_revision, v_session_id
  from public.assignment_docs where id = v_ids.doc_id;

  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Before restore"}]}]}'::jsonb,
    v_revision, 'autosave', 0, 1, '[]'::jsonb, null, 2, 14,
    v_session_id, 5, gen_random_uuid()
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Pre-restore save failed: %', v_result;
  end if;

  select updated_at into v_revision from public.assignment_docs where id = v_ids.doc_id;
  select count(*) into v_before_count
  from public.assignment_doc_history where assignment_doc_id = v_ids.doc_id;

  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id, v_content,
    v_revision, 'restore', 0, 0, '[]'::jsonb, v_content, 1, 6,
    v_session_id, 6, gen_random_uuid()
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->'history_entry'->>'trigger' <> 'restore' then
    raise exception 'Restore save did not append restore history: %', v_result;
  end if;

  select count(*) into v_after_count
  from public.assignment_doc_history where assignment_doc_id = v_ids.doc_id;
  if v_after_count <> v_before_count + 1 then
    raise exception 'Restore save coalesced the preceding history entry';
  end if;

  select updated_at into v_revision from public.assignment_docs where id = v_ids.doc_id;
  select coalesce(sum(keystroke_count), 0) into v_before_keys
  from public.assignment_doc_history where assignment_doc_id = v_ids.doc_id;
  v_result := public.save_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id, v_content,
    v_revision, 'autosave', 0, 3, '[]'::jsonb, null, 1, 6,
    v_session_id, 7, gen_random_uuid()
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->'history_entry' is null then
    raise exception 'Edit-and-revert metrics were not persisted: %', v_result;
  end if;
  if (select coalesce(sum(keystroke_count), 0) from public.assignment_doc_history
      where assignment_doc_id = v_ids.doc_id) <> v_before_keys + 3 then
    raise exception 'Edit-and-revert metrics were not counted exactly once';
  end if;
  if (select count(*) from public.assignment_doc_history
      where assignment_doc_id = v_ids.doc_id) <> v_after_count + 1 then
    raise exception 'Autosave after restore overwrote the restore checkpoint (before %, after %)',
      v_after_count,
      (select count(*) from public.assignment_doc_history where assignment_doc_id = v_ids.doc_id);
  end if;
  if not exists (
    select 1 from public.assignment_doc_history
    where assignment_doc_id = v_ids.doc_id and trigger = 'restore'
  ) then
    raise exception 'Autosave after restore removed the restore checkpoint';
  end if;
end;
$$;

do $$
declare
  v_ids assignment_integrity_ids%rowtype;
  v_result jsonb;
begin
  select * into v_ids from assignment_integrity_ids;
  v_result := public.update_assignment_with_submission_requirements_atomic(
    v_ids.assignment_id,
    '{"instructions_markdown":"Updated instructions","description":"Updated instructions"}'::jsonb,
    '[]'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or (select description from public.assignments where id = v_ids.assignment_id)
      <> 'Updated instructions' then
    raise exception 'Combined assignment update left description stale: %', v_result;
  end if;
end;
$$;

insert into public.assignment_submission_requirements (
  id, assignment_id, type, label, required, position
)
select requirement_id, assignment_id, 'link', 'Required link', true, 0
from assignment_integrity_ids;

do $$
declare
  v_ids assignment_integrity_ids%rowtype;
  v_revision timestamptz;
begin
  select * into v_ids from assignment_integrity_ids;
  select updated_at into v_revision from public.assignment_docs where id = v_ids.doc_id;
  begin
    perform public.submit_assignment_doc_atomic(
      v_ids.assignment_id, v_ids.student_id,
      (select content from public.assignment_docs where id = v_ids.doc_id),
      v_revision, 1, 6
    );
    raise exception 'Submission without its required artifact unexpectedly succeeded';
  exception
    when check_violation then
      if sqlerrm not like '%assignment_submission_requirements_incomplete%' then
        raise;
      end if;
  end;
end;
$$;

insert into public.assignment_submission_artifacts (
  assignment_doc_id, requirement_id, student_id, type, url, validation_status
)
select doc_id, requirement_id, student_id, 'link', 'https://example.invalid/work', 'valid'
from assignment_integrity_ids;

do $$
declare
  v_ids assignment_integrity_ids%rowtype;
  v_revision timestamptz;
  v_result jsonb;
  v_submit_history_id uuid;
begin
  select * into v_ids from assignment_integrity_ids;
  select updated_at into v_revision from public.assignment_docs where id = v_ids.doc_id;
  v_result := public.submit_assignment_doc_atomic(
    v_ids.assignment_id, v_ids.student_id,
    (select content from public.assignment_docs where id = v_ids.doc_id),
    v_revision, 1, 6
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Atomic submission failed: %', v_result;
  end if;

  select id into v_submit_history_id
  from public.assignment_doc_history
  where assignment_doc_id = v_ids.doc_id and trigger = 'submit';
  if v_submit_history_id is null then
    raise exception 'Atomic submission did not create authoritative history';
  end if;

  v_result := public.update_assignment_with_submission_requirements_atomic(
    v_ids.assignment_id,
    '{"title":"Must not persist"}'::jsonb,
    '[]'::jsonb
  );
  if (v_result->>'status')::integer is distinct from 409 then
    raise exception 'Submitted requirement update was not rejected atomically: %', v_result;
  end if;
  if (select title from public.assignments where id = v_ids.assignment_id) = 'Must not persist' then
    raise exception 'Assignment fields changed despite rejected requirement update';
  end if;

  begin
    update public.assignment_submission_artifacts
    set url = 'https://example.invalid/changed'
    where assignment_doc_id = v_ids.doc_id;
    raise exception 'Submitted artifact mutation unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    update public.assignment_submission_requirements
    set label = 'Changed requirement'
    where id = v_ids.requirement_id;
    raise exception 'Submitted requirement mutation unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    update public.assignment_doc_history
    set snapshot = '{}'::jsonb
    where id = v_submit_history_id;
    raise exception 'Submit history rewrite unexpectedly succeeded';
  exception when check_violation then null;
  end;

  delete from public.assignment_doc_history where id = v_submit_history_id;
  if not exists (
    select 1 from public.assignment_doc_history where id = v_submit_history_id
  ) then
    raise exception 'Compatibility cleanup deleted authoritative submit history';
  end if;

  begin
    insert into public.assignment_doc_history (
      assignment_doc_id, patch, snapshot, word_count, char_count, trigger
    ) values (v_ids.doc_id, null, '{"type":"doc","content":[]}'::jsonb, 0, 0, 'submit');
    raise exception 'Malformed submit history unexpectedly succeeded';
  exception
    when check_violation then
      if sqlerrm not like '%assignment_submit_history_snapshot_invalid%' then
        raise;
      end if;
  end;

  begin
    insert into public.assignment_doc_history (
      assignment_doc_id, patch, snapshot, word_count, char_count, trigger
    ) values (v_ids.doc_id, null, '{}'::jsonb, 0, 0, 'submit');
    raise exception 'Duplicate submit history unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    update public.assignment_docs
    set content = '{"type":"doc","content":[]}'::jsonb
    where id = v_ids.doc_id;
    raise exception 'Submitted document content mutation unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    update public.assignment_docs
    set student_id = v_ids.teacher_id
    where id = v_ids.doc_id;
    raise exception 'Submitted document identity mutation unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    update public.assignment_docs
    set submitted_at = submitted_at + interval '1 minute'
    where id = v_ids.doc_id;
    raise exception 'Submitted timestamp mutation unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into public.assignment_doc_history (
      assignment_doc_id, patch, snapshot, word_count, char_count, trigger
    ) values (v_ids.doc_id, null, '{}'::jsonb, 0, 0, 'autosave');
    raise exception 'Post-submit autosave history unexpectedly succeeded';
  exception when check_violation then null;
  end;

  update public.assignment_docs
  set returned_at = clock_timestamp()
  where id = v_ids.doc_id;
  v_result := public.unsubmit_assignment_doc_atomic(v_ids.assignment_id, v_ids.student_id);
  if (v_result->>'status')::integer is distinct from 409 then
    raise exception 'Unsubmit did not lose atomically to teacher return: %', v_result;
  end if;

  update public.assignment_docs
  set returned_at = null
  where id = v_ids.doc_id;
  v_result := public.unsubmit_assignment_doc_atomic(v_ids.assignment_id, v_ids.student_id);
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or coalesce((v_result->'doc'->>'is_submitted')::boolean, true) is not false then
    raise exception 'Atomic unsubmit failed: %', v_result;
  end if;

  update public.assignment_docs
  set returned_at = clock_timestamp() - interval '1 minute',
      is_submitted = true,
      submitted_at = clock_timestamp()
  where id = v_ids.doc_id;
  v_result := public.unsubmit_assignment_doc_atomic(v_ids.assignment_id, v_ids.student_id);
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or coalesce((v_result->'doc'->>'is_submitted')::boolean, true) is not false then
    raise exception 'A newer resubmission could not be unsubmitted: %', v_result;
  end if;

  update public.assignment_docs
  set is_submitted = true, submitted_at = clock_timestamp()
  where id = v_ids.doc_id;
  set constraints ensure_current_assignment_submit_history immediate;
  if not exists (
    select 1 from public.assignment_doc_history h
    join public.assignment_docs d on d.id = h.assignment_doc_id
    where d.id = v_ids.doc_id
      and h.trigger = 'submit'
      and h.created_at >= d.submitted_at
      and h.patch is null
      and h.snapshot = d.content
  ) then
    raise exception 'Legacy direct submit did not synthesize authoritative history';
  end if;
  set constraints ensure_current_assignment_submit_history deferred;
  v_result := public.unsubmit_assignment_doc_atomic(v_ids.assignment_id, v_ids.student_id);
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Legacy direct-submit repair fixture could not be reset: %', v_result;
  end if;
end;
$$;

do $$
declare
  v_ids assignment_integrity_ids%rowtype;
  v_requirement_id uuid := gen_random_uuid();
  v_cleanup_id uuid;
  v_lease_token uuid := gen_random_uuid();
  v_second_lease_token uuid := gen_random_uuid();
  v_third_lease_token uuid := gen_random_uuid();
  v_result jsonb;
begin
  select * into v_ids from assignment_integrity_ids;
  insert into public.assignment_submission_requirements (
    id, assignment_id, type, label, required, position
  ) values (v_requirement_id, v_ids.assignment_id, 'image', 'Cleanup image', false, 1);
  insert into public.assignment_submission_artifacts (
    assignment_doc_id, requirement_id, student_id, type, storage_path, validation_status
  ) values (
    v_ids.doc_id, v_requirement_id, v_ids.student_id, 'image',
    'assignment-integrity/cleanup.png', 'valid'
  );

  v_result := public.delete_assignment_submission_artifact_atomic(
    v_ids.assignment_id, v_ids.student_id, v_requirement_id
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'storage_path' <> 'assignment-integrity/cleanup.png' then
    raise exception 'Atomic artifact deletion did not return queued Storage path: %', v_result;
  end if;
  if not exists (
    select 1 from public.assignment_artifact_storage_cleanup
    where storage_path = 'assignment-integrity/cleanup.png' and status = 'pending'
  ) then
    raise exception 'Artifact deletion did not durably enqueue Storage cleanup';
  end if;

  select id into v_cleanup_id
  from public.claim_assignment_artifact_storage_cleanup(v_lease_token, 1, 60);
  if v_cleanup_id is null then
    raise exception 'Artifact cleanup row was not claimable';
  end if;
  update public.assignment_artifact_storage_cleanup
  set attempt_count = 26,
      lease_expires_at = clock_timestamp() - interval '1 second'
  where id = v_cleanup_id;
  if public.complete_assignment_artifact_storage_cleanup(v_cleanup_id, v_lease_token) then
    raise exception 'Expired artifact cleanup lease completed work';
  end if;
  perform public.claim_assignment_artifact_storage_cleanup(v_second_lease_token, 1, 60);
  if not public.fail_assignment_artifact_storage_cleanup(
    v_cleanup_id, v_second_lease_token, 'retry check'
  ) then
    raise exception 'Artifact cleanup failure was not durably recorded';
  end if;

  update public.assignment_artifact_storage_cleanup
  set next_attempt_at = clock_timestamp()
  where id = v_cleanup_id;
  perform public.claim_assignment_artifact_storage_cleanup(v_third_lease_token, 1, 60);
  if not public.complete_assignment_artifact_storage_cleanup(v_cleanup_id, v_third_lease_token) then
    raise exception 'Artifact cleanup completion was not lease-fenced';
  end if;
  if exists (select 1 from public.assignment_artifact_storage_cleanup where id = v_cleanup_id) then
    raise exception 'Completed artifact cleanup evidence was not removed';
  end if;
end;
$$;

-- Document and assignment parent cascades must remain valid.
delete from public.assignment_docs
where id = (select doc_id from assignment_integrity_ids);

do $$
declare
  v_ids assignment_integrity_ids%rowtype;
  v_assignment_id uuid := gen_random_uuid();
  v_requirement_id uuid := gen_random_uuid();
  v_doc_id uuid := gen_random_uuid();
begin
  select * into v_ids from assignment_integrity_ids;
  insert into public.assignments (id, classroom_id, title, description, due_at, created_by)
  values (v_assignment_id, v_ids.classroom_id, 'Restore assignment', '', clock_timestamp() + interval '1 day', v_ids.teacher_id);
  insert into public.assignment_submission_requirements (id, assignment_id, type, label)
  values (v_requirement_id, v_assignment_id, 'link', 'Restore link');
  insert into public.assignment_docs (
    id, assignment_id, student_id, content_legacy, content, is_submitted, submitted_at
  ) values (
    v_doc_id, v_assignment_id, v_ids.student_id, '',
    '{"type":"doc","content":[]}'::jsonb, true, clock_timestamp()
  );

  perform set_config('pika.classroom_archive_restore', 'on', true);
  insert into public.assignment_submission_artifacts (
    assignment_doc_id, requirement_id, student_id, type, url, validation_status
  ) values (v_doc_id, v_requirement_id, v_ids.student_id, 'link', 'https://example.invalid/restored', 'valid');
  insert into public.assignment_doc_history (
    assignment_doc_id, patch, snapshot, word_count, char_count, trigger
  ) values (v_doc_id, null, '{"type":"doc","content":[]}'::jsonb, 0, 0, 'baseline');
  set constraints ensure_current_assignment_submit_history immediate;
  if exists (
    select 1 from public.assignment_doc_history h
    join public.assignment_docs d on d.id = h.assignment_doc_id
    where d.id = v_doc_id
      and h.trigger = 'submit'
      and h.created_at >= d.submitted_at
      and h.snapshot = d.content
  ) then
    raise exception 'Archive restore added history that was not present in the verified archive';
  end if;
  if (select count(*) from public.assignment_doc_history where assignment_doc_id = v_doc_id) <> 1 then
    raise exception 'Archive restore changed the verified assignment history count';
  end if;
  set constraints ensure_current_assignment_submit_history deferred;
  perform set_config('pika.classroom_archive_restore', 'off', true);
  set constraints ensure_current_assignment_submit_history immediate;
  if (select count(*) from public.assignment_doc_history where assignment_doc_id = v_doc_id) <> 1 then
    raise exception 'Deferred submit repair escaped restore maintenance mode';
  end if;
  set constraints ensure_current_assignment_submit_history deferred;

  perform set_config('pika.classroom_archive_compaction', 'on', true);
  delete from public.assignment_submission_artifacts where assignment_doc_id = v_doc_id;
  insert into public.assignment_submission_artifacts (
    assignment_doc_id, requirement_id, student_id, type, url, validation_status
  ) values (v_doc_id, v_requirement_id, v_ids.student_id, 'link', 'https://example.invalid/restored', 'valid');
  perform set_config('pika.classroom_archive_compaction', 'off', true);

  delete from public.assignments where id = v_assignment_id;
end;
$$;

-- Classroom cascades traverse submitted requirements, artifacts, docs, and history.
delete from public.classrooms
where id = (select classroom_id from assignment_integrity_ids);

rollback;
SQL
} | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1

echo "Atomic assignment save/submission checks passed (transaction rolled back)."
