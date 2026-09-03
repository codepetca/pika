-- Migration153 is already applied locally. Keep its history immutable and
-- remove two plpgsql_check artifacts without changing permissions, gates,
-- deletion scope, batch size, or the runtime absence-verification contract.
-- No rows are deleted and no settings are enabled by this migration.
do $$
declare
  v_definition text;
  v_expected text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.begin_attendance_decommission(uuid,uuid,uuid,text)'::regprocedure);
  v_expected := E'  v_op public.attendance_decommission_operations;\n';
  if (length(v_definition) - length(replace(v_definition, v_expected, '')))
    / length(v_expected) <> 1 then
    raise exception 'Migration154: unexpected begin declaration';
  end if;
  v_definition := replace(v_definition, v_expected, '');
  v_expected := '  select * into v_op from public.attendance_decommission_operations where id = p_operation_id;';
  if (length(v_definition) - length(replace(v_definition, v_expected, '')))
    / length(v_expected) <> 1 then
    raise exception 'Migration154: unexpected begin lookup';
  end if;
  execute replace(v_definition, v_expected,
    '  perform 1 from public.attendance_decommission_operations where id = p_operation_id;');

  -- The runtime FOREACH correctly visits scalar table names, as exercised by
  -- the rollback fixture. The checker instead propagates the whole constant
  -- array into the dynamic identifier. A query loop makes element typing
  -- explicit while retaining the same closed, ordered table list.
  v_definition := pg_catalog.pg_get_functiondef(
    'public.tick_attendance_decommission(uuid,uuid,uuid)'::regprocedure);
  v_expected := '    foreach v_table in array v_tables loop';
  if (length(v_definition) - length(replace(v_definition, v_expected, '')))
    / length(v_expected) <> 1 then
    raise exception 'Migration154: unexpected absence loop';
  end if;
  execute replace(v_definition, v_expected,
    '    for v_table in select unnest(v_tables) loop');
end;
$$;
