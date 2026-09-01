-- Resolve the eight warning-level plpgsql_check findings present after
-- migration 146 without changing deployed RPC signatures or unrelated mature
-- function bodies.
--
-- Six findings are implementation artifacts rather than missing behavior:
-- discarded archive type-check results, loop variables used only to acquire
-- ordered row locks, and declarations left behind by later refactors. Two
-- parameters represent real input contracts and are retained: the Test
-- unsubmit actor now enforces teacher/Classroom ownership at the database
-- boundary, and the grade-clear timestamp is now rejected when null.
--
-- These functions are large and span independently verified archive, purge,
-- grading, submission, and attendance contracts. Apply exact, fail-closed
-- substitutions to their installed definitions so this migration cannot
-- silently alter any surrounding behavior or tolerate unexpected schema drift.

create function private.replace_function_definition_fragment_v147(
  p_function regprocedure,
  p_expected text,
  p_replacement text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_definition text;
  v_occurrences integer;
begin
  if p_expected is null or p_expected = '' then
    raise exception 'Migration 147 replacement fragment must not be empty'
      using errcode = '22023';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(p_function::oid);
  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, p_expected, ''))
  ) / pg_catalog.length(p_expected);

  if v_occurrences <> 1 then
    raise exception 'Migration 147 expected exactly one fragment in %, found %',
      p_function::text,
      v_occurrences
      using errcode = '55000';
  end if;

  execute pg_catalog.replace(v_definition, p_expected, p_replacement);
end;
$$;

revoke all on function private.replace_function_definition_fragment_v147(
  regprocedure,
  text,
  text
) from public, anon, authenticated, service_role;

-- jsonb_populate_record performs the type validation even when EXECUTE
-- discards its result, so the unread target variables are unnecessary.
select private.replace_function_definition_fragment_v147(
  'private.stage_classroom_archive_restore_rows_v094(uuid,uuid,text,jsonb)'::regprocedure,
  E'      ) into v_typed_row using v_row;',
  E'      ) using v_row;'
);
select private.replace_function_definition_fragment_v147(
  'private.stage_classroom_archive_restore_rows_v094(uuid,uuid,text,jsonb)'::regprocedure,
  E'  v_typed_row jsonb;\n',
  ''
);

select private.replace_function_definition_fragment_v147(
  'public.stage_classroom_archive_restore_rows_v2(uuid,uuid,text,jsonb,integer)'::regprocedure,
  E'      )\n      into v_typed_row\n      using v_row;',
  E'      )\n      using v_row;'
);
select private.replace_function_definition_fragment_v147(
  'public.stage_classroom_archive_restore_rows_v2(uuid,uuid,text,jsonb,integer)'::regprocedure,
  E'  v_typed_row jsonb;\n',
  ''
);

-- The service-role-only RPC receives the authenticated teacher ID from the
-- route. Enforce that actor and the active Classroom at the atomic boundary
-- before mutating attempts; the empty-selection no-op remains unchanged.
select private.replace_function_definition_fragment_v147(
  'public.unsubmit_test_attempts_atomic(uuid,uuid[],uuid)'::regprocedure,
  E'  with target_attempts as materialized (',
  E'  if p_updated_by is null or not exists (\n'
    || E'    select 1\n'
    || E'    from public.tests test\n'
    || E'    join public.classrooms classroom on classroom.id = test.classroom_id\n'
    || E'    where test.id = p_test_id\n'
    || E'      and classroom.teacher_id = p_updated_by\n'
    || E'      and classroom.archived_at is null\n'
    || E'  ) then\n'
    || E'    raise exception ''Test unsubmission is not allowed'' using errcode = ''42501'';\n'
    || E'  end if;\n\n'
    || E'  with target_attempts as materialized ('
);

-- p_now is part of the deployed deterministic grading RPC contract. Other
-- grading mutations already reject a missing clock input; make clear-grade
-- consistent without changing the signature or successful write behavior.
select private.replace_function_definition_fragment_v147(
  'public.clear_test_open_response_grades_atomic(uuid,uuid,uuid[],jsonb,timestamp with time zone)'::regprocedure,
  E'  if p_expected_responses is null\n',
  E'  if p_now is null\n    or p_expected_responses is null\n'
);

-- Ordered SELECT ... FOR UPDATE statements retain the artifact-before-document
-- lock contract without unread loop iterator variables.
select private.replace_function_definition_fragment_v147(
  'public.update_assignment_with_submission_requirements_atomic(uuid,jsonb,jsonb)'::regprocedure,
  E'  for v_artifact_id in\n'
    || E'    select artifact.id\n'
    || E'    from public.assignment_submission_artifacts artifact\n'
    || E'    join public.assignment_docs doc on doc.id = artifact.assignment_doc_id\n'
    || E'    where doc.assignment_id = p_assignment_id\n'
    || E'    order by artifact.id\n'
    || E'    for update of artifact\n'
    || E'  loop\n'
    || E'    null;\n'
    || E'  end loop;',
  E'  perform 1\n'
    || E'  from public.assignment_submission_artifacts artifact\n'
    || E'  join public.assignment_docs doc on doc.id = artifact.assignment_doc_id\n'
    || E'  where doc.assignment_id = p_assignment_id\n'
    || E'  order by artifact.id\n'
    || E'  for update of artifact;'
);
select private.replace_function_definition_fragment_v147(
  'public.update_assignment_with_submission_requirements_atomic(uuid,jsonb,jsonb)'::regprocedure,
  E'  for v_doc_id in\n'
    || E'    select doc.id\n'
    || E'    from public.assignment_docs doc\n'
    || E'    where doc.assignment_id = p_assignment_id\n'
    || E'    order by doc.id\n'
    || E'    for update\n'
    || E'  loop\n'
    || E'    null;\n'
    || E'  end loop;',
  E'  perform 1\n'
    || E'  from public.assignment_docs doc\n'
    || E'  where doc.assignment_id = p_assignment_id\n'
    || E'  order by doc.id\n'
    || E'  for update;'
);
select private.replace_function_definition_fragment_v147(
  'public.update_assignment_with_submission_requirements_atomic(uuid,jsonb,jsonb)'::regprocedure,
  E'  v_artifact_id uuid;\n  v_doc_id uuid;\n',
  ''
);

select private.replace_function_definition_fragment_v147(
  'public.finalize_student_purge_without_attendance_v1(uuid,uuid)'::regprocedure,
  E'  v_expected integer;\n',
  ''
);

-- The nested policy upsert is invoked for its locked mutation and exception;
-- its JSON result was never part of this wrapper's returned contract.
select private.replace_function_definition_fragment_v147(
  'public.upsert_attendance_timing_policy_v1(uuid,uuid,time without time zone,time without time zone,smallint,integer,integer,integer,integer,boolean,bigint,timestamp with time zone)'::regprocedure,
  E'  v_result := public.upsert_attendance_window_policy_v1(',
  E'  perform public.upsert_attendance_window_policy_v1('
);
select private.replace_function_definition_fragment_v147(
  'public.upsert_attendance_timing_policy_v1(uuid,uuid,time without time zone,time without time zone,smallint,integer,integer,integer,integer,boolean,bigint,timestamp with time zone)'::regprocedure,
  E'  v_result jsonb;\n',
  ''
);

select private.replace_function_definition_fragment_v147(
  'public.submit_test_attempt_atomic(uuid,uuid,jsonb,timestamp with time zone)'::regprocedure,
  E'  v_responses jsonb;\n',
  ''
);

drop function private.replace_function_definition_fragment_v147(
  regprocedure,
  text,
  text
);

-- A fresh plpgsql_check replay also evaluates volatility against the complete
-- call graph (the long-lived shared stack had cached these older definitions).
-- Match each declaration to the strongest volatility its implementation can
-- honestly guarantee. None of these functions is used by an index, generated
-- column, or stored expression that requires IMMUTABLE/STABLE semantics.
alter function private.assignment_tiptap_plain_text(jsonb) stable;
alter function public.course_blueprint_canonical_jsonb_text(jsonb) stable;
alter function public.managed_storage_legacy_object_id(text, text) stable;
alter function public.student_purge_conflict(uuid, uuid) volatile;
alter function public.get_cleanup_history_cron_health_snapshot(integer, integer) volatile;
