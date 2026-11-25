-- Keep title changes in the atomic draft save. The question trigger still
-- protects attempts, and this function still guards results and references.
do $migration$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.finish_test_draft_save_for_owner_v1(uuid,uuid,uuid,text,integer,text,jsonb,jsonb,boolean,timestamptz)'::regprocedure
  );
  v_before constant text := $before$  -- 220 freezes settings, identity, order and grading; word/one-choice text
  -- corrections are checked by the authoritative child trigger as well.
  if v_test.questions_locked_at is not null and (
    v_test.title is distinct from pg_catalog.btrim(p_content->>'title')
    or v_test.show_results is distinct from (p_content->>'show_results')::boolean$before$;
  v_after constant text := $after$  -- Question locks are enforced by the child trigger. Title remains editable.
  if v_test.questions_locked_at is not null and (
    v_test.show_results is distinct from (p_content->>'show_results')::boolean$after$;
begin
  if pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
    <> pg_catalog.length(v_before) then
    raise exception 'Unexpected started-Test draft save guard';
  end if;

  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$migration$;
